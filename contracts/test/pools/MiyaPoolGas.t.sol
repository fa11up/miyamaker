// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { MiyaPool } from "../../src/pools/MiyaPool.sol";
import { MiyaPoolFactory } from "../../src/pools/MiyaPoolFactory.sol";
import { Mock721, MockVault } from "./MiyaPool.t.sol";

/// @notice Gas of single operations on a warm ERC721 pool (both paths, 5% premium), printed with -vv. Each number is
///         one external call measured from the test (includes the call overhead, not the 21k transaction base).
contract MiyaPoolGasTest is Test {
    uint256 constant UNIT = 1e18;
    Mock721 nft;
    MiyaPool pool;
    MockVault vault;
    address alice = makeAddr("alice");

    function setUp() public {
        vault = new MockVault();
        MiyaPoolFactory factory = new MiyaPoolFactory(address(vault));
        nft = new Mock721();
        for (uint256 id = 1; id <= 60; ++id) {
            nft.mint(alice, id);
        }
        uint256 g = gasleft();
        pool = MiyaPool(factory.createPool(address(nft), 2000));
        emit log_named_uint("createPool", g - gasleft());
        vm.startPrank(alice);
        nft.setApprovalForAll(address(pool), true);
        uint256[] memory ids = new uint256[](40);
        for (uint256 i; i < 40; ++i) {
            ids[i] = i + 1;
        }
        pool.deposit(ids, new uint256[](0), alice);
        vm.stopPrank();
    }

    function _one(uint256 v) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = v;
    }

    function _mine(uint256 c, string memory seed) internal {
        (, uint64 target,,) = pool.commits(c);
        vm.roll(uint256(target) + 1);
        vm.setBlockhash(target, keccak256(bytes(seed)));
    }

    function test_gas_singleOperations() public {
        vm.startPrank(alice);
        uint256 g = gasleft();
        pool.deposit(_one(41), new uint256[](0), alice);
        emit log_named_uint("deposit 1 (ERC721, queued)", g - gasleft());

        g = gasleft();
        pool.redeem(_one(41), new uint256[](0), alice);
        emit log_named_uint("targeted redeem 1 (tail id, with premium)", g - gasleft());

        g = gasleft();
        pool.redeem(_one(7), new uint256[](0), alice);
        emit log_named_uint("targeted redeem 1 (middle id, swap with tail)", g - gasleft());

        g = gasleft();
        uint256 c = pool.commitRedeem(1, alice);
        emit log_named_uint("commitRedeem 1", g - gasleft());
        vm.stopPrank();

        _mine(c, "g");
        g = gasleft();
        pool.revealRedeem(c);
        emit log_named_uint("revealRedeem 1", g - gasleft());

        vm.prank(alice);
        c = pool.commitRedeem(10, alice);
        _mine(c, "h");
        g = gasleft();
        pool.revealRedeem(c);
        emit log_named_uint("revealRedeem 10", g - gasleft());

        // build a lot: 20% premium, 5 redeems
        vm.startPrank(alice);
        for (uint256 id = 20; id < 40 && pool.premiumReserve() < UNIT; ++id) {
            if (pool.isHeld(id)) pool.redeem(_one(id), new uint256[](0), alice);
        }
        vm.stopPrank();
        uint256 price = pool.lotPrice();
        vm.deal(alice, price);
        vm.prank(alice);
        g = gasleft();
        pool.buyLot{ value: price }(alice, alice);
        emit log_named_uint("buyLot (mock vault)", g - gasleft());
    }
}
