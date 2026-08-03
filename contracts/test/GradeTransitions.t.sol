// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CreditLine} from "../src/CreditLine.sol";
import {KudiraPool} from "../src/KudiraPool.sol";
import {KudiraTestBase} from "./KudiraTest.base.sol";

/// @notice MANDATORY TEST 3 — grade transitions.
///
/// On-time completion raises the grade, a default lowers it, and a delinquent
/// borrower (grade < 10) is blocked from originating. The grade is Kudira's own
/// credit score, mirrored to the A-Pass `subTier`; the default penalty is a
/// downgrade, never a network-wide freeze (ARCHITECTURE.md §3.2).
contract GradeTransitionsTest is KudiraTestBase {
    uint256 internal constant PRINCIPAL = 100 * ONE_USDC;

    function setUp() public override {
        super.setUp();
        // Isolate grade mechanics from the validator rule.
        vm.prank(owner);
        pool.setRule(0, 0);
    }

    /// @dev Complete a plan fully, on time, in one payment.
    function _completeOnTime(uint256 planId) internal {
        _repay(planId, plans.outstandingOf(planId));
    }

    /// @dev Push a plan past its first due date and write it off.
    function _defaultPlan(uint256 planId) internal {
        _warpPastGrace(planId, 1);
        assertTrue(plans.isLate(planId), "plan must be late before default");
        vm.prank(operator);
        pool.markDefault(planId);
    }

    // --- Seeding --------------------------------------------------------------

    function test_accountSeedsGradeFromApassSubTier() public {
        _originate(PRINCIPAL, 2, 0, 20);
        assertEq(creditLine.gradeOf(borrower), 20, "grade seeded from A-Pass subTier");
    }

    /// @dev On-chain history is canonical: a later, staler subTier must not clobber it.
    function test_existingGradeNotClobberedByStaleApassRead() public {
        uint256 p1 = _originate(PRINCIPAL, 2, 0, 20);
        _completeOnTime(p1);
        assertEq(creditLine.gradeOf(borrower), 30, "raised to 30");

        // Backend replays a stale subTier of 20; the earned 30 must survive.
        _originate(PRINCIPAL, 2, 0, 20);
        assertEq(creditLine.gradeOf(borrower), 30, "stale read must not overwrite earned grade");
    }

    // --- Upward ---------------------------------------------------------------

    function test_onTimeCompletionRaisesGrade() public {
        uint256 planId = _originate(PRINCIPAL, 2, 0, 20);
        assertEq(creditLine.gradeOf(borrower), 20);

        _completeOnTime(planId);

        assertEq(creditLine.gradeOf(borrower), 30, "two on-time installments: +5 each");
        assertEq(creditLine.completedPlansOf(borrower), 1, "completed plan counted");
        assertEq(creditLine.outstandingOf(borrower), 0, "no outstanding after full repayment");
    }

    /// @dev A completed-but-late plan counts as history without earning a raise.
    function test_lateCompletionDoesNotRaiseGrade() public {
        uint256 planId = _originate(PRINCIPAL, 2, 0, 20);

        _warpPastGrace(planId, 1); // miss the first installment, grace included
        _repay(planId, plans.outstandingOf(planId));

        assertEq(creditLine.gradeOf(borrower), 20, "late completion must not raise the grade");
        assertEq(creditLine.completedPlansOf(borrower), 1, "still counted as completed");
    }

    function test_gradeRaiseIsCappedAtMax() public {
        uint256 planId = _originate(PRINCIPAL, 2, 0, 95);
        _completeOnTime(planId);
        assertEq(creditLine.gradeOf(borrower), creditLine.MAX_GRADE(), "capped at 99");
    }

    // --- Downward -------------------------------------------------------------

    function test_defaultLowersGrade() public {
        uint256 planId = _originate(PRINCIPAL, 2, 0, 50);
        assertEq(creditLine.gradeOf(borrower), 50);

        _defaultPlan(planId);

        assertEq(creditLine.gradeOf(borrower), 30, "default lowers by GRADE_STEP_DOWN");
        assertEq(creditLine.defaultsOf(borrower), 1, "default counted");
        assertEq(creditLine.outstandingOf(borrower), 0, "written-off balance leaves outstanding");
    }

    function test_defaultFloorsAtZeroNeverUnderflows() public {
        uint256 planId = _originate(PRINCIPAL, 2, 0, 15);
        _defaultPlan(planId);
        assertEq(creditLine.gradeOf(borrower), 0, "saturating downgrade, no underflow");
    }

    // --- Delinquency blocks new credit ---------------------------------------

    /// @dev The full ladder: 20 -> 30 (on-time) -> 10 (default) -> 0 (default) -> blocked.
    function test_delinquentBorrowerCannotOriginate() public {
        uint256 p1 = _originate(PRINCIPAL, 2, 0, 20);
        _completeOnTime(p1);
        assertEq(creditLine.gradeOf(borrower), 30);

        uint256 p2 = _originate(PRINCIPAL, 2, 0, 20);
        _defaultPlan(p2);
        assertEq(creditLine.gradeOf(borrower), 10, "still exactly at the threshold");
        assertFalse(creditLine.isDelinquent(borrower), "10 is not below the threshold");

        // Grade 10 is the boundary and must still be allowed to borrow.
        uint256 p3 = _originate(PRINCIPAL, 2, 0, 20);
        _defaultPlan(p3);
        assertEq(creditLine.gradeOf(borrower), 0, "second default drops below the threshold");
        assertTrue(creditLine.isDelinquent(borrower), "grade < 10 is delinquent");

        vm.expectRevert(abi.encodeWithSelector(KudiraPool.BorrowerDelinquent.selector, borrower, 0));
        _originate(PRINCIPAL, 2, 0, 20);
    }

    /// @dev A delinquent borrower is blocked even when their A-Pass looks pristine.
    function test_delinquencyBlocksEvenWithHighApassSubTier() public {
        uint256 planId = _originate(PRINCIPAL, 2, 0, 15);
        _defaultPlan(planId);
        assertEq(creditLine.gradeOf(borrower), 0);

        // A-Pass says 90; on-chain history says delinquent. History wins.
        vm.expectRevert(abi.encodeWithSelector(KudiraPool.BorrowerDelinquent.selector, borrower, 0));
        _originate(PRINCIPAL, 2, 0, 90);
    }

    // --- Limits follow the ladder --------------------------------------------

    function test_limitLadderMatchesSpec() public view {
        // limit = grade * 10 aUSDC, zero while delinquent.
        assertEq(creditLine.limitForGrade(0), 0, "0: delinquent, no credit");
        assertEq(creditLine.limitForGrade(9), 0, "< 10 delinquent: no credit");

        assertEq(creditLine.limitForGrade(10), 100 * ONE_USDC, "10 -> 100 aUSDC");
        assertEq(creditLine.limitForGrade(20), 200 * ONE_USDC, "20 -> 200 aUSDC");
        assertEq(creditLine.limitForGrade(50), 500 * ONE_USDC, "50 -> 500 aUSDC");
        assertEq(creditLine.limitForGrade(80), 800 * ONE_USDC, "80 -> 800 aUSDC");
        assertEq(creditLine.limitForGrade(99), 990 * ONE_USDC, "99 -> 990 aUSDC");

        // The boundary: 9 earns nothing, 10 earns the floor.
        assertEq(creditLine.limitForGrade(creditLine.DELINQUENT_THRESHOLD() - 1), 0, "just below cuts off");
        assertEq(
            creditLine.limitForGrade(creditLine.DELINQUENT_THRESHOLD()),
            uint256(creditLine.DELINQUENT_THRESHOLD()) * creditLine.LIMIT_PER_GRADE(),
            "threshold earns credit"
        );
    }

    /// @dev Grade is credited per on-time installment, not in a lump at completion.
    function test_gradeRisesPerOnTimeInstallment() public {
        uint256 planId = _originate(PRINCIPAL, 4, 0, 20);
        assertEq(creditLine.gradeOf(borrower), 20, "seeded");

        uint256 perInstallment = plans.installmentAmount(planId);
        for (uint16 i = 1; i <= 3; i++) {
            vm.warp(plans.dueDateOf(planId, i));
            _repay(planId, perInstallment);
            assertEq(
                creditLine.gradeOf(borrower), 20 + (5 * i), "each on-time installment adds GRADE_STEP_UP"
            );
        }
    }

    /// @dev Catching up several installments at once, while overdue, earns nothing.
    function test_lateCatchUpEarnsNoGrade() public {
        uint256 planId = _originate(PRINCIPAL, 4, 0, 20);
        vm.warp(plans.dueDateOf(planId, 2) + 1); // two installments overdue

        _repay(planId, plans.amountDueNow(planId));
        assertEq(creditLine.gradeOf(borrower), 20, "paying while overdue earns no grade");
    }

    function test_originationBeyondLimitReverts() public {
        // Grade 20 -> 200 aUSDC.
        uint256 limit = creditLine.limitForGrade(20);

        vm.expectRevert(abi.encodeWithSelector(KudiraPool.ExceedsCreditLimit.selector, limit + 1, limit));
        _originate(limit + 1, 2, 0, 20);
    }

    function test_outstandingReducesAvailableCredit() public {
        _originate(60 * ONE_USDC, 2, 0, 20);
        assertEq(
            creditLine.availableCredit(borrower),
            creditLine.limitForGrade(20) - 60 * ONE_USDC,
            "outstanding consumes the limit"
        );
    }

    /// @dev Only the pool may move credit state.
    function test_creditStateIsPoolOnly() public {
        vm.expectRevert(abi.encodeWithSelector(CreditLine.NotPool.selector, address(this)));
        creditLine.recordDefault(borrower, 1);

        vm.expectRevert(abi.encodeWithSelector(CreditLine.NotPool.selector, address(this)));
        creditLine.recordCompletion(borrower, true);
    }
}
