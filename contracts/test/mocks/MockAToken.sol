// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockAToken
/// @notice Test stand-in for aUSDC that mirrors its **on-chain A-Pass gating**.
///
/// @dev Verified against the live token on Base Sepolia (chainId 84532) by
///      `eth_call` simulation with state overrides:
///
///        - `transfer()` reverts with a custom error carrying ONE address: the
///          party the token objected to. An uncredentialed sender is named;
///          otherwise an uncredentialed recipient is named.
///        - The check runs **before** the balance check, so an uncredentialed
///          party never surfaces as `ERC20InsufficientBalance`. Reproduced here
///          by validating ahead of `super._update`.
///        - `/atoken/rules` for aUSDC reports `min_tier: 5`, and Cleanverse rule
///          comparisons are **strictly greater than**, so tier 5 is REJECTED and
///          tier 50 is accepted.
///
///      An unrestricted ERC20 mock cannot catch this class of failure: the suite
///      would stay green while the real deployment reverts on its first transfer.
///
///      Deliberate simplification: the real token uses a single error for the
///      "no credential" case we observed. We never observed a live
///      tier-too-low revert, so both conditions raise the same error here rather
///      than inventing a shape we have not confirmed.
contract MockAToken is ERC20 {
    /// @notice A-Pass standing for an address.
    struct Credential {
        bool issued;
        /// @dev Mirrors A-Pass `tier`. Note the real API returns this as a
        ///      string ("50") while the rule threshold is a number (5).
        uint8 tier;
    }

    /// @notice Mirrors `/atoken/rules` -> `min_tier` for aUSDC on Base.
    uint8 public minTier = 5;

    mapping(address account => Credential) public credentials;

    /// @dev Mirrors the live token's `0xa6725971(address)`. The argument is the
    ///      offending party, which is the whole diagnostic value of the error.
    error NoAPass(address offender);

    constructor() ERC20("Access USDC", "aUSDC") {}

    /// @notice aUSDC has 6 decimals. Never assume 18.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // --- Test controls --------------------------------------------------------

    /// @notice Issue an A-Pass to `account` at `tier`.
    function grantApass(address account, uint8 tier) external {
        credentials[account] = Credential({issued: true, tier: tier});
    }

    function revokeApass(address account) external {
        delete credentials[account];
    }

    function setMinTier(uint8 newMinTier) external {
        minTier = newMinTier;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    // --- Gating ---------------------------------------------------------------

    /// @notice Does this address satisfy the token's transfer rule?
    /// @dev Strictly greater than `minTier`, matching Cleanverse semantics.
    function isVerified(address account) public view returns (bool) {
        Credential storage c = credentials[account];
        if (!c.issued) return false; // no A-Pass at all
        return c.tier > minTier; // strictly greater — tier == minTier fails
    }

    /// @dev Both parties are checked before any balance movement. `address(0)`
    ///      is exempt so mint and burn stay usable in tests.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && !isVerified(from)) revert NoAPass(from);
        if (to != address(0) && !isVerified(to)) revert NoAPass(to);
        super._update(from, to, value);
    }
}
