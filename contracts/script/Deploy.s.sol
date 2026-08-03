// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

import {CreditLine} from "../src/CreditLine.sol";
import {InstallmentPlan} from "../src/InstallmentPlan.sol";
import {KudiraPool} from "../src/KudiraPool.sol";
import {MerchantRegistry} from "../src/MerchantRegistry.sol";

/// @notice Deploys the Kudira stack to Base Sepolia and wires it together.
/// @dev Run:
///        forge script script/Deploy.s.sol:Deploy \
///          --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
///
///      The pool owner must be the address whose key will produce the EIP-191
///      `owner_signature` for `validator/grant` and `validator/register`
///      (ARCHITECTURE.md §3.3). Set POOL_OWNER to override the broadcaster.
contract Deploy is Script {
    /// @notice Base Sepolia. A misconfigured RPC must fail loudly, not deploy
    ///         a pool to the wrong network.
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;

    /// @notice aUSDC — verified live: symbol() == "aUSDC", decimals() == 6.
    /// @dev Identical address on Base and Monad (deterministic deploy).
    ///      Never assert on name(); it returns "Access USDC".
    address internal constant AUSDC = 0xaC0893567D43C3E7e6e35a72803df05416C1f20D;

    /// @notice KUSDC — Kudira's own standard A-Token, issued 2026-08-03.
    /// @dev Same gating as aUSDC (min_tier 5, min_sub_tier 0), but we hold
    ///      DEFAULT_ADMIN_ROLE and can mint, so it is the only settlement asset
    ///      we can actually supply.
    address internal constant KUSDC = 0x036BCFeB3cfE93dfc47f5A935D7f663b99ACAb1E;

    /// @dev KudiraPool.asset is IMMUTABLE. The settlement token is fixed at
    ///      construction and cannot be changed afterwards, so choosing it wrongly
    ///      costs a full redeploy plus re-credentialing and re-registration.
    ///      Override with SETTLEMENT_ASSET; defaults to KUSDC.
    error WrongChain(uint256 actual, uint256 expected);
    error AssetHasNoCode(address asset);
    error AssetWrongDecimals(address asset, uint8 decimals);

    function run()
        external
        returns (MerchantRegistry registry, CreditLine creditLine, InstallmentPlan plans, KudiraPool pool)
    {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) {
            revert WrongChain(block.chainid, BASE_SEPOLIA_CHAIN_ID);
        }
        address settlementAsset = vm.envOr("SETTLEMENT_ASSET", KUSDC);

        // A bare address with no bytecode means the RPC is pointed somewhere the
        // Cleanverse contracts were never deployed.
        if (settlementAsset.code.length == 0) revert AssetHasNoCode(settlementAsset);
        // Six decimals is load-bearing across every limit and amount. An
        // 18-decimal asset would silently misprice the entire ladder.
        uint8 assetDecimals = IERC20Metadata(settlementAsset).decimals();
        if (assetDecimals != 6) revert AssetWrongDecimals(settlementAsset, assetDecimals);

        address deployer = msg.sender;
        address poolOwner = vm.envOr("POOL_OWNER", deployer);
        // The hot underwriting key. Defaults to the owner so a deploy is never
        // left with origination bricked, but that collapses the split — set
        // POOL_OPERATOR to a separate key for any real deployment.
        address poolOperator = vm.envOr("POOL_OPERATOR", poolOwner);

        vm.startBroadcast();

        registry = new MerchantRegistry(poolOwner);

        // Satellites are deployed owned by the broadcaster (address(0) == "me")
        // so `setPool` can run in this same batch even when POOL_OWNER is a cold
        // wallet or multisig. Ownership is handed over immediately after wiring.
        creditLine = new CreditLine(address(0));
        plans = new InstallmentPlan(address(0));

        // Deployed owned by the broadcaster so setOperator can run here, then
        // handed to poolOwner below.
        pool = new KudiraPool(
            settlementAsset, address(registry), address(creditLine), address(plans), address(0)
        );
        pool.setOperator(poolOperator);
        if (pool.owner() != poolOwner) pool.transferOwnership(poolOwner);

        // Only the pool may mutate credit and plan state.
        creditLine.setPool(address(pool));
        plans.setPool(address(pool));

        if (creditLine.owner() != poolOwner) creditLine.transferOwnership(poolOwner);
        if (plans.owner() != poolOwner) plans.transferOwnership(poolOwner);

        vm.stopBroadcast();

        console.log("chainId          ", block.chainid);
        console.log("settlement asset ", settlementAsset);
        console.log("  symbol         ", IERC20Metadata(settlementAsset).symbol());
        console.log("  decimals       ", assetDecimals);
        console.log("MerchantRegistry ", address(registry));
        console.log("CreditLine       ", address(creditLine));
        console.log("InstallmentPlan  ", address(plans));
        console.log("KudiraPool       ", address(pool));
        console.log("pool.owner()     ", pool.owner());
        console.log("pool.operator()  ", pool.operator());
        if (pool.operator() == pool.owner()) {
            console.log("");
            console.log("========================================================================");
            console.log("WARNING: POOL_OPERATOR defaulted to the owner. The role split is OFF.");
            console.log("");
            console.log("  One key can now both create debt and withdraw liquidity. The whole");
            console.log("  point of the split is that 'who can create debt on this system' has");
            console.log("  a narrower answer than 'who governs it'.");
            console.log("");
            console.log("  Fix: POOL_OPERATOR=0x... forge script ... then re-run, or call");
            console.log("  setOperator() from the owner before going live.");
            console.log("========================================================================");
        } else {
            console.log("");
            console.log("Role split ACTIVE: operator originates, owner governs and signs.");
        }

        console.log("");
        console.log("Next, IN ORDER (see ARCHITECTURE.md 8.1):");
        console.log("  1. Issue an A-Pass to the pool address. The settlement asset above");
        console.log("     gates transfers on-chain for BOTH parties, so an uncredentialed");
        console.log("     pool cannot even receive its own funding:");
        console.log("       ", address(pool));
        console.log("  2. verify_apass on the pool AGAINST THE SETTLEMENT ASSET ABOVE,");
        console.log("     confirm data.code == 4, BEFORE funds move. Checking against a");
        console.log("     different A-Token proves nothing about this pool.");
        console.log("       atoken:", settlementAsset);
        console.log("  3. Issue an A-Pass to the merchant payout address and the LP address");
        console.log("  4. Fund the pool");
        console.log("  5. validator/grant, then validator/register, signed by pool.owner()");
    }
}
