// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {InstallmentPlan} from "../src/InstallmentPlan.sol";
import {KudiraTestBase} from "./KudiraTest.base.sol";

/// @notice MANDATORY TEST 2 — no plan may outlive the credential backing it.
///
/// The final due date must fall **strictly before** the borrower's A-Pass
/// `expirationTime`. Credit is only safe while the credential is live: once it
/// expires the borrower is no longer bank-verified, wallet-bound or revocable,
/// and the loan is effectively uncollateralised.
contract ExpiryBoundedTermsTest is KudiraTestBase {
    uint16 internal constant INSTALLMENTS = 3;
    uint256 internal constant PRINCIPAL = 300 * ONE_USDC;

    function _originateWithExpiry(uint64 expiry) internal returns (uint256) {
        vm.prank(operator);
        return pool.originate(borrower, merchant, PRINCIPAL, INSTALLMENTS, THIRTY_DAYS, 0, 50, expiry);
    }

    /// @dev finalDue == start + dueEvery * installments.
    function _finalDueFor(uint64 startTime) internal pure returns (uint64) {
        return startTime + (THIRTY_DAYS * uint64(INSTALLMENTS));
    }

    /// @dev The exact boundary: expiry landing ON the final due date must revert.
    function test_revertsWhenFinalDueEqualsExpiry() public {
        uint64 finalDue = _finalDueFor(uint64(block.timestamp));

        vm.expectRevert(
            abi.encodeWithSelector(InstallmentPlan.TermsExceedApassExpiry.selector, finalDue, finalDue)
        );
        _originateWithExpiry(finalDue);
    }

    function test_revertsWhenFinalDueAfterExpiry() public {
        uint64 finalDue = _finalDueFor(uint64(block.timestamp));
        uint64 expiry = finalDue - 1; // credential dies one second early

        vm.expectRevert(
            abi.encodeWithSelector(InstallmentPlan.TermsExceedApassExpiry.selector, finalDue, expiry)
        );
        _originateWithExpiry(expiry);
    }

    function test_revertsWhenExpiryWellInsideSchedule() public {
        uint64 finalDue = _finalDueFor(uint64(block.timestamp));
        uint64 expiry = uint64(block.timestamp + 45 days); // expires mid-plan

        vm.expectRevert(
            abi.encodeWithSelector(InstallmentPlan.TermsExceedApassExpiry.selector, finalDue, expiry)
        );
        _originateWithExpiry(expiry);
    }

    /// @dev One second of daylight is enough.
    function test_succeedsWhenFinalDueIsOneSecondBeforeExpiry() public {
        uint64 finalDue = _finalDueFor(uint64(block.timestamp));
        uint256 planId = _originateWithExpiry(finalDue + 1);

        assertEq(planId, 1, "plan should be created");
        assertEq(plans.finalDueDate(planId), finalDue, "final due date");
        assertLt(plans.finalDueDate(planId), plans.getPlan(planId).apassExpirationTime, "must be strict");
    }

    function test_succeedsWithComfortableExpiry() public {
        uint256 planId = _originateWithExpiry(uint64(block.timestamp + 365 days));
        assertEq(uint8(plans.statusOf(planId)), uint8(InstallmentPlan.Status.Active));
    }

    /// @dev An already-expired credential can never support a plan.
    function test_revertsWhenExpiryAlreadyPassed() public {
        uint64 expiry = uint64(block.timestamp - 1);
        uint64 finalDue = _finalDueFor(uint64(block.timestamp));

        vm.expectRevert(
            abi.encodeWithSelector(InstallmentPlan.TermsExceedApassExpiry.selector, finalDue, expiry)
        );
        _originateWithExpiry(expiry);
    }

    /// @dev Property: acceptance is exactly `finalDue < expiry`, with no off-by-one.
    function testFuzz_boundaryIsStrict(uint64 offset) public {
        uint64 finalDue = _finalDueFor(uint64(block.timestamp));
        // Keep expiry in a sane band around the final due date.
        offset = uint64(bound(offset, 0, 720 days));
        uint64 expiry = finalDue + offset;

        if (expiry > finalDue) {
            uint256 planId = _originateWithExpiry(expiry);
            assertGt(expiry, plans.finalDueDate(planId), "accepted only when strictly later");
        } else {
            vm.expectRevert(
                abi.encodeWithSelector(InstallmentPlan.TermsExceedApassExpiry.selector, finalDue, expiry)
            );
            _originateWithExpiry(expiry);
        }
    }
}
