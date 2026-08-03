// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";

import {CreditLine} from "../src/CreditLine.sol";
import {InstallmentPlan} from "../src/InstallmentPlan.sol";
import {KudiraPool} from "../src/KudiraPool.sol";
import {MerchantRegistry} from "../src/MerchantRegistry.sol";
import {MockAToken} from "./mocks/MockAToken.sol";

/// @notice Derives the Phase 2 deploy checklist empirically.
///
/// Starts with NOBODY credentialed and walks the whole money path. Each hop is
/// attempted, the revert is caught, and the address the token named is recorded
/// and then credentialed so the walk can continue. The printed list is exactly
/// the set of addresses that must hold an A-Pass in production, in the order
/// settlement touches them.
///
/// This is a live check, not documentation: if a future change adds a hop
/// involving an uncredentialed address, this test fails.
contract CredentialChecklistTest is Test {
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

    uint256 internal constant ONE_USDC = 1e6;
    uint64 internal constant THIRTY_DAYS = 30 days;
    /// @dev Cleared by the token's `min_tier: 5`, strictly greater.
    uint8 internal constant GOOD_TIER = 50;

    uint256 internal step;

    function setUp() public {
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

        vm.warp(1_785_000_000);
    }

    /// @dev Decode the single address argument from NoAPass.
    function _offender(bytes memory err) internal pure returns (address) {
        require(err.length >= 36, "unexpected revert shape");
        bytes memory args = new bytes(err.length - 4);
        for (uint256 i = 0; i < args.length; i++) {
            args[i] = err[i + 4];
        }
        return abi.decode(args, (address));
    }

    function _record(address who, string memory role) internal {
        step++;
        console.log(
            string.concat(
                "  ", vm.toString(step), ". ", role, " -> needs an A-Pass  (", vm.toString(who), ")"
            )
        );
        aUSDC.grantApass(who, GOOD_TIER);
    }

    function test_moneyPathCredentialChecklist() public {
        console.log("");
        console.log("PHASE 2 DEPLOY CHECKLIST - addresses that must hold an A-Pass:");
        console.log("");

        // Hop 1: aUSDC reaches the liquidity provider at all (mint/faucet/bridge).
        while (true) {
            try aUSDC.mint(liquidityProvider, 100_000 * ONE_USDC) {
                break;
            } catch (bytes memory err) {
                _record(_offender(err), "liquidity provider (holds aUSDC)");
            }
        }

        // Hop 2: liquidity provider funds the pool.
        vm.prank(liquidityProvider);
        aUSDC.approve(address(pool), type(uint256).max);
        while (true) {
            vm.prank(liquidityProvider);
            try pool.fund(50_000 * ONE_USDC) {
                break;
            } catch (bytes memory err) {
                _record(_offender(err), "KudiraPool (receives + holds liquidity)");
            }
        }

        // Hop 3: origination pays the merchant.
        uint256 planId;
        while (true) {
            vm.prank(operator);
            try pool.originate(
                borrower,
                merchant,
                300 * ONE_USDC,
                3,
                THIRTY_DAYS,
                GOOD_TIER,
                50,
                uint64(block.timestamp + 3650 days)
            ) returns (
                uint256 id
            ) {
                planId = id;
                break;
            } catch (bytes memory err) {
                _record(_offender(err), "merchant payout address (receives settlement)");
            }
        }

        // Hop 4: the borrower acquires aUSDC to repay with.
        while (true) {
            try aUSDC.mint(borrower, 300 * ONE_USDC) {
                break;
            } catch (bytes memory err) {
                _record(_offender(err), "borrower (holds + sends repayments)");
            }
        }

        // Hop 5: the borrower repays into the pool.
        vm.prank(borrower);
        aUSDC.approve(address(pool), type(uint256).max);
        while (true) {
            vm.prank(borrower);
            try pool.repay(planId, 300 * ONE_USDC) {
                break;
            } catch (bytes memory err) {
                _record(_offender(err), "repayment counterparty");
            }
        }

        // Hop 6: the owner withdraws pool liquidity (treasury path).
        while (true) {
            vm.prank(owner);
            try pool.withdraw(1_000 * ONE_USDC, owner) {
                break;
            } catch (bytes memory err) {
                _record(_offender(err), "withdrawal destination / treasury");
            }
        }

        console.log("");
        console.log(string.concat("  Total addresses requiring an A-Pass: ", vm.toString(step)));
        console.log("");

        // Every hop completed, so the walk is a proof the list is sufficient.
        assertEq(uint8(plans.statusOf(planId)), uint8(InstallmentPlan.Status.Completed), "plan settled");
        assertEq(step, 5, "money path requires exactly 5 credentialed addresses");
    }
}
