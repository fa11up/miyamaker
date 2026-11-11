// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { MerkleProofLib } from "solady/utils/MerkleProofLib.sol";
import { ERC721DropInstance } from "../../../src/factories/erc721drop/ERC721DropInstance.sol";
import { ERC721DropFactory } from "../../../src/factories/erc721drop/ERC721DropFactory.sol";
import { IMiyaRegistry } from "../../../src/registry/interfaces/IMiyaRegistry.sol";
import { TokenPrice } from "../../../src/factories/interfaces/TokenPrice.sol";
import { DropTestRegistry, DropTestVault } from "./ERC721Drop.t.sol";

/// @notice The app's allowlist tree (app/api/_lib/allowlist.ts, OpenZeppelin StandardMerkleTree for ['address']) against
///         the drop itself. ROOT and the proofs below were made by buildTree / proofFor for vm.addr(1..5) and match
///         the OpenZeppelin merkle-tree package (v1.0.8); app/tests/allowlist.test.mts checks the same constants on the app side.
///         Also pins the drop rules the app's free claim phases and scripts/refresh-phases.mts lean on.
contract AllowlistProofTest is Test {
    bytes32 constant ROOT = 0x6516e9023c69d23b0e7acfe325d6ac80d903995bfa8e6c21cfd69c29641dcb88;

    DropTestRegistry registry;
    DropTestVault vault;
    ERC721DropFactory factory;
    address artist = makeAddr("artist");

    function setUp() public {
        registry = new DropTestRegistry(makeAddr("treasury"));
        vault = new DropTestVault();
        registry.setVault(address(vault), true);
        factory = new ERC721DropFactory(IMiyaRegistry(address(registry)), address(0));
        vm.warp(1_000_000);
    }

    function _p(bytes32 a, bytes32 b) internal pure returns (bytes32[] memory p) {
        p = new bytes32[](2);
        p[0] = a;
        p[1] = b;
    }

    function _p(bytes32 a, bytes32 b, bytes32 c) internal pure returns (bytes32[] memory p) {
        p = new bytes32[](3);
        p[0] = a;
        p[1] = b;
        p[2] = c;
    }

    /// @dev Proof for vm.addr(i), i in 1..5, from the app's tree.
    function _proof(uint256 i) internal pure returns (bytes32[] memory) {
        if (i == 1) {
            return _p(
                0xe894f7c6a3339fd5cf42d3b0be5852c8ad49a362c78f551661142bc3ce8f4e43,
                0x6cf0097f042524f835616809205a097cf0638ac55071e132fca827c763d5b018
            );
        }
        if (i == 2) {
            return _p(
                0x6f5b375129e5d3e90227e2a092e5caff7cbd38b45a32e309f63ad206f53b06b9,
                0xf36a8b87aafd9478d7d2381b28af812b645a6b4ef1df15781b38e01ef44d0b5c,
                0x6cf0097f042524f835616809205a097cf0638ac55071e132fca827c763d5b018
            );
        }
        if (i == 3) {
            return _p(
                0xe7d19e19fc58c5b7ad9dbad9a950e0db19a5bea167aa6f33c8b3d02c01aeb698,
                0x9f179154080c96dffd7eca8e14049523021376d1eb94f79c55b94f3a0cfe7c1a
            );
        }
        if (i == 4) {
            return _p(
                0xc3471031e3ea1cc0e51362d274b9ff0776e75fd9ffec66a5b5a81f2cac8181a0,
                0x9f179154080c96dffd7eca8e14049523021376d1eb94f79c55b94f3a0cfe7c1a
            );
        }
        return _p(
            0xc11d5f852428be1a83be2f800e07f3989a67cb167beecc1948c11822236ba25c,
            0xf36a8b87aafd9478d7d2381b28af812b645a6b4ef1df15781b38e01ef44d0b5c,
            0x6cf0097f042524f835616809205a097cf0638ac55071e132fca827c763d5b018
        );
    }

    function _free() internal pure returns (TokenPrice[] memory p) {
        p = new TokenPrice[](1);
        p[0] = TokenPrice(address(0), 0);
    }

    /// @dev Phase 0: the list, free, 1 per wallet, `cap` in all. Phase 1: public, 0.01 ETH. Reserve 2 of 20.
    function _phases(uint32 cap) internal view returns (ERC721DropInstance.Phase[] memory phases) {
        phases = new ERC721DropInstance.Phase[](2);
        phases[0] = ERC721DropInstance.Phase({
            start: uint64(block.timestamp),
            end: 0,
            prices: _free(),
            maxPerWallet: 1,
            merkleRoot: ROOT,
            supplyCap: cap
        });
        TokenPrice[] memory pub = new TokenPrice[](1);
        pub[0] = TokenPrice(address(0), 0.01 ether);
        phases[1] = ERC721DropInstance.Phase({
            start: uint64(block.timestamp), end: 0, prices: pub, maxPerWallet: 0, merkleRoot: bytes32(0), supplyCap: 0
        });
    }

    function _drop(uint32 cap) internal returns (ERC721DropInstance d) {
        ERC721DropInstance.InitParams memory p;
        p.name = "miyamaker";
        p.symbol = "MIYA";
        p.maxSupply = 20;
        p.ownerReserve = 2;
        p.unrevealedURI = "ar://unrevealed.json";
        p.contractURI = "ar://contract.json";
        p.acceptedTokens = new address[](1);
        p.phases = _phases(cap);
        vm.prank(artist);
        d = ERC721DropInstance(payable(factory.createDrop(p, address(vault), 1000)));
    }

    function test_appProofsVerifyWithMerkleProofLib() public pure {
        for (uint256 i = 1; i <= 5; ++i) {
            bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(vm.addr(i)))));
            assertTrue(MerkleProofLib.verify(_proof(i), ROOT, leaf));
        }
        // A proof is for its own address only.
        bytes32 other = keccak256(bytes.concat(keccak256(abi.encode(vm.addr(6)))));
        assertFalse(MerkleProofLib.verify(_proof(1), ROOT, other));
    }

    function test_everyListedWalletClaimsOneFree() public {
        ERC721DropInstance d = _drop(0);
        for (uint256 i = 1; i <= 5; ++i) {
            vm.prank(vm.addr(i));
            d.mint(0, 1, _proof(i), address(0), 0);
            assertEq(d.balanceOf(vm.addr(i)), 1);
            assertEq(d.mintedInPhase(0, vm.addr(i)), 1);
        }
        // One per wallet.
        vm.prank(vm.addr(3));
        vm.expectRevert(ERC721DropInstance.WalletLimit.selector);
        d.mint(0, 1, _proof(3), address(0), 0);
        // Not on the list, or someone else's proof.
        vm.prank(vm.addr(6));
        vm.expectRevert(ERC721DropInstance.NotAllowlisted.selector);
        d.mint(0, 1, _proof(1), address(0), 0);
        // Free means value 0: sending ETH to a free phase is refused.
        vm.deal(vm.addr(6), 1 ether);
        vm.prank(vm.addr(6));
        vm.expectRevert(ERC721DropInstance.NotAllowlisted.selector);
        d.mint{ value: 0.01 ether }(0, 1, _proof(1), address(0), 0);
    }

    function test_mintToChecksThePayerNotTheRecipient() public {
        ERC721DropInstance d = _drop(0);
        address gift = vm.addr(9);
        vm.prank(vm.addr(2));
        d.mintTo(gift, 0, 1, _proof(2), address(0), 0);
        assertEq(d.balanceOf(gift), 1);
        assertEq(d.mintedInPhase(0, vm.addr(2)), 1);
        assertEq(d.mintedInPhase(0, gift), 0);
    }

    function test_phaseCapStopsTheList() public {
        ERC721DropInstance d = _drop(2);
        vm.prank(vm.addr(1));
        d.mint(0, 1, _proof(1), address(0), 0);
        vm.prank(vm.addr(2));
        d.mint(0, 1, _proof(2), address(0), 0);
        vm.prank(vm.addr(3));
        vm.expectRevert(ERC721DropInstance.PhaseSoldOut.selector);
        d.mint(0, 1, _proof(3), address(0), 0);
    }

    /// @dev Why scripts/refresh-phases.mts leaves claimers off the next list: setPhases starts every count again.
    function test_setPhasesResetsWalletAndPhaseCounts() public {
        ERC721DropInstance d = _drop(5);
        vm.prank(vm.addr(1));
        d.mint(0, 1, _proof(1), address(0), 0);
        vm.prank(artist);
        d.setPhases(_phases(4));
        assertEq(d.mintedInPhase(0, vm.addr(1)), 0);
        assertEq(d.phasesMinted()[0], 0);
        vm.prank(vm.addr(1));
        d.mint(0, 1, _proof(1), address(0), 0); // a second free one: the old claim no longer counts
        assertEq(d.balanceOf(vm.addr(1)), 2);
    }

    /// @dev setPhasePrices changes prices and keeps every count.
    function test_setPhasePricesKeepsCounts() public {
        ERC721DropInstance d = _drop(5);
        vm.prank(vm.addr(1));
        d.mint(0, 1, _proof(1), address(0), 0);
        TokenPrice[] memory pub = new TokenPrice[](1);
        pub[0] = TokenPrice(address(0), 0.02 ether);
        vm.prank(artist);
        d.setPhasePrices(1, pub);
        assertEq(d.mintedInPhase(0, vm.addr(1)), 1);
        assertEq(d.phasesMinted()[0], 1);
    }

    /// @dev The reserve is held back from every phase: the public phase can sell maxSupply - ownerReserve, no more.
    function test_reserveIsHeldBackFromPhases() public {
        ERC721DropInstance d = _drop(0);
        address buyer = vm.addr(7);
        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        d.mint{ value: 0.18 ether }(1, 18, new bytes32[](0), address(0), 0);
        vm.prank(buyer);
        vm.expectRevert(ERC721DropInstance.SoldOut.selector);
        d.mint{ value: 0.01 ether }(1, 1, new bytes32[](0), address(0), 0);
        vm.prank(artist);
        d.ownerMint(artist, 2);
        assertEq(d.totalSupply(), 20);
    }
}
