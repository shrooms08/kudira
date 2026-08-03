// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

/// @notice Throwaway contract for Phase 2 Gate 0.
/// @dev Deliberately empty. Its only job is to be a contract address we control,
///      so we can prove Cleanverse will issue an A-Pass to one before committing
///      KudiraPool to the same assumption. No functions, no state, no value.
contract Probe {}

/// @notice Deploys the Gate 0 probe to Base Sepolia.
/// @dev Run:
///        forge script script/DeployProbe.s.sol:DeployProbe \
///          --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
///
///      This is a de-risking step, NOT the real deployment. KudiraPool stays
///      undeployed until the gate passes.
contract DeployProbe is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;

    error WrongChain(uint256 actual, uint256 expected);

    function run() external returns (Probe probe) {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) {
            revert WrongChain(block.chainid, BASE_SEPOLIA_CHAIN_ID);
        }

        vm.startBroadcast();
        probe = new Probe();
        vm.stopBroadcast();

        console.log("chainId      ", block.chainid);
        console.log("Probe        ", address(probe));
        console.log("");
        console.log("Next: node scripts/gate0-probe-apass.js", address(probe));
    }
}
