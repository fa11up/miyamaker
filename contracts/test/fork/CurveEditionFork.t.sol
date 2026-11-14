// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { IMiyaRegistry } from "../../src/registry/interfaces/IMiyaRegistry.sol";
import { CurveEdition } from "../../src/factories/curve/CurveEdition.sol";
import { CurveEditionFactory } from "../../src/factories/curve/CurveEditionFactory.sol";

interface IOwned {
    function owner() external view returns (address);
    function setFactory(address factory, bool registered) external;
}

interface IVaultView {
    function pendingOf(address benefactor, address token) external view returns (uint256);
    function config() external view returns (address);
    function minContribution(address token) external view returns (uint256);
}

interface IERC20Lite {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

/// @notice Curve editions on a mainnet fork against the LIVE miyamints registry, default vault, treasury and IMD:
///         the factory is registered by impersonating the registry owner (the Safe), then an ETH edition and an IMD
///         edition mint (the 3% vault share reaching the live vault, booked to the collection) and burn back to zero.
///         RPC: MAINNET_RPC_URL (default https://ethereum-rpc.publicnode.com); FORK_BLOCK pins a block.
///         Skipped (not failed) when the RPC is unreachable or SKIP_FORK_TESTS=true; REQUIRE_FORK_TESTS=true fails instead.
contract CurveEditionForkTest is Test {
    address constant REGISTRY = 0xd2e04d963b4E675954a395868Afc9eAeda0e54d6;
    address constant DEFAULT_VAULT = 0x34bE8C25C7922B3052D1955b8E63fB97F778AA08;
    address constant IMD = 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7;
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    bool forked;
    CurveEditionFactory factory;
    CurveEdition coll;
    address safe;
    address artist = makeAddr("curve-fork-artist");
    address alice = makeAddr("curve-fork-alice");

    function setUp() public {
        if (vm.envOr("SKIP_FORK_TESTS", false)) return;
        string memory rpc = vm.envOr("MAINNET_RPC_URL", string("https://ethereum-rpc.publicnode.com"));
        uint256 blockNo = vm.envOr("FORK_BLOCK", uint256(0));
        if (blockNo == 0) {
            try vm.createSelectFork(rpc) {
                forked = true;
            } catch { }
        } else {
            try vm.createSelectFork(rpc, blockNo) {
                forked = true;
            } catch { }
        }
        if (!forked) {
            require(!vm.envOr("REQUIRE_FORK_TESTS", false), "fork tests required but no mainnet fork");
            return;
        }
        safe = IOwned(REGISTRY).owner();
        factory = new CurveEditionFactory(safe, IMiyaRegistry(REGISTRY), WETH);
        vm.startPrank(safe);
        IOwned(REGISTRY).setFactory(address(factory), true);
        factory.setPriceCap(address(0), 1000 ether);
        factory.setPriceCap(IMD, 3_000_000e18);
        vm.stopPrank();
        vm.prank(artist);
        coll = CurveEdition(payable(factory.createInstance(bytes32("fork"), "Fork curves", "", DEFAULT_VAULT)));
        vm.deal(alice, 100 ether);
    }

    function _params(address currency, uint128 start, uint128 growthBps)
        internal
        pure
        returns (CurveEdition.EditionParams memory)
    {
        return CurveEdition.EditionParams({
            currency: currency,
            shape: 0,
            startPrice: start,
            step: growthBps,
            maxSupply: 500,
            spreadBps: 1000,
            royaltyBps: 500,
            uri: "ipfs://copy",
            masterUri: "ipfs://master"
        });
    }

    function test_fork_ethEdition_vaultShareReachesLiveVault_andBurnsToZero() public {
        if (!forked) return;
        vm.prank(artist);
        uint256 id = coll.addEdition(_params(address(0), 0.05 ether, 200));
        uint256 treasury0 = IMiyaRegistry(REGISTRY).treasury().balance;
        uint256 cost = coll.mintQuote(id, 10);
        vm.prank(alice);
        coll.mint{ value: cost }(id, 10, cost);

        // 3% of the spread-split reached the live vault as this collection's pending contribution.
        assertGt(IVaultView(DEFAULT_VAULT).pendingOf(address(coll), address(0)), 0, "vault booked the collection");
        assertGt(IMiyaRegistry(REGISTRY).treasury().balance, treasury0, "protocol cut to the live treasury");
        assertEq(address(coll).balance, coll.liabilities(address(0)));

        uint256 before = alice.balance;
        vm.prank(alice);
        coll.burn(id, 10, 0, 0);
        assertEq(coll.getEdition(id).reserve, 0);
        assertApproxEqRel(alice.balance - before, (cost * 90) / 100, 0.001e18, "about 90% back");
        assertEq(address(coll).balance, coll.liabilities(address(0)));
    }

    function test_fork_imdEdition_mintAndBurn() public {
        if (!forked) return;
        uint256 imdMin = IVaultView(IVaultView(DEFAULT_VAULT).config()).minContribution(IMD);
        vm.prank(artist);
        // Start high enough that 3% of one copy clears the vault's IMD minimum.
        uint256 id = coll.addEdition(_params(IMD, uint128(imdMin * 40), 100));
        uint256 cost = coll.mintQuote(id, 5);
        deal(IMD, alice, cost);
        vm.startPrank(alice);
        IERC20Lite(IMD).approve(address(coll), cost);
        coll.mint(id, 5, cost);
        assertGt(IVaultView(DEFAULT_VAULT).pendingOf(address(coll), IMD), 0, "IMD vault share booked");
        assertEq(IERC20Lite(IMD).balanceOf(address(coll)), coll.liabilities(IMD));
        coll.burn(id, 5, 0, 0);
        vm.stopPrank();
        assertEq(coll.getEdition(id).reserve, 0);
        assertEq(IERC20Lite(IMD).balanceOf(address(coll)), coll.liabilities(IMD));
    }
}
