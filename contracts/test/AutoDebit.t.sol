// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {InstallmentPlan} from "../src/InstallmentPlan.sol";
import {KudiraPool} from "../src/KudiraPool.sol";
import {KudiraTestBase} from "./KudiraTest.base.sol";
import {MockAToken} from "./mocks/MockAToken.sol";

/// @notice Auto-debit (option B): the borrower approves the pool once at
///         signing, and the pool pulls each installment as it falls due.
///
/// The failure modes matter more than the happy path. A pull that fires early,
/// double-collects, or silently takes the wrong amount is worse than one that
/// does not fire at all, so every one of them reverts with a named error.
contract AutoDebitTest is KudiraTestBase {
    uint256 internal constant PRINCIPAL = 300 * ONE_USDC;
    uint16 internal constant INSTALLMENTS = 3;
    uint256 internal constant PER_INSTALLMENT = 100 * ONE_USDC;

    uint256 internal planId;

    function setUp() public override {
        super.setUp();
        planId = _originate(PRINCIPAL, INSTALLMENTS, 0, 50);
        // The borrower funds themselves and approves once, at signing.
        aUSDC.mint(borrower, PRINCIPAL);
        vm.prank(borrower);
        aUSDC.approve(address(pool), PRINCIPAL);
    }

    function _notVerified(address offender) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(MockAToken.NoAPass.selector, offender);
    }

    // --- Successful pull ------------------------------------------------------

    function test_operatorCollectsWhenDue() public {
        vm.warp(plans.dueDateOf(planId, 1));
        assertEq(plans.amountDueNow(planId), PER_INSTALLMENT, "one installment due");

        uint256 poolBefore = pool.liquidity();

        vm.expectEmit(true, true, true, true, address(pool));
        emit KudiraPool.AutoDebited(planId, borrower, operator, PER_INSTALLMENT);

        vm.prank(operator);
        uint256 collected = pool.collect(planId);

        assertEq(collected, PER_INSTALLMENT, "collected one installment");
        assertEq(pool.liquidity(), poolBefore + PER_INSTALLMENT, "funds landed in the pool");
        assertEq(plans.installmentsCovered(planId), 1, "installment counted");
        assertEq(creditLine.outstandingOf(borrower), PRINCIPAL - PER_INSTALLMENT, "debt reduced");
    }

    /// @dev The manual trigger for the demo: the borrower pulls their own payment.
    function test_borrowerCanTriggerTheirOwnCollection() public {
        vm.warp(plans.dueDateOf(planId, 1));

        vm.prank(borrower);
        uint256 collected = pool.collect(planId);

        assertEq(collected, PER_INSTALLMENT);
        assertEq(plans.installmentsCovered(planId), 1);
    }

    function test_nobodyElseCanTriggerCollection() public {
        vm.warp(plans.dueDateOf(planId, 1));
        address stranger = makeAddr("stranger");

        vm.expectRevert(abi.encodeWithSelector(KudiraPool.NotCollector.selector, stranger, borrower));
        vm.prank(stranger);
        pool.collect(planId);
    }

    /// @dev A missed installment is collected together with the current one.
    function test_collectsEverythingOverdueAtOnce() public {
        vm.warp(plans.dueDateOf(planId, 2));
        assertEq(plans.amountDueNow(planId), 2 * PER_INSTALLMENT, "two installments elapsed");

        vm.prank(operator);
        assertEq(pool.collect(planId), 2 * PER_INSTALLMENT, "catches up in one pull");
        assertEq(plans.installmentsCovered(planId), 2);
    }

    /// @dev Collecting the final installment settles the plan and raises the grade.
    function test_finalCollectionSettlesPlan() public {
        for (uint16 i = 1; i <= INSTALLMENTS; i++) {
            vm.warp(plans.dueDateOf(planId, i));
            vm.prank(operator);
            pool.collect(planId);
        }

        assertEq(uint8(plans.statusOf(planId)), uint8(InstallmentPlan.Status.Completed), "settled");
        assertEq(creditLine.outstandingOf(borrower), 0, "debt cleared");
        assertEq(creditLine.gradeOf(borrower), 65, "3 on-time installments: +5 each");
    }

    // --- Pull before the due date --------------------------------------------

    function test_collectBeforeFirstDueDateReverts() public {
        assertEq(plans.amountDueNow(planId), 0, "nothing due at origination");

        vm.expectRevert(
            abi.encodeWithSelector(KudiraPool.NothingDueYet.selector, planId, plans.dueDateOf(planId, 1))
        );
        vm.prank(operator);
        pool.collect(planId);
    }

    /// @dev One second before the due date is still too early.
    function test_collectOneSecondEarlyReverts() public {
        vm.warp(plans.dueDateOf(planId, 1) - 1);

        vm.expectRevert(
            abi.encodeWithSelector(KudiraPool.NothingDueYet.selector, planId, plans.dueDateOf(planId, 1))
        );
        vm.prank(operator);
        pool.collect(planId);
    }

    /// @dev No double-collection: pulling twice in the same period reverts.
    function test_secondCollectInSamePeriodReverts() public {
        vm.warp(plans.dueDateOf(planId, 1));
        vm.prank(operator);
        pool.collect(planId);

        vm.expectRevert(
            abi.encodeWithSelector(KudiraPool.NothingDueYet.selector, planId, plans.dueDateOf(planId, 2))
        );
        vm.prank(operator);
        pool.collect(planId);
    }

    /// @dev A borrower who paid ahead manually is not debited again.
    function test_payingAheadPreventsCollection() public {
        _repay(planId, 2 * PER_INSTALLMENT);

        vm.warp(plans.dueDateOf(planId, 1));
        vm.expectRevert(
            abi.encodeWithSelector(KudiraPool.NothingDueYet.selector, planId, plans.dueDateOf(planId, 3))
        );
        vm.prank(operator);
        pool.collect(planId);
    }

    function test_collectOnSettledPlanReverts() public {
        _repay(planId, PRINCIPAL);
        vm.warp(plans.dueDateOf(planId, 1));

        vm.expectRevert(abi.encodeWithSelector(KudiraPool.NothingDueYet.selector, planId, uint64(0)));
        vm.prank(operator);
        pool.collect(planId);
    }

    // --- Insufficient allowance ----------------------------------------------

    function test_insufficientAllowanceReverts() public {
        vm.prank(borrower);
        aUSDC.approve(address(pool), PER_INSTALLMENT - 1); // one unit short

        vm.warp(plans.dueDateOf(planId, 1));

        vm.expectRevert(
            abi.encodeWithSelector(
                KudiraPool.InsufficientAllowance.selector, borrower, PER_INSTALLMENT - 1, PER_INSTALLMENT
            )
        );
        vm.prank(operator);
        pool.collect(planId);
    }

    function test_revokedAllowanceReverts() public {
        vm.prank(borrower);
        aUSDC.approve(address(pool), 0); // borrower revokes consent

        vm.warp(plans.dueDateOf(planId, 1));

        vm.expectRevert(
            abi.encodeWithSelector(KudiraPool.InsufficientAllowance.selector, borrower, 0, PER_INSTALLMENT)
        );
        vm.prank(operator);
        pool.collect(planId);
    }

    /// @dev An allowance covering only part of a catch-up still reverts rather
    ///      than collecting a partial amount.
    function test_allowanceTooSmallForCatchUpReverts() public {
        vm.prank(borrower);
        aUSDC.approve(address(pool), PER_INSTALLMENT);

        vm.warp(plans.dueDateOf(planId, 2)); // two installments due

        vm.expectRevert(
            abi.encodeWithSelector(
                KudiraPool.InsufficientAllowance.selector, borrower, PER_INSTALLMENT, 2 * PER_INSTALLMENT
            )
        );
        vm.prank(operator);
        pool.collect(planId);
    }

    // --- Credential revoked on either side -----------------------------------

    /// @dev aUSDC gates both parties, so losing a credential stops collection.
    ///      The debt is untouched: revocation must not erase what is owed.
    function test_revokedBorrowerCredentialReverts() public {
        vm.warp(plans.dueDateOf(planId, 1));
        aUSDC.revokeApass(borrower);

        vm.expectRevert(_notVerified(borrower));
        vm.prank(operator);
        pool.collect(planId);

        assertEq(creditLine.outstandingOf(borrower), PRINCIPAL, "debt stands");
        assertEq(plans.outstandingOf(planId), PRINCIPAL, "plan untouched");
    }

    function test_revokedPoolCredentialReverts() public {
        vm.warp(plans.dueDateOf(planId, 1));
        aUSDC.revokeApass(address(pool));

        vm.expectRevert(_notVerified(address(pool)));
        vm.prank(operator);
        pool.collect(planId);

        assertEq(creditLine.outstandingOf(borrower), PRINCIPAL, "debt stands");
    }

    /// @dev A borrower downgraded to the token's min_tier boundary cannot be
    ///      debited — the Gate 1 concern, enforced here.
    function test_borrowerAtMinTierBoundaryCannotBeDebited() public {
        vm.warp(plans.dueDateOf(planId, 1));
        aUSDC.grantApass(borrower, 5); // exactly min_tier, strictly-greater fails

        vm.expectRevert(_notVerified(borrower));
        vm.prank(operator);
        pool.collect(planId);
    }

    // --- Schedule views -------------------------------------------------------

    function test_amountDueNowTracksTheSchedule() public {
        assertEq(plans.amountDueNow(planId), 0, "nothing due at start");
        assertEq(plans.installmentsElapsed(planId), 0);

        vm.warp(plans.dueDateOf(planId, 1));
        assertEq(plans.installmentsElapsed(planId), 1);
        assertEq(plans.amountDueNow(planId), PER_INSTALLMENT);

        vm.warp(plans.dueDateOf(planId, 3));
        assertEq(plans.installmentsElapsed(planId), 3);
        assertEq(plans.amountDueNow(planId), PRINCIPAL, "whole principal due at the end");

        vm.warp(plans.dueDateOf(planId, 3) + 3650 days);
        assertEq(plans.installmentsElapsed(planId), INSTALLMENTS, "never exceeds the schedule");
        assertEq(plans.amountDueNow(planId), PRINCIPAL);
    }
}
