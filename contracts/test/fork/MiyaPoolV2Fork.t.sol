// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { MiyaPool } from "../../src/pools/MiyaPool.sol";
import { MiyaPoolFactory } from "../../src/pools/MiyaPoolFactory.sol";

interface IDrop {
    function totalSupply() external view returns (uint256);
    function ownerOf(uint256 id) external view returns (address);
    function setApprovalForAll(address operator, bool approved) external;
}

interface IVaultView {
    function pendingOf(address benefactor, address token) external view returns (uint256);
    function pendingByToken(address token) external view returns (uint256);
    function openBatchTokens() external view returns (address[] memory);
}

/// @notice MiyaPool v2 on a mainnet fork: a pool for the live Miyamaker drop, filled by its real holders (impersonated),
///         exercising random and targeted redeems, the lock between them, and a premium lot sold into the LIVE default
///         alignment vault (deployments/1.json defaultVault) with no change to the vault or registry.
///         RPC: MAINNET_RPC_URL (default https://ethereum-rpc.publicnode.com); FORK_BLOCK pins a block.
///         Skipped (not failed) when the RPC is unreachable or SKIP_FORK_TESTS=true; REQUIRE_FORK_TESTS=true fails instead.
contract MiyaPoolV2ForkTest is Test {
    address constant DROP = 0xB86B68BCa287AFD48F81D1F792db69368664a120;
    address constant DEFAULT_VAULT = 0x34bE8C25C7922B3052D1955b8E63fB97F778AA08;
    uint256 constant UNIT = 1e18;

    bool forked;
    MiyaPoolFactory factory;
    MiyaPool pool;
    address trader = makeAddr("trader");
    uint256[] deposited;

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
        factory = new MiyaPoolFactory(DEFAULT_VAULT);
        pool = MiyaPool(factory.createPool(DROP, 2000));

        // Real holders deposit up to 12 pieces, minting the pool tokens to one trader.
        uint256 supply = IDrop(DROP).totalSupply();
        for (uint256 id = 0; id <= supply + 5 && deposited.length < 12; ++id) {
            address owner;
            try IDrop(DROP).ownerOf(id) returns (address o) {
                owner = o;
            } catch {
                continue;
            }
            vm.startPrank(owner);
            IDrop(DROP).setApprovalForAll(address(pool), true);
            uint256[] memory one = new uint256[](1);
            one[0] = id;
            try pool.deposit(one, new uint256[](0), trader) {
                deposited.push(id);
            } catch { }
            vm.stopPrank();
        }
    }

    function test_fork_bothRedeemPathsAndPremiumIntoTheLiveVault() public {
        vm.skip(!forked);
        uint256 n = deposited.length;
        assertGe(n, 7, "need at least 7 real pieces deposited");
        emit log_named_uint("pieces deposited by real holders", n);
        assertEq(pool.balanceOf(trader), n * UNIT);
        assertTrue(pool.randomEnabled());
        assertEq(pool.vault(), DEFAULT_VAULT);

        // Random redeem: exactly 1 token, and while it is pending every piece it could draw is locked.
        address luck = makeAddr("luck");
        vm.prank(trader);
        uint256 c = pool.commitRedeem(1, luck);
        assertEq(pool.balanceOf(trader), (n - 1) * UNIT);
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.LockedForRandomRedeem.selector, deposited[0]));
        pool.redeem(_one(deposited[0]), new uint256[](0), trader);
        (, uint64 target,,) = pool.commits(c);
        vm.roll(target + 1);
        vm.setBlockhash(target, keccak256("fork seed"));
        pool.revealRedeem(c);
        uint256 got;
        for (uint256 i; i < n; ++i) {
            if (IDrop(DROP).ownerOf(deposited[i]) == luck) got = deposited[i];
        }
        assertTrue(IDrop(DROP).ownerOf(got) == luck, "random piece delivered");

        // Targeted redeems: 1.2 tokens each at 20%; five of them build one whole lot.
        address picker = makeAddr("picker");
        uint256 picked;
        for (uint256 i; i < n && picked < 5; ++i) {
            if (deposited[i] == got) continue;
            vm.prank(trader);
            pool.redeem(_one(deposited[i]), new uint256[](0), picker);
            assertEq(IDrop(DROP).ownerOf(deposited[i]), picker);
            ++picked;
        }
        assertEq(pool.balanceOf(trader), (n - 1) * UNIT - 5 * 1.2e18);
        assertEq(pool.premiumReserve(), UNIT);
        assertTrue(pool.lotAvailable());
        assertEq(pool.totalSupply() + pool.premiumReserve() + UNIT * pool.pendingUnits(), UNIT * pool.heldUnits());

        // The lot: wait for the price to fall, buy it; the ETH lands in the live vault as the buyer's contribution.
        vm.warp(block.timestamp + 10 * pool.LOT_HALF_LIFE());
        uint256 price = pool.lotPrice();
        address buyer = makeAddr("lot buyer");
        vm.deal(buyer, 1 ether);
        uint256 vaultEthBefore = DEFAULT_VAULT.balance;
        uint256 pendingEthBefore = IVaultView(DEFAULT_VAULT).pendingByToken(address(0));
        vm.prank(buyer);
        uint256 gasBefore = gasleft();
        pool.buyLot{ value: price }(buyer, buyer);
        emit log_named_uint("buyLot gas into the live vault", gasBefore - gasleft());
        emit log_named_uint("lot price (wei)", price);
        assertEq(pool.balanceOf(buyer), UNIT);
        assertEq(DEFAULT_VAULT.balance - vaultEthBefore, price, "ETH in the vault");
        assertEq(IVaultView(DEFAULT_VAULT).pendingOf(buyer, address(0)), price, "booked for the buyer");
        assertEq(IVaultView(DEFAULT_VAULT).pendingByToken(address(0)) - pendingEthBefore, price);
        address[] memory open = IVaultView(DEFAULT_VAULT).openBatchTokens();
        bool hasEth;
        for (uint256 i; i < open.length; ++i) {
            if (open[i] == address(0)) hasEth = true;
        }
        assertTrue(hasEth, "ETH is pending for the keeper's next batch");

        // The lot is a whole token: the buyer takes a piece with it at once.
        uint256 left;
        for (uint256 i; i < n; ++i) {
            if (IDrop(DROP).ownerOf(deposited[i]) == address(pool)) left = deposited[i];
        }
        vm.startPrank(trader);
        pool.transfer(buyer, 0.2e18); // the premium on top of the lot's token
        vm.stopPrank();
        vm.prank(buyer);
        pool.redeem(_one(left), new uint256[](0), buyer);
        assertEq(IDrop(DROP).ownerOf(left), buyer);
        assertEq(pool.totalSupply() + pool.premiumReserve() + UNIT * pool.pendingUnits(), UNIT * pool.heldUnits());
    }

    function _one(uint256 v) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = v;
    }
}
