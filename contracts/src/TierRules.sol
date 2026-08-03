// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title TierRules
/// @notice Mirrors the Cleanverse Validator rule comparison semantics on-chain.
/// @dev The Cleanverse validator evaluates `min_tier` / `min_sub_tier` as
///      **strictly greater than**, NOT `>=`. A wallet whose subTier exactly
///      equals `min_sub_tier` is REJECTED by the validator. A rule value of `0`
///      means "no restriction".
///
///      Kudira gates originations with the same comparison so that on-chain
///      underwriting can never approve a borrower the off-chain validator would
///      turn away. Any divergence here silently splits policy in two — see
///      ARCHITECTURE.md §3.3.
library TierRules {
    /// @param value The credential's value (A-Pass `tier` or `subTier`).
    /// @param minimum The rule threshold. `0` disables the check.
    /// @return True when the credential satisfies the rule.
    function satisfies(uint8 value, uint8 minimum) internal pure returns (bool) {
        if (minimum == 0) return true; // 0 == unrestricted
        return value > minimum; // strictly greater, never >=
    }
}
