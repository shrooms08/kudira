// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {InstallmentPlan} from "../src/InstallmentPlan.sol";
import {KudiraTestBase} from "./KudiraTest.base.sol";

/// @notice Schedule arithmetic and late detection — the subtlest logic in the
///         stack and the easiest to break without noticing.
contract InstallmentScheduleTest is KudiraTestBase {
    uint256 internal constant PRINCIPAL = 300 * ONE_USDC;
    uint16 internal constant INSTALLMENTS = 3;

    uint256 internal planId;

    function setUp() public override {
        super.setUp();
        planId = _originate(PRINCIPAL, INSTALLMENTS, 0, 50);
    }

    function test_dueDatesAreEvenlySpaced() public view {
        uint64 start = plans.getPlan(planId).startTime;
        assertEq(plans.dueDateOf(planId, 1), start + THIRTY_DAYS);
        assertEq(plans.dueDateOf(planId, 2), start + 2 * THIRTY_DAYS);
        assertEq(plans.dueDateOf(planId, 3), start + 3 * THIRTY_DAYS);
        assertEq(plans.finalDueDate(planId), start + 3 * THIRTY_DAYS);
    }

    function test_nextDueDateAdvancesWithPayments() public {
        uint64 start = plans.getPlan(planId).startTime;
        assertEq(plans.nextDueDate(planId), start + THIRTY_DAYS, "first installment");

        _repay(planId, 100 * ONE_USDC);
        assertEq(plans.nextDueDate(planId), start + 2 * THIRTY_DAYS, "second installment");

        _repay(planId, 100 * ONE_USDC);
        assertEq(plans.nextDueDate(planId), start + 3 * THIRTY_DAYS, "third installment");

        _repay(planId, 100 * ONE_USDC);
        assertEq(plans.nextDueDate(planId), 0, "nothing left to pay");
    }

    /// @dev The boundary is the END OF GRACE, not the due date. Before the grace
    ///      fix this asserted `due + 1` was late, which made auto-debit unable to
    ///      ever pay on time — collect() cannot fire before the due timestamp.
    function test_latenessBoundaryIsExact() public {
        uint64 due = plans.dueDateOf(planId, 1);
        uint64 grace = plans.gracePeriodOf(planId);
        assertEq(grace, plans.graceFor(THIRTY_DAYS), "grace is proportional to the period");

        vm.warp(due);
        assertFalse(plans.isLate(planId), "on the due date is not late");

        vm.warp(due + 1);
        assertFalse(plans.isLate(planId), "a second past due is within grace - the live case");

        vm.warp(due + grace);
        assertFalse(plans.isLate(planId), "the last second of grace is not late");

        vm.warp(due + grace + 1);
        assertTrue(plans.isLate(planId), "one second past grace IS late");
    }

    /// @dev Paying ahead of schedule buys slack against the next due date.
    function test_payingAheadPreventsLateness() public {
        _repay(planId, 200 * ONE_USDC); // covers installments 1 and 2

        vm.warp(plans.dueDateOf(planId, 2) + 1);
        assertFalse(plans.isLate(planId), "third installment is not due yet");

        _warpPastGrace(planId, 3);
        assertTrue(plans.isLate(planId), "now the final installment is overdue");
    }

    /// @dev A partial payment does not cover an installment.
    function test_partialPaymentDoesNotCoverInstallment() public {
        _repay(planId, 99 * ONE_USDC);
        assertEq(plans.installmentsCovered(planId), 0, "99 of 100 covers nothing");

        _warpPastGrace(planId, 1);
        assertTrue(plans.isLate(planId), "short payment is still late");

        _repay(planId, 1 * ONE_USDC);
        assertEq(plans.installmentsCovered(planId), 1, "topped up to a full installment");
    }

    /// @dev Rounding dust: only the full principal closes the final installment.
    function test_dustRidesOnFinalInstallment() public {
        uint256 principal = 100 * ONE_USDC + 1;
        uint256 id = _originate(principal, 3, 0, 50);
        uint256 base = plans.installmentAmount(id); // floor(100000001/3)

        _repay(id, base * 2);
        assertEq(plans.installmentsCovered(id), 2, "two installments covered");

        // One unit short of the principal must not read as fully covered.
        _repay(id, principal - base * 2 - 1);
        assertEq(plans.installmentsCovered(id), 2, "still short by one unit");
        assertEq(uint8(plans.statusOf(id)), uint8(InstallmentPlan.Status.Active), "not settled yet");

        _repay(id, 1);
        assertEq(plans.installmentsCovered(id), 3, "final unit closes it");
        assertEq(uint8(plans.statusOf(id)), uint8(InstallmentPlan.Status.Completed));
    }

    /// @dev A settled plan is never late.
    function test_completedPlanIsNeverLate() public {
        _repay(planId, PRINCIPAL);
        vm.warp(block.timestamp + 3650 days);
        assertFalse(plans.isLate(planId), "a settled plan cannot be late");
    }

    function test_defaultRequiresLateness() public {
        vm.expectRevert();
        vm.prank(operator);
        pool.markDefault(planId);
    }

    function test_defaultedPlanCannotBeRepaid() public {
        _warpPastGrace(planId, 1);
        vm.prank(operator);
        pool.markDefault(planId);

        _fundBorrower(10 * ONE_USDC);
        vm.expectRevert(
            abi.encodeWithSelector(
                InstallmentPlan.PlanNotActive.selector, planId, InstallmentPlan.Status.Defaulted
            )
        );
        vm.prank(borrower);
        pool.repay(planId, 10 * ONE_USDC);
    }

    /// @dev Only the pool may create or mutate plans.
    function test_planMutationIsPoolOnly() public {
        vm.expectRevert(abi.encodeWithSelector(InstallmentPlan.NotPool.selector, address(this)));
        plans.create(borrower, merchant, PRINCIPAL, 3, THIRTY_DAYS, _farFutureExpiry());

        vm.expectRevert(abi.encodeWithSelector(InstallmentPlan.NotPool.selector, address(this)));
        plans.recordPayment(planId, 1);
    }
}
