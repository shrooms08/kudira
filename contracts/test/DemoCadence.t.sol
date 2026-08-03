// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {InstallmentPlan} from "../src/InstallmentPlan.sol";
import {KudiraTestBase} from "./KudiraTest.base.sol";

/// @notice Pins the EXACT parameters of the recorded live take, so the expected
///         on-camera outcome is proven by a test rather than asserted from
///         memory. The one-second-window bug shipped because the tests exercised
///         different timestamps than the chain would produce; this file exists
///         so that cannot happen again for the demo configuration specifically.
///
///         Live take: 130.00 KUSDC, 4 installments of 32.50, dueEvery = 90s,
///         grace = graceFor(90) = 60s (the MIN_GRACE floor), collect() fired by
///         the operator a few seconds after each due date (observed +8s on the
///         previous run).
contract DemoCadenceTest is KudiraTestBase {
    uint256 internal constant PRINCIPAL = 130 * ONE_USDC;
    uint16 internal constant INSTALLMENTS = 4;
    uint64 internal constant DEMO_DUE_EVERY = 90;
    /// @dev Settlement delay observed on the previous live run.
    uint64 internal constant OBSERVED_DELAY = 8;

    uint256 internal planId;

    function setUp() public override {
        super.setUp();
        vm.prank(owner);
        pool.setRule(0, 0);

        vm.prank(operator);
        planId = pool.originate(
            borrower,
            merchant,
            PRINCIPAL,
            INSTALLMENTS,
            DEMO_DUE_EVERY,
            50,
            50,
            uint64(block.timestamp + 365 days)
        );

        aUSDC.mint(borrower, PRINCIPAL);
        vm.prank(borrower);
        aUSDC.approve(address(pool), PRINCIPAL);
    }

    function test_demoParametersAreWhatTheTakeUses() public view {
        assertEq(plans.gracePeriodOf(planId), 60, "90s cadence hits the 60s MIN_GRACE floor");
        assertEq(plans.installmentAmount(planId), 32_500_000, "32.50 per installment");
        assertEq(creditLine.gradeOf(borrower), 50, "seeded at B+");
    }

    /// @dev THE TAKE, exactly: four collects, each +8s after its due date.
    ///      Must land on 70 / "A-" / 700.00.
    function test_liveTakeReachesGrade70() public {
        uint8[4] memory expectedGrade = [55, 60, 65, 70];

        for (uint16 i = 1; i <= INSTALLMENTS; i++) {
            vm.warp(plans.dueDateOf(planId, i) + OBSERVED_DELAY);
            vm.prank(operator);
            pool.collect(planId);
            assertEq(creditLine.gradeOf(borrower), expectedGrade[i - 1], "grade climbs +5 per collect");
        }

        assertEq(creditLine.gradeOf(borrower), 70, "50 + 4x5");
        assertEq(creditLine.bandOf(borrower), "A-", "the on-screen band");
        assertEq(creditLine.limitOf(borrower), 700 * ONE_USDC, "the on-screen limit");
        assertEq(uint8(plans.statusOf(planId)), uint8(InstallmentPlan.Status.Completed));
        assertFalse(plans.wasEverLate(planId), "never late anywhere in the take");
    }

    /// @dev The margin, exactly: at delay = grace the reward still fires; one
    ///      second past it the installment is late and earns nothing.
    function test_rewardMarginBoundary() public {
        vm.warp(plans.dueDateOf(planId, 1) + 60); // exactly at the end of grace
        vm.prank(operator);
        pool.collect(planId);
        assertEq(creditLine.gradeOf(borrower), 55, "delay == grace still earns");

        vm.warp(plans.dueDateOf(planId, 2) + 61); // one past grace
        vm.prank(operator);
        pool.collect(planId);
        assertEq(creditLine.gradeOf(borrower), 55, "delay > grace earns nothing");
        assertTrue(plans.wasEverLate(planId), "and latches everLate");
    }

    /// @dev If a collect slips past the NEXT due date (delay > 90s), one pull
    ///      covers two installments while overdue, and neither earns.
    function test_slippedCollectCoversTwoButEarnsNothing() public {
        vm.warp(plans.dueDateOf(planId, 2) + OBSERVED_DELAY); // skipped installment 1
        vm.prank(operator);
        uint256 collected = pool.collect(planId);

        assertEq(collected, 65_000_000, "catches up both installments");
        assertEq(creditLine.gradeOf(borrower), 50, "late catch-up earns no grade");
    }
}
