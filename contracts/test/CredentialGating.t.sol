// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CreditLine} from "../src/CreditLine.sol";
import {InstallmentPlan} from "../src/InstallmentPlan.sol";
import {KudiraPool} from "../src/KudiraPool.sol";
import {KudiraTestBase} from "./KudiraTest.base.sol";
import {MockAToken} from "./mocks/MockAToken.sol";

/// @notice aUSDC gates transfers on-chain for BOTH sender and recipient. Every
///         address in the money path therefore needs an A-Pass in production.
///         These tests pin down what breaks when one does not have it.
///
///         Verified against the live token: the revert names the offending party
///         and fires before any balance check.
contract CredentialGatingTest is KudiraTestBase {
    uint256 internal constant PRINCIPAL = 300 * ONE_USDC;
    uint16 internal constant INSTALLMENTS = 3;

    function _notVerified(address offender) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(MockAToken.NoAPass.selector, offender);
    }

    // --- 1. Pool without a credential cannot receive LP funding ---------------

    function test_uncredentialedPoolCannotReceiveFunding() public {
        aUSDC.revokeApass(address(pool));

        aUSDC.mint(liquidityProvider, 1_000 * ONE_USDC);
        vm.prank(liquidityProvider);
        aUSDC.approve(address(pool), type(uint256).max);

        vm.expectRevert(_notVerified(address(pool)));
        vm.prank(liquidityProvider);
        pool.fund(1_000 * ONE_USDC);
    }

    // --- 2. Pool without a credential cannot pay a merchant ------------------

    function test_uncredentialedPoolCannotPayMerchant() public {
        // Pool is funded first, then loses its credential.
        aUSDC.revokeApass(address(pool));

        vm.expectRevert(_notVerified(address(pool)));
        _originate(PRINCIPAL, INSTALLMENTS, 0, 50);
    }

    // --- 3. Merchant without a credential cannot receive settlement ----------

    function test_uncredentialedMerchantBlocksOrigination() public {
        aUSDC.revokeApass(merchantPayout);

        vm.expectRevert(_notVerified(merchantPayout));
        _originate(PRINCIPAL, INSTALLMENTS, 0, 50);

        // Cleanly: nothing half-executed. Full assertions in test 7.
        assertEq(plans.planCount(), 0, "no plan created");
        assertEq(aUSDC.balanceOf(merchantPayout), 0, "merchant received nothing");
    }

    // --- 4. Borrower without a credential cannot repay -----------------------

    function test_uncredentialedBorrowerCannotRepay() public {
        uint256 planId = _originate(PRINCIPAL, INSTALLMENTS, 0, 50);

        aUSDC.mint(borrower, PRINCIPAL);
        vm.prank(borrower);
        aUSDC.approve(address(pool), type(uint256).max);

        aUSDC.revokeApass(borrower);

        vm.expectRevert(_notVerified(borrower));
        vm.prank(borrower);
        pool.repay(planId, 100 * ONE_USDC);

        // The debt stands: a revoked credential must not erase what is owed.
        assertEq(plans.outstandingOf(planId), PRINCIPAL, "plan still fully outstanding");
        assertEq(creditLine.outstandingOf(borrower), PRINCIPAL, "borrower still owes");
    }

    // --- 5. An LP without a credential cannot fund ---------------------------

    function test_uncredentialedLpCannotFund() public {
        aUSDC.mint(liquidityProvider, 1_000 * ONE_USDC);
        vm.prank(liquidityProvider);
        aUSDC.approve(address(pool), type(uint256).max);

        aUSDC.revokeApass(liquidityProvider);

        vm.expectRevert(_notVerified(liquidityProvider));
        vm.prank(liquidityProvider);
        pool.fund(1_000 * ONE_USDC);
    }

    // --- 6. The token's own min_tier boundary --------------------------------

    /// @dev `/atoken/rules` reports `min_tier: 5` and Cleanverse compares with
    ///      strictly greater than. Tier exactly 5 is REJECTED. This is the same
    ///      off-by-one as our pool rule, but enforced by the token itself.
    function test_tierExactlyAtMinimumIsRejectedByToken() public {
        assertEq(aUSDC.minTier(), 5, "mirrors the live aUSDC rule");

        aUSDC.grantApass(merchantPayout, 5); // exactly the minimum
        assertFalse(aUSDC.isVerified(merchantPayout), "tier == min_tier must fail");

        vm.expectRevert(_notVerified(merchantPayout));
        _originate(PRINCIPAL, INSTALLMENTS, 0, 50);
    }

    function test_tierOneAboveMinimumIsAcceptedByToken() public {
        aUSDC.grantApass(merchantPayout, 6); // one notch above
        assertTrue(aUSDC.isVerified(merchantPayout), "tier == min_tier + 1 must pass");

        uint256 planId = _originate(PRINCIPAL, INSTALLMENTS, 0, 50);
        assertEq(aUSDC.balanceOf(merchantPayout), PRINCIPAL, "merchant paid");
        assertEq(planId, 1);
    }

    function test_tierBelowMinimumIsRejectedByToken() public {
        aUSDC.grantApass(merchantPayout, 4);
        assertFalse(aUSDC.isVerified(merchantPayout), "tier < min_tier must fail");

        vm.expectRevert(_notVerified(merchantPayout));
        _originate(PRINCIPAL, INSTALLMENTS, 0, 50);
    }

    /// @dev Holding an A-Pass is not the same as satisfying the rule: an issued
    ///      credential below the threshold still fails.
    function test_issuedButUnderTierIsNotVerified() public view {
        assertTrue(aUSDC.isVerified(merchantPayout), "tier 50 clears min_tier 5");
    }

    // --- Fidelity to the real token ------------------------------------------

    /// @dev The live token reverts on the credential check BEFORE the balance
    ///      check, so an uncredentialed party never surfaces as an
    ///      insufficient-balance error. Without this ordering, a production
    ///      failure would be misdiagnosed as "the pool ran out of money".
    function test_credentialCheckPrecedesBalanceCheck() public {
        address broke = makeAddr("brokeAndUncredentialed");
        assertEq(aUSDC.balanceOf(broke), 0, "no balance at all");

        // Not ERC20InsufficientBalance — the credential check fires first.
        vm.expectRevert(_notVerified(broke));
        vm.prank(broke);
        aUSDC.transfer(merchantPayout, 1);
    }

    /// @dev When both parties lack a credential the sender is named, matching
    ///      what the live token did.
    function test_senderIsNamedBeforeRecipient() public {
        address senderNoPass = makeAddr("senderNoPass");
        address recipientNoPass = makeAddr("recipientNoPass");
        _credential(senderNoPass);
        aUSDC.mint(senderNoPass, 10 * ONE_USDC);
        aUSDC.revokeApass(senderNoPass);

        vm.expectRevert(_notVerified(senderNoPass));
        vm.prank(senderNoPass);
        aUSDC.transfer(recipientNoPass, 1);
    }

    /// @dev Mint and burn are exempt: address(0) is not a party.
    function test_mintToCredentialedAddressWorksAndZeroAddressIsExempt() public {
        uint256 before = aUSDC.balanceOf(borrower);
        aUSDC.mint(borrower, 5 * ONE_USDC);
        assertEq(aUSDC.balanceOf(borrower), before + 5 * ONE_USDC, "mint reaches a credentialed holder");

        // ...but minting to an uncredentialed address is still blocked, because
        // the recipient is a real party even when the sender is address(0).
        address fresh = makeAddr("freshUncredentialed");
        vm.expectRevert(_notVerified(fresh));
        aUSDC.mint(fresh, 1);
    }

    // --- 7. Origination must be ATOMIC ---------------------------------------

    /// @dev THE critical one. If the merchant payout reverts on a credential
    ///      check, no plan may exist, no credit may be drawn and no state may be
    ///      mutated. A half-executed origination would mean a borrower owing
    ///      money for goods a merchant was never paid for.
    function test_originationIsAtomicWhenMerchantPayoutReverts() public {
        // --- Capture the complete pre-state ---
        uint256 planCountBefore = plans.planCount();
        uint256 poolLiquidityBefore = pool.liquidity();
        uint256 merchantBalanceBefore = aUSDC.balanceOf(merchantPayout);
        bool accountExistedBefore = creditLine.exists(borrower);
        uint256 borrowerOutstandingBefore = creditLine.outstandingOf(borrower);
        uint8 borrowerGradeBefore = creditLine.gradeOf(borrower);
        uint32 completedBefore = creditLine.completedPlansOf(borrower);

        assertEq(planCountBefore, 0, "clean slate");
        assertFalse(accountExistedBefore, "borrower has no credit account yet");

        // --- The payout will now revert on the credential check ---
        aUSDC.revokeApass(merchantPayout);

        vm.expectRevert(_notVerified(merchantPayout));
        _originate(PRINCIPAL, INSTALLMENTS, 0, 50);

        // --- Assert the ENTIRE pre-state is restored ---
        assertEq(plans.planCount(), planCountBefore, "plan counter must not advance");
        assertEq(uint8(plans.statusOf(1)), uint8(InstallmentPlan.Status.None), "no plan record exists");
        assertEq(pool.liquidity(), poolLiquidityBefore, "pool liquidity untouched");
        assertEq(aUSDC.balanceOf(merchantPayout), merchantBalanceBefore, "merchant paid nothing");

        assertEq(creditLine.exists(borrower), accountExistedBefore, "no credit account created");
        assertEq(creditLine.outstandingOf(borrower), borrowerOutstandingBefore, "no debt drawn");
        assertEq(creditLine.gradeOf(borrower), borrowerGradeBefore, "grade untouched");
        assertEq(creditLine.completedPlansOf(borrower), completedBefore, "history untouched");

        // The counter genuinely did not advance: the next good origination is #1.
        _credential(merchantPayout);
        uint256 planId = _originate(PRINCIPAL, INSTALLMENTS, 0, 50);
        assertEq(planId, 1, "first successful plan is still id 1");
    }

    /// @dev Same atomicity guarantee on the second origination, where a credit
    ///      account and prior history already exist.
    function test_originationIsAtomicWithExistingHistory() public {
        uint256 p1 = _originate(PRINCIPAL, INSTALLMENTS, 0, 50);
        _repay(p1, PRINCIPAL);

        uint256 planCountBefore = plans.planCount();
        uint256 outstandingBefore = creditLine.outstandingOf(borrower);
        uint8 gradeBefore = creditLine.gradeOf(borrower);
        uint32 completedBefore = creditLine.completedPlansOf(borrower);
        uint256 liquidityBefore = pool.liquidity();
        uint256 availableBefore = creditLine.availableCredit(borrower);

        aUSDC.revokeApass(merchantPayout);
        vm.expectRevert(_notVerified(merchantPayout));
        _originate(PRINCIPAL, INSTALLMENTS, 0, 50);

        assertEq(plans.planCount(), planCountBefore, "no new plan");
        assertEq(creditLine.outstandingOf(borrower), outstandingBefore, "no debt drawn");
        assertEq(creditLine.gradeOf(borrower), gradeBefore, "grade untouched");
        assertEq(creditLine.completedPlansOf(borrower), completedBefore, "history untouched");
        assertEq(pool.liquidity(), liquidityBefore, "liquidity untouched");
        assertEq(creditLine.availableCredit(borrower), availableBefore, "limit untouched");
    }

    // --- Operator / owner split ----------------------------------------------

    /// @dev `owner()` is what the Cleanverse validator signature is checked
    ///      against and the key that moves liquidity, so origination lives on a
    ///      separate hot key that can do neither.
    function test_ownerCannotOriginate() public {
        vm.expectRevert(abi.encodeWithSelector(KudiraPool.NotOperator.selector, owner));
        vm.prank(owner);
        pool.originate(borrower, merchant, PRINCIPAL, INSTALLMENTS, THIRTY_DAYS, 0, 50, _farFutureExpiry());
    }

    function test_randomCallerCannotOriginate() public {
        address stranger = makeAddr("stranger");
        vm.expectRevert(abi.encodeWithSelector(KudiraPool.NotOperator.selector, stranger));
        vm.prank(stranger);
        pool.originate(borrower, merchant, PRINCIPAL, INSTALLMENTS, THIRTY_DAYS, 0, 50, _farFutureExpiry());
    }

    /// @dev The hot key must not be able to drain the pool.
    function test_operatorCannotWithdraw() public {
        vm.expectRevert();
        vm.prank(operator);
        pool.withdraw(1 * ONE_USDC, operator);
    }

    function test_operatorCannotChangePolicy() public {
        vm.expectRevert();
        vm.prank(operator);
        pool.setRule(10, 10);

        vm.expectRevert();
        vm.prank(operator);
        pool.setOperator(operator);
    }

    function test_operatorCanMarkDefault() public {
        uint256 planId = _originate(PRINCIPAL, INSTALLMENTS, 0, 50);
        _warpPastGrace(planId, 1);

        vm.expectRevert(abi.encodeWithSelector(KudiraPool.NotOperator.selector, owner));
        vm.prank(owner);
        pool.markDefault(planId);

        vm.prank(operator);
        pool.markDefault(planId);
        assertEq(uint8(plans.statusOf(planId)), uint8(InstallmentPlan.Status.Defaulted));
    }

    function test_ownerRotatesOperator() public {
        address newOperator = makeAddr("newOperator");

        vm.prank(owner);
        pool.setOperator(newOperator);
        assertEq(pool.operator(), newOperator);

        // The old key is immediately powerless.
        vm.expectRevert(abi.encodeWithSelector(KudiraPool.NotOperator.selector, operator));
        vm.prank(operator);
        pool.originate(borrower, merchant, PRINCIPAL, INSTALLMENTS, THIRTY_DAYS, 0, 50, _farFutureExpiry());

        vm.prank(newOperator);
        uint256 planId = pool.originate(
            borrower, merchant, PRINCIPAL, INSTALLMENTS, THIRTY_DAYS, 0, 50, _farFutureExpiry()
        );
        assertEq(planId, 1, "new operator can originate");
    }

    /// @dev Governance identity is unchanged by the split — the validator still
    ///      signs against owner().
    function test_ownerRemainsValidatorIdentity() public view {
        assertEq(pool.owner(), owner, "validator/grant verifies against owner()");
        assertTrue(pool.operator() != pool.owner(), "operator is a distinct key");
    }
}
