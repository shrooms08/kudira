// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MerchantRegistry
/// @notice Merchant onboarding, payout addresses and the active flag.
/// @dev The payout address is deliberately separate from the merchant identity:
///      a merchant may rotate its treasury without losing its registration or
///      trading history.
contract MerchantRegistry is Ownable {
    struct Merchant {
        address payout;
        bool active;
        bool registered;
    }

    mapping(address merchant => Merchant) private _merchants;

    event MerchantRegistered(address indexed merchant, address indexed payout);
    event MerchantPayoutUpdated(
        address indexed merchant, address indexed oldPayout, address indexed newPayout
    );
    event MerchantActiveSet(address indexed merchant, bool active);

    error ZeroAddress();
    error AlreadyRegistered(address merchant);
    error NotRegistered(address merchant);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function register(address merchant, address payout) external onlyOwner {
        if (merchant == address(0) || payout == address(0)) revert ZeroAddress();
        if (_merchants[merchant].registered) revert AlreadyRegistered(merchant);

        _merchants[merchant] = Merchant({payout: payout, active: true, registered: true});

        emit MerchantRegistered(merchant, payout);
        emit MerchantActiveSet(merchant, true);
    }

    function setPayout(address merchant, address payout) external onlyOwner {
        if (payout == address(0)) revert ZeroAddress();
        Merchant storage m = _merchants[merchant];
        if (!m.registered) revert NotRegistered(merchant);

        address old = m.payout;
        m.payout = payout;

        emit MerchantPayoutUpdated(merchant, old, payout);
    }

    function setActive(address merchant, bool active) external onlyOwner {
        Merchant storage m = _merchants[merchant];
        if (!m.registered) revert NotRegistered(merchant);

        m.active = active;

        emit MerchantActiveSet(merchant, active);
    }

    function isRegistered(address merchant) external view returns (bool) {
        return _merchants[merchant].registered;
    }

    function isActive(address merchant) external view returns (bool) {
        return _merchants[merchant].active;
    }

    /// @notice Payout address for a registered merchant. Reverts if unknown, so
    ///         funds can never be sent to address(0) by accident.
    function payoutOf(address merchant) external view returns (address) {
        Merchant storage m = _merchants[merchant];
        if (!m.registered) revert NotRegistered(merchant);
        return m.payout;
    }

    function merchantInfo(address merchant) external view returns (Merchant memory) {
        return _merchants[merchant];
    }
}
