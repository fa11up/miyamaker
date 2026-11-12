// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { MiyaPool } from "../../src/pools/MiyaPool.sol";
import { MiyaPoolFactory } from "../../src/pools/MiyaPoolFactory.sol";
import { Mock721, MockVault, MockToken } from "./MiyaPool.t.sol";

/// @notice Gas of single operations on a warm ERC721 pool (both paths, pick fee in IMD or INFER), printed with -vv. Each number is
///         one external call measured from the test (includes the call overhead, not the 21k transaction base).
contract MiyaPoolGasTest is Test {
    uint256 constant UNIT = 1e18;
    Mock721 nft;
    MiyaPool pool;
    MockVault vault;
    MockToken imd;
    MockToken infer;
    address alice = makeAddr("alice");

    function setUp() public {
        imd = new MockToken("IMD");
        infer = new MockToken("INFER");
        vault = new MockVault(address(imd), address(infer));
        MiyaPoolFactory factory = new MiyaPoolFactory(address(vault));
        nft = new Mock721();
        for (uint256 id = 1; id <= 60; ++id) {
            nft.mint(alice, id);
        }
        uint256 g = gasleft();
        pool = MiyaPool(factory.createPool(address(nft), 1e18, 3500e18));
        emit log_named_uint("createPool", g - gasleft());
        imd.mint(alice, 100e18);
        infer.mint(alice, 100_000e18);
        vm.startPrank(alice);
        imd.approve(address(pool), type(uint256).max);
        infer.approve(address(pool), type(uint256).max);
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
        pool.redeem(_one(41), new uint256[](0), alice, address(imd));
        emit log_named_uint("pick 1 (tail id, fee in IMD, first contribution)", g - gasleft());

        g = gasleft();
        pool.redeem(_one(7), new uint256[](0), alice, address(imd));
        emit log_named_uint("pick 1 (middle id, fee in IMD, repeat contributor)", g - gasleft());

        g = gasleft();
        pool.redeem(_one(8), new uint256[](0), alice, address(infer));
        emit log_named_uint("pick 1 (fee in INFER)", g - gasleft());

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
    }
}
