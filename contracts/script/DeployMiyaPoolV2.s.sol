// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console2 } from "forge-std/Script.sol";
import { VmSafe } from "forge-std/Vm.sol";
import { ICreateX, CREATEX } from "../src/shared/CreateXConstants.sol";
import { MiyaPoolFactory } from "../src/pools/MiyaPoolFactory.sol";
import { POOL_FACTORY_LABEL } from "./DeployMiyamints.s.sol";

interface IRegistryVaults {
    function isVault(address vault) external view returns (bool);
}

/**
 * @title DeployMiyaPoolV2
 * @notice Deploys MiyaPoolFactory v2 next to an existing miyamints system: one pool per collection with random and
 *         targeted (pick) redeems whose IMD/INFER fee goes to the system's default vault. Replaces the v1
 *         factory outright (v1 has no pools on mainnet and nothing references it); there is nothing to migrate.
 *
 *         Reads deployments/<chainId>.json (registry, defaultVault, deployer). The factory goes to CreateX CREATE3 with
 *         the same deployer-permissioned salt scheme as DeployMiyamints (namespace SALT_NAMESPACE, default
 *         "miyamints.v1", label POOL_FACTORY_LABEL), so the same deployer gets the same address on
 *         every chain. Ownerless: no handoff.
 *
 *         Dry run (no transaction):
 *           FOUNDRY_PROFILE=deploy forge script script/DeployMiyaPoolV2.s.sol --rpc-url $RPC --sender <deployer>
 *         A broadcast must go through a clean release checkout (DEPLOY_GIT_COMMIT set, as script/deploy.sh does); it
 *         then records `miyaPoolFactory`, `miyaPoolFactoryGitCommit` and, if the JSON had a v1 factory,
 *         `miyaPoolFactoryV1` in deployments/<chainId>.json. It refuses if the JSON already records a v2 factory
 *         (`miyaPoolFactoryV1` set, or `miyaPoolFactory` answers `vault()`), so the real v1 is never overwritten.
 */
contract DeployMiyaPoolV2 is Script {
    error ConfigError(string reason);

    function run() external returns (address factory) {
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        string memory json = vm.readFile(path);
        address registry = vm.parseJsonAddress(json, ".registry");
        address vault = vm.envOr("POOL_VAULT", vm.parseJsonAddress(json, ".defaultVault"));
        address expectedDeployer = vm.parseJsonAddress(json, ".deployer");
        address v1 = _priorFactory(json);
        string memory ns = vm.envOr("SALT_NAMESPACE", string("miyamints.v1"));

        if (vault.code.length == 0) revert ConfigError("defaultVault has no code");
        if (!IRegistryVaults(registry).isVault(vault)) revert ConfigError("defaultVault is not a registry vault");

        bool live = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
        string memory gitCommit = vm.envOr("DEPLOY_GIT_COMMIT", string(""));
        if (live && bytes(gitCommit).length != 40) {
            revert ConfigError("broadcast only from a clean release checkout (set DEPLOY_GIT_COMMIT, as deploy.sh does)");
        }

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        if (deployer != expectedDeployer) {
            console2.log("!! deployer differs from deployments json: the factory address will differ across chains");
        }
        bytes32 salt = bytes32(
            abi.encodePacked(deployer, bytes1(0x00), bytes11(keccak256(abi.encodePacked(ns, ".", POOL_FACTORY_LABEL))))
        );
        address predicted = ICreateX(CREATEX)
            .computeCreate3Address(keccak256(abi.encodePacked(bytes32(uint256(uint160(deployer))), salt)));
        if (predicted.code.length != 0) revert ConfigError("pool factory v2 already deployed at this salt");
        factory = ICreateX(CREATEX)
            .deployCreate3(salt, abi.encodePacked(type(MiyaPoolFactory).creationCode, abi.encode(vault)));
        vm.stopBroadcast();

        if (factory != predicted) revert ConfigError("CREATE3 address mismatch");
        if (MiyaPoolFactory(factory).vault() != vault) revert ConfigError("factory.vault mismatch");
        if (MiyaPoolFactory(factory).allPoolsLength() != 0) revert ConfigError("new factory has pools");

        console2.log("MiyaPoolFactory v2 ", factory);
        console2.log("  vault            ", vault);
        console2.log("  replaces v1      ", v1);
        console2.log(
            "  app env           VITE_MIYA_POOL_FACTORY_%s=%s", vm.toString(block.chainid), vm.toString(factory)
        );

        if (live) {
            if (v1 != address(0)) vm.writeJson(_quoted(v1), path, ".miyaPoolFactoryV1");
            vm.writeJson(_quoted(factory), path, ".miyaPoolFactory");
            vm.writeJson(string.concat('"', gitCommit, '"'), path, ".miyaPoolFactoryGitCommit");
        }
    }

    /// @dev The v1 factory this one replaces, from the deployments JSON; address(0) if it has none. Refuses if the JSON
    ///      already records a v2 factory, so a second broadcast (e.g. another SALT_NAMESPACE) can't lose the real v1.
    function _priorFactory(string memory json) internal view returns (address v1) {
        if (vm.keyExistsJson(json, ".miyaPoolFactoryV1")) {
            revert ConfigError("deployments json already records miyaPoolFactoryV1: v2 is already deployed here");
        }
        if (!vm.keyExistsJson(json, ".miyaPoolFactory")) return address(0);
        v1 = vm.parseJsonAddress(json, ".miyaPoolFactory");
        // Only v2 has vault(); v1 has no fallback, so the call reverts there.
        if (v1.code.length != 0) {
            (bool ok, bytes memory ret) = v1.staticcall(abi.encodeWithSignature("vault()"));
            if (ok && ret.length == 32) {
                revert ConfigError("miyaPoolFactory in deployments json is already a v2 factory");
            }
        }
    }

    function _quoted(address a) internal pure returns (string memory) {
        return string.concat('"', vm.toString(a), '"');
    }
}
