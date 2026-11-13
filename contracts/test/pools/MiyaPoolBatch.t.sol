// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "solady/tokens/ERC20.sol";
import { MiyaPool } from "../../src/pools/MiyaPool.sol";
import { MiyaPoolFactory } from "../../src/pools/MiyaPoolFactory.sol";
import { Mock721, Mock1155, MockToken, MockVault } from "./MiyaPool.t.sol";

/// @notice The exact calls app/src/pages/Swap/nft/poolBatch.ts plans for a batched order, run on the real v2 pool:
///         one transaction per pool for a multi-id sell and a multi-id buy (plus, for picks with a fee, one exact
///         IMD/INFER approval first), balances and events asserted.
contract MiyaPoolBatchTest is Test {
    uint256 constant UNIT = 1e18;

    event Deposited(address indexed from, address indexed to, uint256[] ids, uint256[] amounts);
    event Redeemed(address indexed by, address indexed to, uint256[] ids, uint256[] amounts);
    event PickFeePaid(address indexed by, address indexed token, uint256 amount);

    MiyaPoolFactory factory;
    MockVault vault;
    MockToken imd;
    MockToken infer;
    Mock721 nft;
    Mock1155 editions;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        imd = new MockToken("IMD");
        infer = new MockToken("INFER");
        vault = new MockVault(address(imd), address(infer));
        factory = new MiyaPoolFactory(address(vault));
        nft = new Mock721();
        editions = new Mock1155();
        for (uint256 id = 1; id <= 60; ++id) nft.mint(alice, id);
        editions.mint(alice, 1, 5);
        editions.mint(alice, 2, 3);
    }

    function _list(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory r) {
        r = new uint256[](3);
        (r[0], r[1], r[2]) = (a, b, c);
    }

    function _one(uint256 a) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = a;
    }

    function _range(uint256 from, uint256 n) internal pure returns (uint256[] memory r) {
        r = new uint256[](n);
        for (uint256 i; i < n; ++i) r[i] = from + i;
    }

    function _ones(uint256 n) internal pure returns (uint256[] memory r) {
        r = new uint256[](n);
        for (uint256 i; i < n; ++i) r[i] = 1;
    }

    function _free721() internal returns (MiyaPool) {
        return MiyaPool(factory.createPool(address(nft), 0, 0));
    }

    // ── ERC-721, picks ──────────────────────────────────────────────────────

    /// Sell plan: setApprovalForAll (own step), then ONE deposit(ids, [], you). Buy plan (free picks): ONE
    /// redeem(ids, 1s, you, address(0)).
    function test_721_multiIdDepositThenMultiIdRedeem_oneCallEach() public {
        MiyaPool pool = _free721();

        vm.prank(alice);
        nft.setApprovalForAll(address(pool), true);

        uint256[] memory ids = _list(3, 4, 9);
        // One Deposited per id (minted in the receive hook), each to alice.
        for (uint256 i; i < 3; ++i) {
            vm.expectEmit(true, true, false, true, address(pool));
            emit Deposited(alice, alice, _one(ids[i]), _one(1));
        }
        vm.prank(alice);
        pool.deposit(ids, new uint256[](0), alice);

        assertEq(pool.balanceOf(alice), 3 * UNIT, "3 pool tokens minted to the seller");
        assertEq(pool.totalSupply(), 3 * UNIT);
        for (uint256 i; i < 3; ++i) assertEq(nft.ownerOf(ids[i]), address(pool));
        assertEq(pool.heldUnits(), 3);

        // Pick two of them back in one call; free picks burn exactly 2 tokens and need no allowance.
        uint256[] memory want = new uint256[](2);
        (want[0], want[1]) = (9, 3);
        vm.expectEmit(true, true, false, true, address(pool));
        emit Redeemed(alice, alice, want, _ones(2));
        vm.prank(alice);
        pool.redeem(want, _ones(2), alice, address(0));

        assertEq(pool.balanceOf(alice), UNIT, "exactly 2 tokens burned");
        assertEq(nft.ownerOf(9), alice);
        assertEq(nft.ownerOf(3), alice);
        assertEq(nft.ownerOf(4), address(pool));
        assertEq(pool.heldUnits(), 1);
        assertEq(pool.totalSupply(), UNIT);
    }

    /// Picks with a fee: the plan's exact approve(pool, fee × units) then ONE redeem paying in IMD. The fee reaches
    /// the vault as the picker's contribution and the allowance is used up exactly.
    function test_721_pickWithFee_exactApprovalThenOneRedeem() public {
        MiyaPool pool = MiyaPool(factory.createPool(address(nft), 2e18, 3500e18));
        vm.startPrank(alice);
        nft.setApprovalForAll(address(pool), true);
        pool.deposit(_list(1, 2, 3), new uint256[](0), alice);
        vm.stopPrank();
        imd.mint(alice, 10e18);

        uint256[] memory want = new uint256[](2);
        (want[0], want[1]) = (1, 3);
        vm.startPrank(alice);
        imd.approve(address(pool), 4e18);
        vm.expectEmit(true, true, false, true, address(pool));
        emit PickFeePaid(alice, address(imd), 4e18);
        pool.redeem(want, _ones(2), alice, address(imd));
        vm.stopPrank();

        assertEq(imd.balanceOf(alice), 6e18, "fee 2 IMD x 2 taken");
        assertEq(imd.allowance(alice, address(pool)), 0, "exact approval used up");
        assertEq(vault.pendingOf(alice, address(imd)), 4e18, "fee is alice's contribution");
        assertEq(imd.balanceOf(address(pool)), 0, "pool keeps no fee");
        assertEq(nft.ownerOf(1), alice);
        assertEq(nft.ownerOf(3), alice);
        assertEq(pool.balanceOf(alice), UNIT);
    }

    /// Without the fee approval the pick reverts and nothing moves: the approve step is really needed.
    function test_721_pickWithFee_withoutApprovalReverts() public {
        MiyaPool pool = MiyaPool(factory.createPool(address(nft), 2e18, 0));
        vm.startPrank(alice);
        nft.setApprovalForAll(address(pool), true);
        pool.deposit(_list(1, 2, 3), new uint256[](0), alice);
        vm.stopPrank();
        imd.mint(alice, 10e18);

        vm.prank(alice);
        vm.expectRevert();
        pool.redeem(_one(1), _ones(1), alice, address(imd));
        assertEq(nft.ownerOf(1), address(pool));
        assertEq(pool.balanceOf(alice), 3 * UNIT);
    }

    /// A batch redeem is all or nothing: one id not in the pool reverts the whole call, and nothing is burned.
    function test_721_redeemBatchIsAllOrNothing() public {
        MiyaPool pool = _free721();
        vm.startPrank(alice);
        nft.setApprovalForAll(address(pool), true);
        pool.deposit(_list(1, 2, 3), new uint256[](0), alice);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.NotHeld.selector, 7));
        pool.redeem(_list(1, 7, 2), _ones(3), alice, address(0));
        vm.stopPrank();
        assertEq(pool.balanceOf(alice), 3 * UNIT);
        assertEq(nft.ownerOf(1), address(pool));
    }

    /// The shortfall case: fewer pool tokens than ids reverts (the plan puts a token swap first).
    function test_721_redeemWithShortfallReverts() public {
        MiyaPool pool = _free721();
        vm.startPrank(alice);
        nft.setApprovalForAll(address(pool), true);
        pool.deposit(_list(1, 2, 3), new uint256[](0), alice);
        pool.transfer(bob, 2 * UNIT);
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(ERC20.InsufficientBalance.selector);
        pool.redeem(_list(1, 2, 3), _ones(3), bob, address(0));
    }

    /// Without the approval the multi-id deposit reverts: the approve step really is needed for ERC-721 batches.
    function test_721_depositWithoutApprovalReverts() public {
        MiyaPool pool = _free721();
        vm.prank(alice);
        vm.expectRevert();
        pool.deposit(_list(1, 2, 3), new uint256[](0), alice);
    }

    /// MAX_BATCH (50) ids fit in one call each way, well under a block. Gas logged for the record.
    function test_721_fiftyIdsEachWay() public {
        MiyaPool pool = _free721();
        uint256[] memory ids = _range(1, 50);
        vm.startPrank(alice);
        nft.setApprovalForAll(address(pool), true);
        uint256 g = gasleft();
        pool.deposit(ids, new uint256[](0), alice);
        uint256 depositGas = g - gasleft();
        g = gasleft();
        pool.redeem(ids, _ones(50), alice, address(0));
        uint256 redeemGas = g - gasleft();
        vm.stopPrank();
        emit log_named_uint("deposit 50 gas", depositGas);
        emit log_named_uint("redeem 50 gas", redeemGas);
        assertLt(depositGas, 10_000_000);
        assertLt(redeemGas, 10_000_000);
        assertEq(pool.balanceOf(alice), 0);
        assertEq(nft.ownerOf(50), alice);
    }

    // ── ERC-1155, picks ─────────────────────────────────────────────────────

    /// Sell plan: ONE collection.safeBatchTransferFrom(you → pool, ids, amounts, "") with no approval.
    /// Buy plan: ONE redeem(ids, amounts, you, address(0)).
    function test_1155_batchSendThenMultiIdRedeem_oneCallEach() public {
        MiyaPool pool = MiyaPool(factory.createPool(address(editions), 0, 0));
        uint256[] memory ids = new uint256[](2);
        uint256[] memory amounts = new uint256[](2);
        (ids[0], ids[1]) = (1, 2);
        (amounts[0], amounts[1]) = (3, 2);

        vm.expectEmit(true, true, false, true, address(pool));
        emit Deposited(alice, alice, ids, amounts);
        vm.prank(alice);
        editions.safeBatchTransferFrom(alice, address(pool), ids, amounts, "");

        assertEq(pool.balanceOf(alice), 5 * UNIT);
        assertEq(pool.unitsOf(1), 3);
        assertEq(pool.unitsOf(2), 2);
        assertEq(editions.balanceOf(alice, 1), 2);

        (amounts[0], amounts[1]) = (2, 2);
        vm.expectEmit(true, true, false, true, address(pool));
        emit Redeemed(alice, alice, ids, amounts);
        vm.prank(alice);
        pool.redeem(ids, amounts, alice, address(0));

        assertEq(pool.balanceOf(alice), UNIT);
        assertEq(editions.balanceOf(alice, 1), 4);
        assertEq(editions.balanceOf(alice, 2), 3);
        assertEq(pool.unitsOf(1), 1);
        assertEq(pool.unitsOf(2), 0);
        assertEq(pool.heldUnits(), 1);
    }

    // ── ERC-721, random ─────────────────────────────────────────────────────

    /// Buy plan for a random draw: ONE commitRedeem(N, you), then revealRedeem once a later block exists. No fee.
    function test_random_batchIsOneCommitThenOneReveal() public {
        MiyaPool pool = MiyaPool(factory.createPool(address(nft), 2e18, 0));
        assertTrue(pool.randomEnabled());
        vm.startPrank(alice);
        nft.setApprovalForAll(address(pool), true);
        pool.deposit(_range(1, 5), new uint256[](0), alice);
        uint256 commitId = pool.commitRedeem(3, alice);
        vm.stopPrank();

        assertEq(pool.balanceOf(alice), 2 * UNIT, "3 tokens burned at commit");
        assertEq(pool.pendingUnits(), 3);

        vm.expectRevert(MiyaPool.TooEarly.selector);
        pool.revealRedeem(commitId);

        (, uint64 target,,) = pool.commits(commitId);
        vm.roll(uint256(target) + 1);
        vm.setBlockhash(target, keccak256("seed"));
        vm.prank(bob); // anyone can reveal; the NFTs still go to the committer
        pool.revealRedeem(commitId);

        uint256 got;
        for (uint256 id = 1; id <= 5; ++id) if (nft.ownerOf(id) == alice) ++got;
        assertEq(got, 3);
        assertEq(pool.heldUnits(), 2);
        assertEq(pool.pendingUnits(), 0);
        assertEq(nft.balanceOf(bob), 0);
        assertEq(imd.balanceOf(address(vault)), 0, "a random draw pays no pick fee");
    }

    /// While a draw is open, a pick of an id it could draw reverts (the plan reads isLocked and leaves those out).
    function test_random_lockedIdsCannotBePicked() public {
        MiyaPool pool = _free721();
        vm.startPrank(alice);
        nft.setApprovalForAll(address(pool), true);
        pool.deposit(_range(1, 4), new uint256[](0), alice);
        pool.commitRedeem(2, alice);
        vm.stopPrank();

        uint256 locked;
        uint256 open;
        for (uint256 id = 1; id <= 4; ++id) {
            if (pool.isLocked(id)) locked = id;
            else open = id;
        }
        assertTrue(locked != 0, "an open draw locks some ids");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.LockedForRandomRedeem.selector, locked));
        pool.redeem(_one(locked), _ones(1), alice, address(0));

        if (open != 0) {
            vm.prank(alice);
            pool.redeem(_one(open), _ones(1), alice, address(0));
            assertEq(nft.ownerOf(open), alice);
        }
    }
}
