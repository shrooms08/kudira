// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {InstallmentPlan} from "../src/InstallmentPlan.sol";
import {KudiraPool} from "../src/KudiraPool.sol";
import {KudiraTestBase} from "./KudiraTest.base.sol";

/// @notice Reproduces the live failure: auto-debit can never be "on time".
///
/// Observed on Base Sepolia, plan 1: all four `collect()` calls landed 8 seconds
/// after their due timestamp, every `PaymentRecorded` carried `late = true`, zero
/// `OnTimeInstallmentsRecorded` events fired, and the grade sat at 50 across the
/// whole plan instead of climbing to 70.
///
/// The cause is structural, not a bug in the reward:
///   - `collect()` requires `amountDueNow > 0`, which needs `block.timestamp >= due`
///   - `_isLate` is `block.timestamp > due`
/// so the only instant where a payment is both collectable AND on time is the
/// exact second `block.timestamp == due`. Every existing reward test warps to
/// precisely `dueDateOf(...)` and lands in that one-second window. A real chain
/// cannot: the transaction mines a few seconds later, always.
///
/// Auto-debit and the grade ladder are therefore incompatible as written.
contract OnTimeGraceTest is KudiraTestBase {
    uint256 internal constant PRINCIPAL = 130 * ONE_USDC;
    uint16 internal constant INSTALLMENTS = 4;

    uint256 internal planId;

    function setUp() public override {
        super.setUp();
        vm.prank(owner);
        pool.setRule(0, 0);
        planId = _originate(PRINCIPAL, INSTALLMENTS, 0, 50);
        aUSDC.mint(borrower, PRINCIPAL);
        vm.prank(borrower);
        aUSDC.approve(address(pool), PRINCIPAL);
    }

    /// @dev THE REPRODUCTION. Collect one second after the due date — the best a
    ///      live chain can realistically do — and the grade must still rise.
    ///      FAILS against current code: the reward is gated on `!late`, and one
    ///      second past due is already late.
    function test_collectOneSecondAfterDueStillEarnsGrade() public {
        assertEq(creditLine.gradeOf(borrower), 50, "starts at 50");

        vm.warp(plans.dueDateOf(planId, 1) + 1);
        vm.prank(operator);
        pool.collect(planId);

        assertEq(creditLine.gradeOf(borrower), 55, "a 1s settlement delay must not forfeit the reward");
    }

    /// @dev The live case exactly: 8 seconds late, four times over.
    function test_liveCadenceReachesGrade70() public {
        for (uint16 i = 1; i <= INSTALLMENTS; i++) {
            vm.warp(plans.dueDateOf(planId, i) + 8); // observed on-chain delta
            vm.prank(operator);
            pool.collect(planId);
        }

        assertEq(creditLine.gradeOf(borrower), 70, "four on-time collects: 50 + 4*5");
        assertEq(creditLine.bandOf(borrower), "A-", "B+ -> A-");
        assertEq(creditLine.limitOf(borrower), 700 * ONE_USDC, "limit follows the grade");
    }

    /// @dev A payment genuinely beyond the grace window must still earn nothing.
    ///      This is what stops the fix from becoming "everything is on time".
    function test_wellPastGraceEarnsNothing() public {
        // Deliberately far beyond any sane grace: most of the way to the next
        // installment.
        vm.warp(plans.dueDateOf(planId, 1) + (THIRTY_DAYS / 2));
        vm.prank(operator);
        pool.collect(planId);

        assertEq(creditLine.gradeOf(borrower), 50, "a genuinely late payment earns no grade");
    }

    /// @dev And the default path must still be reachable — grace must not make a
    ///      plan uncollectable-on-forever.
    function test_defaultStillPossibleAfterGrace() public {
        vm.warp(plans.dueDateOf(planId, 1) + THIRTY_DAYS);
        assertTrue(plans.isLate(planId), "well past due is still late");

        vm.prank(operator);
        pool.markDefault(planId);
        assertEq(uint8(plans.statusOf(planId)), uint8(InstallmentPlan.Status.Defaulted));
    }
}
