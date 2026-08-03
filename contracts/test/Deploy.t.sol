// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {Deploy} from "../script/Deploy.s.sol";
import {CreditLine} from "../src/CreditLine.sol";
import {InstallmentPlan} from "../src/InstallmentPlan.sol";
import {KudiraPool} from "../src/KudiraPool.sol";
import {MerchantRegistry} from "../src/MerchantRegistry.sol";
import {MockAToken} from "./mocks/MockAToken.sol";

/// @notice The deploy script must fail loudly on the wrong network. A guard
///         that is never exercised is just a comment.
contract DeployTest is Test {
    uint256 internal constant BASE_SEPOLIA = 84532;
    address internal constant AUSDC = 0xaC0893567D43C3E7e6e35a72803df05416C1f20D;
    /// @dev The deploy script's DEFAULT settlement asset. KudiraPool.asset is
    ///      immutable, so this choice is permanent per deployment.
    address internal constant KUSDC = 0x036BCFeB3cfE93dfc47f5A935D7f663b99ACAb1E;

    Deploy internal script;

    function setUp() public {
        script = new Deploy();
    }

    /// @dev Put bytecode at the settlement asset address so the check passes.
    function _etchAsset(address at) internal {
        MockAToken mock = new MockAToken();
        vm.etch(at, address(mock).code);
    }

    function test_revertsOnEthereumMainnet() public {
        vm.chainId(1);
        vm.expectRevert(abi.encodeWithSelector(Deploy.WrongChain.selector, 1, BASE_SEPOLIA));
        script.run();
    }

    function test_revertsOnMonadTestnet() public {
        // Monad is an optional bonus target, never the default (ARCHITECTURE.md §0.1).
        vm.chainId(10143);
        vm.expectRevert(abi.encodeWithSelector(Deploy.WrongChain.selector, 10143, BASE_SEPOLIA));
        script.run();
    }

    function test_revertsOnBaseMainnet() public {
        vm.chainId(8453);
        vm.expectRevert(abi.encodeWithSelector(Deploy.WrongChain.selector, 8453, BASE_SEPOLIA));
        script.run();
    }

    /// @dev Right chainId but an RPC where the Cleanverse contracts do not exist.
    function test_revertsWhenAssetHasNoCode() public {
        vm.chainId(BASE_SEPOLIA);
        vm.expectRevert(abi.encodeWithSelector(Deploy.AssetHasNoCode.selector, KUSDC));
        script.run();
    }

    /// @dev The settlement asset is overridable, because asset is immutable and
    ///      getting it wrong costs a redeploy plus re-credentialing.
    function test_settlementAssetIsOverridable() public {
        vm.chainId(BASE_SEPOLIA);
        _etchAsset(AUSDC);
        vm.setEnv("SETTLEMENT_ASSET", vm.toString(AUSDC));

        (,,, KudiraPool pool) = script.run();
        assertEq(address(pool.asset()), AUSDC, "override honoured");
        vm.setEnv("SETTLEMENT_ASSET", "");
    }

    /// @dev Six decimals is load-bearing. An 18-decimal asset would misprice
    ///      every limit in the ladder, so the deploy must refuse it.
    function test_revertsOnWrongDecimals() public {
        vm.chainId(BASE_SEPOLIA);
        WrongDecimalsToken bad = new WrongDecimalsToken();
        vm.etch(KUSDC, address(bad).code);

        vm.expectRevert(abi.encodeWithSelector(Deploy.AssetWrongDecimals.selector, KUSDC, uint8(18)));
        script.run();
    }

    function test_deploysAndWiresOnBaseSepolia() public {
        vm.chainId(BASE_SEPOLIA);
        _etchAsset(KUSDC);

        (MerchantRegistry registry, CreditLine creditLine, InstallmentPlan plans, KudiraPool pool) =
            script.run();

        assertEq(address(pool.asset()), KUSDC, "pool settles in KUSDC by default");
        assertEq(address(pool.merchants()), address(registry));
        assertEq(address(pool.creditLine()), address(creditLine));
        assertEq(address(pool.plans()), address(plans));

        // Only the pool may mutate credit and plan state.
        assertEq(creditLine.pool(), address(pool), "credit line wired to pool");
        assertEq(plans.pool(), address(pool), "plans wired to pool");

        // The validator signs against this.
        assertEq(pool.owner(), address(this), "pool owner defaults to the broadcaster");
        assertEq(pool.operator(), address(this), "operator defaults to the owner when unset");
        assertEq(creditLine.owner(), address(this));
        assertEq(plans.owner(), address(this));
        assertEq(registry.owner(), address(this));
    }
}

/// @notice An 18-decimal stand-in, used to prove the deploy guard rejects it.
contract WrongDecimalsToken {
    function decimals() external pure returns (uint8) {
        return 18;
    }
}
