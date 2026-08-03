// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {InstallmentPlan} from "../src/InstallmentPlan.sol";
import {KudiraPool} from "../src/KudiraPool.sol";
import {KudiraTestBase} from "./KudiraTest.base.sol";

/// @notice MANDATORY TEST 4 — the full default path.
///
/// Originate, merchant paid in full immediately, every installment repaid on
/// schedule, grade raised. This is the flow the demo walks through.
contract HappyPathTest is KudiraTestBase {
    uint256 internal constant PRINCIPAL = 300 * ONE_USDC; // 300 aUSDC
    uint16 internal constant INSTALLMENTS = 3; // 100 aUSDC each
    uint8 internal constant APASS_TIER = 50;
    uint8 internal constant APASS_SUB_TIER = 50;

    function test_fullHappyPath() public {
        uint256 poolLiquidityBefore = pool.liquidity();
        assertEq(aUSDC.balanceOf(merchantPayout), 0, "merchant starts with nothing");

        // --- Originate --------------------------------------------------------
        vm.expectEmit(true, true, true, true, address(pool));
        emit KudiraPool.MerchantPaid(1, merchant, merchantPayout, PRINCIPAL);

        uint256 planId = _originate(PRINCIPAL, INSTALLMENTS, APASS_TIER, APASS_SUB_TIER);
        assertEq(planId, 1, "first plan");

        // --- Merchant is paid in full, up front -------------------------------
        assertEq(aUSDC.balanceOf(merchantPayout), PRINCIPAL, "merchant paid the full principal");
        assertEq(pool.liquidity(), poolLiquidityBefore - PRINCIPAL, "principal left the pool");

        // --- Plan and credit state --------------------------------------------
        InstallmentPlan.Plan memory p = plans.getPlan(planId);
        assertEq(p.borrower, borrower);
        assertEq(p.merchant, merchant);
        assertEq(p.principal, PRINCIPAL);
        assertEq(p.installments, INSTALLMENTS);
        assertEq(uint8(p.status), uint8(InstallmentPlan.Status.Active), "plan active");
        assertEq(plans.installmentAmount(planId), 100 * ONE_USDC, "100 aUSDC per installment");
        assertEq(creditLine.gradeOf(borrower), APASS_SUB_TIER, "grade seeded from subTier");
        assertEq(creditLine.outstandingOf(borrower), PRINCIPAL, "full principal outstanding");

        // --- Repay every installment, each before its due date ------------------
        uint256 perInstallment = plans.installmentAmount(planId);
        for (uint16 i = 1; i <= INSTALLMENTS; i++) {
            uint64 due = plans.dueDateOf(planId, i);
            vm.warp(due - 1 days); // pay a day early, every time
            assertFalse(plans.isLate(planId), "never late on the happy path");

            _repay(planId, perInstallment);

            assertEq(plans.installmentsCovered(planId), i, "installment counted");
        }

        // --- Settled ----------------------------------------------------------
        assertEq(uint8(plans.statusOf(planId)), uint8(InstallmentPlan.Status.Completed), "plan completed");
        assertEq(plans.outstandingOf(planId), 0, "plan fully repaid");
        assertFalse(plans.wasEverLate(planId), "completed on time");

        // --- Grade raised, books balanced -------------------------------------
        assertEq(creditLine.outstandingOf(borrower), 0, "borrower owes nothing");
        assertEq(creditLine.completedPlansOf(borrower), 1, "one completed plan");
        assertEq(creditLine.defaultsOf(borrower), 0, "no defaults");
        assertEq(creditLine.gradeOf(borrower), APASS_SUB_TIER + 15, "3 on-time installments: +5 each");
        assertEq(pool.liquidity(), poolLiquidityBefore, "pool made whole");
    }

    /// @dev Rounding dust rides on the final installment; the plan still settles exactly.
    function test_happyPathWithIndivisiblePrincipal() public {
        uint256 principal = 100 * ONE_USDC + 1; // 3 installments, 1 unit of dust
        uint256 planId = _originate(principal, 3, APASS_TIER, APASS_SUB_TIER);

        uint256 base = plans.installmentAmount(planId);
        assertEq(base, (100 * ONE_USDC + 1) / 3, "base installment floors");

        _repay(planId, base);
        _repay(planId, base);
        _repay(planId, plans.outstandingOf(planId)); // final absorbs the dust

        assertEq(uint8(plans.statusOf(planId)), uint8(InstallmentPlan.Status.Completed));
        assertEq(creditLine.outstandingOf(borrower), 0, "no residue");
        assertEq(aUSDC.balanceOf(merchantPayout), principal, "merchant got every unit");
    }

    /// @dev A second plan draws on the raised grade and larger limit.
    function test_repeatBorrowerGetsHigherLimit() public {
        uint256 p1 = _originate(PRINCIPAL, INSTALLMENTS, APASS_TIER, APASS_SUB_TIER);
        _repay(p1, plans.outstandingOf(p1));

        assertEq(creditLine.gradeOf(borrower), 65, "3 on-time installments: +5 each");
        assertEq(
            creditLine.availableCredit(borrower),
            creditLine.limitForGrade(65),
            "limit tracks the raised grade"
        );

        uint256 p2 = _originate(500 * ONE_USDC, 5, APASS_TIER, APASS_SUB_TIER);
        assertEq(p2, 2, "second plan");
        assertEq(aUSDC.balanceOf(merchantPayout), PRINCIPAL + 500 * ONE_USDC, "merchant paid for both");
    }

    // --- Guards along the money path -----------------------------------------

    function test_inactiveMerchantCannotBePaid() public {
        vm.prank(owner);
        registry.setActive(merchant, false);

        vm.expectRevert(abi.encodeWithSelector(KudiraPool.MerchantNotActive.selector, merchant));
        _originate(PRINCIPAL, INSTALLMENTS, APASS_TIER, APASS_SUB_TIER);
    }

    function test_originationRequiresLiquidity() public {
        // Drain the pool, leaving less than the principal.
        uint256 available = pool.liquidity();
        vm.prank(owner);
        pool.withdraw(available, owner);

        vm.expectRevert(abi.encodeWithSelector(KudiraPool.InsufficientLiquidity.selector, PRINCIPAL, 0));
        _originate(PRINCIPAL, INSTALLMENTS, APASS_TIER, APASS_SUB_TIER);
    }

    function test_onlyOwnerCanOriginate() public {
        vm.expectRevert();
        vm.prank(borrower);
        pool.originate(
            borrower,
            merchant,
            PRINCIPAL,
            INSTALLMENTS,
            THIRTY_DAYS,
            APASS_TIER,
            APASS_SUB_TIER,
            _farFutureExpiry()
        );
    }

    function test_cannotOverpayAPlan() public {
        uint256 planId = _originate(PRINCIPAL, INSTALLMENTS, APASS_TIER, APASS_SUB_TIER);
        _fundBorrower(PRINCIPAL + 1);

        vm.expectRevert(
            abi.encodeWithSelector(
                InstallmentPlan.PaymentExceedsOutstanding.selector, PRINCIPAL + 1, PRINCIPAL
            )
        );
        vm.prank(borrower);
        pool.repay(planId, PRINCIPAL + 1);
    }

    function test_cannotRepayASettledPlan() public {
        uint256 planId = _originate(PRINCIPAL, INSTALLMENTS, APASS_TIER, APASS_SUB_TIER);
        _repay(planId, PRINCIPAL);
        _fundBorrower(1);

        vm.expectRevert(
            abi.encodeWithSelector(
                InstallmentPlan.PlanNotActive.selector, planId, InstallmentPlan.Status.Completed
            )
        );
        vm.prank(borrower);
        pool.repay(planId, 1);
    }

    /// @dev The Ownable surface the Cleanverse validator signs against.
    function test_poolExposesOwner() public view {
        assertEq(pool.owner(), owner, "validator/grant verifies against owner()");
    }
}
