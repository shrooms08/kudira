// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {KudiraPool} from "../src/KudiraPool.sol";
import {TierRules} from "../src/TierRules.sol";
import {KudiraTestBase} from "./KudiraTest.base.sol";

/// @notice MANDATORY TEST 1 — the `min_tier` / `min_sub_tier` off-by-one.
///
/// Cleanverse validator rules are **strictly greater than**, not `>=`. A
/// borrower whose subTier exactly equals `min_sub_tier` is REJECTED. If Kudira
/// gated on `>=` it would approve borrowers the validator turns away, splitting
/// policy between the chain and the compliance layer.
contract MinTierOffByOneTest is KudiraTestBase {
    uint8 internal constant MIN_SUB_TIER = 20;
    uint8 internal constant MIN_TIER = 50;

    // --- The boundary itself --------------------------------------------------

    /// @dev THE off-by-one: exactly equal must be rejected.
    function test_subTierEqualToMinimum_isRejected() public {
        vm.prank(owner);
        pool.setRule(0, MIN_SUB_TIER);

        assertFalse(pool.satisfiesRule(0, MIN_SUB_TIER), "subTier == min must fail the rule");

        vm.expectRevert(
            abi.encodeWithSelector(
                KudiraPool.ApassRuleNotSatisfied.selector, 0, MIN_SUB_TIER, 0, MIN_SUB_TIER
            )
        );
        _originate(100 * ONE_USDC, 2, 0, MIN_SUB_TIER);
    }

    /// @dev One above the minimum is the first accepted value.
    function test_subTierOneAboveMinimum_isAccepted() public {
        vm.prank(owner);
        pool.setRule(0, MIN_SUB_TIER);

        assertTrue(pool.satisfiesRule(0, MIN_SUB_TIER + 1), "subTier == min+1 must satisfy the rule");

        uint256 planId = _originate(100 * ONE_USDC, 2, 0, MIN_SUB_TIER + 1);
        assertEq(planId, 1, "origination should succeed one notch above the minimum");
    }

    function test_subTierBelowMinimum_isRejected() public {
        vm.prank(owner);
        pool.setRule(0, MIN_SUB_TIER);

        assertFalse(pool.satisfiesRule(0, MIN_SUB_TIER - 1), "subTier < min must fail");

        vm.expectRevert(
            abi.encodeWithSelector(
                KudiraPool.ApassRuleNotSatisfied.selector, 0, MIN_SUB_TIER - 1, 0, MIN_SUB_TIER
            )
        );
        _originate(100 * ONE_USDC, 2, 0, MIN_SUB_TIER - 1);
    }

    // --- Same semantic on `tier` ---------------------------------------------

    function test_tierEqualToMinimum_isRejected() public {
        vm.prank(owner);
        pool.setRule(MIN_TIER, 0);

        assertFalse(pool.satisfiesRule(MIN_TIER, 60), "tier == min must fail the rule");

        vm.expectRevert(
            abi.encodeWithSelector(KudiraPool.ApassRuleNotSatisfied.selector, MIN_TIER, 60, MIN_TIER, 0)
        );
        _originate(100 * ONE_USDC, 2, MIN_TIER, 60);
    }

    function test_tierOneAboveMinimum_isAccepted() public {
        vm.prank(owner);
        pool.setRule(MIN_TIER, 0);

        assertTrue(pool.satisfiesRule(MIN_TIER + 1, 60), "tier == min+1 must satisfy");
        _originate(100 * ONE_USDC, 2, MIN_TIER + 1, 60);
    }

    /// @dev Both dimensions are enforced: passing one does not excuse the other.
    function test_bothDimensionsEnforced() public {
        vm.prank(owner);
        pool.setRule(MIN_TIER, MIN_SUB_TIER);

        assertFalse(pool.satisfiesRule(MIN_TIER + 1, MIN_SUB_TIER), "subTier at min must still fail");
        assertFalse(pool.satisfiesRule(MIN_TIER, MIN_SUB_TIER + 1), "tier at min must still fail");
        assertTrue(pool.satisfiesRule(MIN_TIER + 1, MIN_SUB_TIER + 1), "both above min must pass");
    }

    // --- Zero means unrestricted ---------------------------------------------

    function test_zeroMinimumIsUnrestricted() public view {
        // Default rule is 0/0 — nothing is filtered out, including a zero value.
        assertTrue(pool.satisfiesRule(0, 0), "0 rule must not restrict");
        assertTrue(pool.satisfiesRule(99, 99), "0 rule must not restrict");
    }

    // --- The library, directly ------------------------------------------------

    function test_library_strictlyGreaterSemantics() public pure {
        assertTrue(TierRules.satisfies(0, 0), "0 minimum is unrestricted");
        assertTrue(TierRules.satisfies(1, 0), "0 minimum is unrestricted");
        assertFalse(TierRules.satisfies(20, 20), "equal must fail");
        assertFalse(TierRules.satisfies(19, 20), "below must fail");
        assertTrue(TierRules.satisfies(21, 20), "above must pass");
    }

    /// @dev Property: for any non-zero minimum, `value == minimum` is always rejected.
    function testFuzz_equalToMinimumAlwaysRejected(uint8 minimum) public pure {
        vm.assume(minimum != 0);
        assertFalse(TierRules.satisfies(minimum, minimum), "equal must never satisfy a rule");
    }

    /// @dev Property: satisfaction is exactly `value > minimum` when minimum != 0.
    function testFuzz_matchesStrictlyGreater(uint8 value, uint8 minimum) public pure {
        vm.assume(minimum != 0);
        assertEq(TierRules.satisfies(value, minimum), value > minimum, "must equal strict >");
    }
}
