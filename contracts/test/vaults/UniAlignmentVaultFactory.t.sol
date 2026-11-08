// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "solady/auth/Ownable.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {UniAlignmentVault} from "../../src/vaults/uni/UniAlignmentVault.sol";
import {UniAlignmentVaultFactory} from "../../src/vaults/uni/UniAlignmentVaultFactory.sol";
import {RouteHop, HOP_V3, HOP_V4} from "../../src/vaults/uni/IVaultRoutes.sol";
import {IMiyaRegistry} from "../../src/registry/interfaces/IMiyaRegistry.sol";
import {MiyaRegistry} from "../../src/registry/MiyaRegistry.sol";
import {VaultTestBase} from "./VaultTestBase.sol";

contract UniAlignmentVaultFactoryTest is VaultTestBase {
    event RouteSet(address indexed token, RouteHop[] hops);
    event VaultDeployed(address indexed vault, uint256 indexed alignmentTargetId);

    function _salt(bytes11 tag) internal view returns (bytes32) {
        return bytes32(abi.encodePacked(address(factory), bytes1(0x00), tag));
    }

    // ── deployVault ─────────────────────────────────────────────────────────

    function test_deployVault_configuresAndRegisters() public {
        bytes32 salt = _salt(bytes11("v1"));
        address predicted = factory.computeVaultAddress(salt);
        UniAlignmentVault v = UniAlignmentVault(payable(factory.deployVault(salt, 0)));
        assertEq(address(v), predicted);
        assertTrue(registry.isVault(address(v)));
        assertEq(v.owner(), address(factory));
        assertEq(address(v.poolManager()), POOL_MANAGER);
        assertEq(v.zRouter(), address(router));
        assertEq(address(v.registry()), address(registry));
        assertEq(address(v.routes()), address(factory));
        assertEq(v.infer(), INFER_ADDR);
        assertEq(v.imd(), IMD_ADDR);
        assertEq(v.alignmentTargetId(), 0);
        PoolKey memory k = v.alignmentPoolKey();
        assertEq(Currency.unwrap(k.currency0), INFER_ADDR);
        assertEq(Currency.unwrap(k.currency1), IMD_ADDR);
        assertEq(k.fee, 12500);
        assertEq(k.tickSpacing, 60);
        assertEq(address(k.hooks), HOOK);
        assertEq(v.protocolTreasury(), treasury);
    }

    function test_deployVault_onlyOwner() public {
        bytes32 salt = _salt(bytes11("v1"));
        vm.prank(alice);
        vm.expectRevert(Ownable.Unauthorized.selector);
        factory.deployVault(salt, 0);
    }

    function test_deployVault_saltMustBeBoundToFactory() public {
        vm.expectRevert(UniAlignmentVaultFactory.InvalidVaultSalt.selector);
        factory.deployVault(bytes32(uint256(1)), 0);
        bytes32 bad = bytes32(abi.encodePacked(address(factory), bytes1(0x01), bytes11("x")));
        vm.expectRevert(UniAlignmentVaultFactory.InvalidVaultSalt.selector);
        factory.computeVaultAddress(bad);
    }

    function test_deployVault_needsRegistration() public {
        registry.setVaultFactory(address(factory), false);
        bytes32 salt = _salt(bytes11("v1"));
        vm.expectRevert(MiyaRegistry.NotVaultFactory.selector);
        factory.deployVault(salt, 0);
    }

    function test_deployVault_badPoolKeyReverts() public {
        PoolKey memory k = key;
        k.hooks = IHooks(address(0x1000000000000000000000000000000000000040)); // afterSwap
        UniAlignmentVaultFactory f = new UniAlignmentVaultFactory(
            IMiyaRegistry(address(registry)), IPoolManager(POOL_MANAGER), address(router), INFER_ADDR, IMD_ADDR, k
        );
        registry.setVaultFactory(address(f), true);
        bytes32 salt = bytes32(abi.encodePacked(address(f), bytes1(0x00), bytes11("v")));
        vm.expectRevert(UniAlignmentVault.InvalidPoolKey.selector);
        f.deployVault(salt, 0);
    }

    function test_implementation_cannotBeInitialized() public {
        UniAlignmentVault impl = UniAlignmentVault(payable(factory.vaultImplementation()));
        vm.expectRevert(Ownable.AlreadyInitialized.selector);
        impl.disableInitializer();
    }

    function test_vaults_shareTheRouteTable() public {
        UniAlignmentVault v1 = UniAlignmentVault(payable(factory.deployVault(_salt(bytes11("a")), 0)));
        UniAlignmentVault v2 = UniAlignmentVault(payable(factory.deployVault(_salt(bytes11("b")), 0)));
        assertEq(address(v1.routes()), address(v2.routes()));
        assertTrue(factory.hasRoute(USDC_ADDR));
    }

    // ── routes ──────────────────────────────────────────────────────────────

    function test_specRoutes() public view {
        RouteHop[] memory r = factory.getRoute(CBBTC_ADDR);
        assertEq(r.length, 2);
        assertEq(r[0].kind, HOP_V3);
        assertEq(r[0].tokenIn, CBBTC_ADDR);
        assertEq(r[0].tokenOut, ETH);
        assertEq(r[0].fee, 3000);
        assertEq(r[1].kind, HOP_V4);
        assertEq(r[1].tokenOut, IMD_ADDR);
        assertEq(r[1].fee, 10000);
        assertEq(r[1].tickSpacing, 200);
        assertEq(factory.getRoute(ETH).length, 1);
        assertFalse(factory.hasRoute(IMD_ADDR));
        assertFalse(factory.hasRoute(INFER_ADDR));
        assertEq(factory.routedTokens().length, 5);
    }

    function test_setRoute_onlyOwner() public {
        RouteHop[] memory r = new RouteHop[](1);
        r[0] = _hop(HOP_V4, ETH, IMD_ADDR, 3000, 60);
        vm.prank(alice);
        vm.expectRevert(Ownable.Unauthorized.selector);
        factory.setRoute(ETH, r);
    }

    function test_setRoute_replaceAndClear() public {
        RouteHop[] memory r = new RouteHop[](1);
        r[0] = _hop(HOP_V4, USDC_ADDR, IMD_ADDR, 3000, 60);
        vm.expectEmit(true, false, false, true, address(factory));
        emit RouteSet(USDC_ADDR, r);
        factory.setRoute(USDC_ADDR, r);
        assertEq(factory.getRoute(USDC_ADDR).length, 1);
        factory.setRoute(USDC_ADDR, new RouteHop[](0));
        assertFalse(factory.hasRoute(USDC_ADDR));
        assertEq(factory.routedTokens().length, 5, "list is append-only");
    }

    function test_setRoute_validation() public {
        RouteHop[] memory r = new RouteHop[](1);

        r[0] = _hop(HOP_V4, IMD_ADDR, INFER_ADDR, 3000, 60);
        vm.expectRevert(UniAlignmentVaultFactory.BadRoute.selector);
        factory.setRoute(IMD_ADDR, r); // IMD and INFER take no route
        vm.expectRevert(UniAlignmentVaultFactory.BadRoute.selector);
        factory.setRoute(INFER_ADDR, r);

        r[0] = _hop(HOP_V4, ETH, IMD_ADDR, 3000, 60);
        vm.expectRevert(UniAlignmentVaultFactory.BadRoute.selector);
        factory.setRoute(USDC_ADDR, r); // first hop must start at the token

        r[0] = _hop(HOP_V4, USDC_ADDR, ETH, 500, 10);
        vm.expectRevert(UniAlignmentVaultFactory.BadRoute.selector);
        factory.setRoute(USDC_ADDR, r); // must end at IMD

        r[0] = _hop(2, USDC_ADDR, IMD_ADDR, 500, 10);
        vm.expectRevert(UniAlignmentVaultFactory.BadRoute.selector);
        factory.setRoute(USDC_ADDR, r); // v2 not supported

        r[0] = _hop(HOP_V3, USDC_ADDR, IMD_ADDR, 2500, 0);
        vm.expectRevert(UniAlignmentVaultFactory.BadRoute.selector);
        factory.setRoute(USDC_ADDR, r); // not a v3 fee tier

        r[0] = _hop(HOP_V4, USDC_ADDR, IMD_ADDR, 0x800000, 10);
        vm.expectRevert(UniAlignmentVaultFactory.BadRoute.selector);
        factory.setRoute(USDC_ADDR, r); // dynamic fee: not a hookless pool zRouter can route

        r[0] = _hop(HOP_V4, USDC_ADDR, IMD_ADDR, 500, 0);
        vm.expectRevert(UniAlignmentVaultFactory.BadRoute.selector);
        factory.setRoute(USDC_ADDR, r);

        RouteHop[] memory r2 = new RouteHop[](2);
        r2[0] = _hop(HOP_V4, USDC_ADDR, ETH, 500, 10);
        r2[1] = _hop(HOP_V4, WBTC_ADDR, IMD_ADDR, 500, 10);
        vm.expectRevert(UniAlignmentVaultFactory.BadRoute.selector);
        factory.setRoute(USDC_ADDR, r2); // hops must chain

        r2[1] = _hop(HOP_V4, ETH, ETH, 500, 10);
        vm.expectRevert(UniAlignmentVaultFactory.BadRoute.selector);
        factory.setRoute(USDC_ADDR, r2);

        RouteHop[] memory r5 = new RouteHop[](5);
        vm.expectRevert(UniAlignmentVaultFactory.BadRoute.selector);
        factory.setRoute(USDC_ADDR, r5);
    }

    function test_routeChange_appliesToPendingBatch() public {
        _contribute(alice, usdc, 3000e6);
        // Owner moves USDC to a direct (hypothetical) USDC/IMD pool: the next conversion uses it.
        router.setRate(USDC_ADDR, IMD_ADDR, uint256(10_000e18) * 1e18 / 3000e6);
        RouteHop[] memory r = new RouteHop[](1);
        r[0] = _hop(HOP_V4, USDC_ADDR, IMD_ADDR, 3000, 60);
        factory.setRoute(USDC_ADDR, r);
        uint256 calls = router.calls();
        _convert();
        assertEq(router.calls(), calls + 1, "one hop");
        assertGt(vault.benefactorShares(alice), 0);
    }

    function test_constructor_zeroAddresses() public {
        vm.expectRevert(UniAlignmentVaultFactory.InvalidAddress.selector);
        new UniAlignmentVaultFactory(
            IMiyaRegistry(address(0)), IPoolManager(POOL_MANAGER), address(router), INFER_ADDR, IMD_ADDR, key
        );
        vm.expectRevert(UniAlignmentVaultFactory.InvalidAddress.selector);
        new UniAlignmentVaultFactory(
            IMiyaRegistry(address(registry)), IPoolManager(POOL_MANAGER), address(0), INFER_ADDR, IMD_ADDR, key
        );
    }
}
