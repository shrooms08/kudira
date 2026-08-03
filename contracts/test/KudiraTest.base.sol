// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {CreditLine} from "../src/CreditLine.sol";
import {InstallmentPlan} from "../src/InstallmentPlan.sol";
import {KudiraPool} from "../src/KudiraPool.sol";
import {MerchantRegistry} from "../src/MerchantRegistry.sol";
import {MockAToken} from "./mocks/MockAToken.sol";

/// @notice Shared fixture: a wired-up Kudira deployment over a 6-decimal mock
///         aUSDC that mirrors the real token's on-chain A-Pass gating.
abstract contract KudiraTestBase is Test {
    MockAToken internal aUSDC;
    MerchantRegistry internal registry;
    CreditLine internal creditLine;
    InstallmentPlan internal plans;
    KudiraPool internal pool;

    address internal owner = makeAddr("owner");
    address internal operator = makeAddr("operator");
    address internal borrower = makeAddr("borrower");
    address internal merchant = makeAddr("merchant");
    address internal merchantPayout = makeAddr("merchantPayout");
    address internal liquidityProvider = makeAddr("liquidityProvider");

    /// @dev aUSDC has 6 decimals.
    uint256 internal constant ONE_USDC = 1e6;
    uint64 internal constant THIRTY_DAYS = 30 days;
    /// @dev Clears the token's `min_tier: 5` (strictly greater).
    uint8 internal constant CREDENTIAL_TIER = 50;

    function setUp() public virtual {
        aUSDC = new MockAToken();

        vm.startPrank(owner);
        registry = new MerchantRegistry(owner);
        creditLine = new CreditLine(owner);
        plans = new InstallmentPlan(owner);
        pool = new KudiraPool(address(aUSDC), address(registry), address(creditLine), address(plans), owner);

        creditLine.setPool(address(pool));
        plans.setPool(address(pool));
        registry.register(merchant, merchantPayout);
        pool.setOperator(operator);
        vm.stopPrank();

        // Every party on the money path holds an A-Pass. aUSDC gates transfers
        // on-chain for BOTH sender and recipient, so an uncredentialed address
        // anywhere in the path reverts before any balance moves. This list is
        // the Phase 2 deploy checklist — see CredentialChecklist.t.sol.
        _credential(liquidityProvider); // funds the pool
        _credential(address(pool)); // holds liquidity, pays out, receives repayments
        _credential(merchantPayout); // receives settlement
        _credential(borrower); // sends repayments
        _credential(owner); // withdrawal destination

        // Start at a realistic timestamp so `block.timestamp` arithmetic and
        // A-Pass expiries are not fighting a near-zero clock.
        vm.warp(1_785_000_000);

        _fundPool(100_000 * ONE_USDC);
    }

    /// @dev Issue an A-Pass clearing the token's min_tier.
    function _credential(address who) internal {
        aUSDC.grantApass(who, CREDENTIAL_TIER);
    }

    function _fundPool(uint256 amount) internal {
        aUSDC.mint(liquidityProvider, amount);
        vm.startPrank(liquidityProvider);
        aUSDC.approve(address(pool), amount);
        pool.fund(amount);
        vm.stopPrank();
    }

    /// @dev Warp to the first moment installment `i` is genuinely late: past its
    ///      due date AND past the grace window. Tests that used `dueDate + 1`
    ///      were encoding the one-second-window bug, where any delay at all
    ///      counted as late.
    function _warpPastGrace(uint256 planId, uint16 i) internal {
        vm.warp(plans.dueDateOf(planId, i) + plans.gracePeriodOf(planId) + 1);
    }

    /// @dev An expiry comfortably beyond any schedule used in tests.
    function _farFutureExpiry() internal view returns (uint64) {
        return uint64(block.timestamp + 3650 days);
    }

    function _originate(uint256 principal, uint16 installments, uint8 tier, uint8 subTier)
        internal
        returns (uint256 planId)
    {
        vm.prank(operator);
        planId = pool.originate(
            borrower, merchant, principal, installments, THIRTY_DAYS, tier, subTier, _farFutureExpiry()
        );
    }

    /// @dev Mint to the borrower and approve the pool, without repaying.
    ///      Kept separate from `_repay` so a test can `vm.expectRevert` against
    ///      the `repay` call itself rather than the mint that precedes it.
    function _fundBorrower(uint256 amount) internal {
        aUSDC.mint(borrower, amount);
        vm.prank(borrower);
        aUSDC.approve(address(pool), amount);
    }

    /// @dev Fund the borrower and repay `amount` against a plan.
    function _repay(uint256 planId, uint256 amount) internal {
        _fundBorrower(amount);
        vm.prank(borrower);
        pool.repay(planId, amount);
    }
}
