// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {UniAlignmentVault} from "../../src/vaults/uni/UniAlignmentVault.sol";
import {UniAlignmentVaultFactory} from "../../src/vaults/uni/UniAlignmentVaultFactory.sol";
import {IVaultRoutes, RouteHop, HOP_V3, HOP_V4} from "../../src/vaults/uni/IVaultRoutes.sol";
import {MiyaRegistry} from "../../src/registry/MiyaRegistry.sol";
import {IMiyaRegistry} from "../../src/registry/interfaces/IMiyaRegistry.sol";
import {ClaimMode} from "../../src/interfaces/IAlignmentVault.sol";
import {TestableUniAlignmentVault} from "../helpers/TestableUniAlignmentVault.sol";
import {MockToken, MockRouteRouter} from "./mocks/VaultMocks.sol";
import {CREATEX} from "../../src/shared/CreateXConstants.sol";
import {CREATEX_BYTECODE} from "createx-forge/script/CreateX.d.sol";

/// @notice Shared setup for vault v2 unit tests: mainnet-shaped tokens (at their mainnet addresses, so INFER sorts
///         first like on chain), the spec's route table on a real factory, a mock router at fixed rates, and a
///         TestableUniAlignmentVault (simulated alignment pool at 1 IMD per INFER).
abstract contract VaultTestBase is Test {
    address constant ETH = address(0);
    address constant INFER_ADDR = 0x53d0eA0A685220718Dc6a0a6e4617194C6F37921;
    address constant IMD_ADDR = 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7;
    address constant USDC_ADDR = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant IMDUSD_ADDR = 0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25;
    address constant CBBTC_ADDR = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;
    address constant WBTC_ADDR = 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599;
    address constant HOOK = 0x784FF9a3ac5d88A30bfff6F7f2a270161FBE6000;
    uint160 constant Q96 = uint160(1 << 96);

    // Fixed rates (raw units out per raw unit in, 1e18 = 1:1): 1 ETH = 10,000 IMD; 1 ETH = 3,000 USDC;
    // 1 BTC = 30 ETH; 1 imdUSD = 3 IMD.
    uint256 constant R_ETH_IMD = 10_000e18;
    uint256 constant R_IMD_ETH = 1e14;
    uint256 constant R_USDC_ETH = uint256(1e18) * 1e18 / 3000e6;
    uint256 constant R_BTC_ETH = uint256(30e18) * 1e18 / 1e8;
    uint256 constant R_IMDUSD_IMD = 3e18;

    MiyaRegistry registry;
    UniAlignmentVaultFactory factory;
    MockRouteRouter router;
    TestableUniAlignmentVault vault;
    MockToken infer;
    MockToken imd;
    MockToken usdc;
    MockToken imdUsd;
    MockToken cbBtc;
    MockToken wbtc;
    PoolKey key;

    address treasury = makeAddr("treasury");
    address keeper = makeAddr("keeper");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address dan = makeAddr("dan");
    address constant POOL_MANAGER = address(0x4444);

    function setUp() public virtual {
        vm.etch(CREATEX, CREATEX_BYTECODE);
        infer = _token(INFER_ADDR, "INFER", 18);
        imd = _token(IMD_ADDR, "IMD", 18);
        usdc = _token(USDC_ADDR, "USDC", 6);
        imdUsd = _token(IMDUSD_ADDR, "imdUSD", 18);
        cbBtc = _token(CBBTC_ADDR, "cbBTC", 8);
        wbtc = _token(WBTC_ADDR, "WBTC", 8);

        registry = new MiyaRegistry(address(this), treasury, 100, 1000);
        address[] memory targetTokens = new address[](2);
        targetTokens[0] = INFER_ADDR;
        targetTokens[1] = IMD_ADDR;
        registry.addTarget("INFER/IMD", targetTokens);
        registry.setConversionKeeper(keeper);
        registry.setPaymentToken(INFER_ADDR, true);
        registry.setPaymentToken(IMD_ADDR, true);
        registry.setPaymentToken(USDC_ADDR, true);
        registry.setPaymentToken(IMDUSD_ADDR, true);
        registry.setPaymentToken(CBBTC_ADDR, true);
        registry.setPaymentToken(WBTC_ADDR, true);

        router = new MockRouteRouter();
        vm.deal(address(router), 1e30);
        router.setRate(ETH, IMD_ADDR, R_ETH_IMD);
        router.setRate(IMD_ADDR, ETH, R_IMD_ETH);
        router.setRate(USDC_ADDR, ETH, R_USDC_ETH);
        router.setRate(WBTC_ADDR, ETH, R_BTC_ETH);
        router.setRate(CBBTC_ADDR, ETH, R_BTC_ETH);
        router.setRate(IMDUSD_ADDR, IMD_ADDR, R_IMDUSD_IMD);

        key = PoolKey({
            currency0: Currency.wrap(INFER_ADDR),
            currency1: Currency.wrap(IMD_ADDR),
            fee: 12500,
            tickSpacing: 60,
            hooks: IHooks(HOOK)
        });
        factory = new UniAlignmentVaultFactory(
            IMiyaRegistry(address(registry)), IPoolManager(POOL_MANAGER), address(router), INFER_ADDR, IMD_ADDR, key
        );
        registry.setVaultFactory(address(factory), true);
        _setSpecRoutes();

        vault = _newVault();
    }

    function _token(address at, string memory sym, uint8 dec) internal returns (MockToken t) {
        deployCodeTo("VaultMocks.sol:MockToken", abi.encode(sym, sym, dec), at);
        t = MockToken(at);
    }

    function _newVault() internal returns (TestableUniAlignmentVault v) {
        TestableUniAlignmentVault impl = new TestableUniAlignmentVault();
        v = TestableUniAlignmentVault(payable(LibClone.clone(address(impl))));
        v.initialize(
            address(this),
            IPoolManager(POOL_MANAGER),
            address(router),
            IMiyaRegistry(address(registry)),
            IVaultRoutes(address(factory)),
            INFER_ADDR,
            IMD_ADDR,
            key,
            0
        );
        v.setMockPool(Q96, 1e24); // 1 IMD per INFER, 1e24 of other liquidity
    }

    function _hop(uint8 kind, address tIn, address tOut, uint24 fee, int24 ts) internal pure returns (RouteHop memory) {
        return RouteHop({kind: kind, tokenIn: tIn, tokenOut: tOut, fee: fee, tickSpacing: ts});
    }

    function _setSpecRoutes() internal {
        RouteHop[] memory r = new RouteHop[](1);
        r[0] = _hop(HOP_V4, ETH, IMD_ADDR, 10000, 200);
        factory.setRoute(ETH, r);
        r[0] = _hop(HOP_V4, IMDUSD_ADDR, IMD_ADDR, 3000, 60);
        factory.setRoute(IMDUSD_ADDR, r);
        RouteHop[] memory r2 = new RouteHop[](2);
        r2[1] = _hop(HOP_V4, ETH, IMD_ADDR, 10000, 200);
        r2[0] = _hop(HOP_V4, USDC_ADDR, ETH, 500, 10);
        factory.setRoute(USDC_ADDR, r2);
        r2[0] = _hop(HOP_V4, WBTC_ADDR, ETH, 500, 10);
        factory.setRoute(WBTC_ADDR, r2);
        r2[0] = _hop(HOP_V3, CBBTC_ADDR, ETH, 3000, 0);
        factory.setRoute(CBBTC_ADDR, r2);
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    function _giveEth(address who, uint256 amount, TestableUniAlignmentVault v) internal {
        vm.deal(who, amount);
        vm.prank(who);
        v.receiveContribution{value: amount}(Currency.wrap(ETH), amount, who);
    }

    function _giveToken(address who, MockToken t, uint256 amount, TestableUniAlignmentVault v) internal {
        t.mint(who, amount);
        vm.startPrank(who);
        t.approve(address(v), amount);
        v.receiveContribution(Currency.wrap(address(t)), amount, who);
        vm.stopPrank();
    }

    function _contributeEth(address who, uint256 amount) internal {
        _giveEth(who, amount, vault);
    }

    function _contribute(address who, MockToken t, uint256 amount) internal {
        _giveToken(who, t, amount, vault);
    }

    /// @dev Keeper params with permissive floors (1 wei per hop, 1 wei split): unit tests check accounting, not prices.
    function _params(TestableUniAlignmentVault v) internal view returns (UniAlignmentVault.ConvertParams memory p) {
        address[] memory toks = v.openBatchTokens();
        p.tokens = toks;
        p.minOuts = new uint256[][](toks.length);
        for (uint256 i; i < toks.length; ++i) {
            if (toks[i] == INFER_ADDR || toks[i] == IMD_ADDR) continue;
            uint256 h = factory.getRoute(toks[i]).length;
            p.minOuts[i] = new uint256[](h);
            for (uint256 k; k < h; ++k) p.minOuts[i][k] = 1;
        }
        p.minSplitOut = 1;
        p.deadline = block.timestamp;
    }

    function _convert() internal returns (uint256 shares) {
        return _convert(vault);
    }

    function _convert(TestableUniAlignmentVault v) internal returns (uint256 shares) {
        UniAlignmentVault.ConvertParams memory p = _params(v);
        vm.prank(keeper);
        shares = v.convertAndAddLiquidity(p);
    }

    /// @dev Owed per fee token (fees + protocol + pending) must be held.
    function _assertSolvent(TestableUniAlignmentVault v) internal view {
        address[3] memory t = [INFER_ADDR, IMD_ADDR, ETH];
        for (uint256 i; i < 3; ++i) {
            (, uint256 dist, uint256 claimed, uint256 prot) = v.feeStats(t[i]);
            uint256 bal = t[i] == ETH ? address(v).balance : MockToken(t[i]).balanceOf(address(v));
            assertGe(bal, dist - claimed + prot + v.pendingByToken(t[i]), "solvent");
        }
    }
}
