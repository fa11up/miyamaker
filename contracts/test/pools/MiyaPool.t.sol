// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC721 } from "solady/tokens/ERC721.sol";
import { ERC1155 } from "solady/tokens/ERC1155.sol";
import { MiyaPool } from "../../src/pools/MiyaPool.sol";
import { MiyaPoolFactory } from "../../src/pools/MiyaPoolFactory.sol";

contract Mock721 is ERC721 {
    function name() public pure override returns (string memory) {
        return "miyamaker mini";
    }

    function symbol() public pure override returns (string memory) {
        return "MIYAMINI";
    }

    function tokenURI(uint256) public pure override returns (string memory) {
        return "";
    }

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}

/// @dev A collection that refuses transfers to a blocked address.
contract Blocking721 is Mock721 {
    address public blocked;

    function setBlocked(address who) external {
        blocked = who;
    }

    function _beforeTokenTransfer(address, address to, uint256) internal view override {
        require(to == address(0) || to != blocked, "blocked");
    }
}

contract Mock1155 is ERC1155 {
    function uri(uint256) public pure override returns (string memory) {
        return "";
    }

    function mint(address to, uint256 id, uint256 amount) external {
        _mint(to, id, amount, "");
    }
}

/// @dev The checks UniAlignmentVault.receiveContribution makes on an ETH contribution, and a record of what arrived.
contract MockVault {
    uint256 public constant MIN_CONTRIBUTION = 0.001 ether;
    mapping(address benefactor => uint256) public ethOf;
    uint256 public totalEth;
    bool public refuse;

    function setRefuse(bool r) external {
        refuse = r;
    }

    function receiveContribution(address currency, uint256 amount, address benefactor) external payable {
        require(!refuse, "vault refused");
        require(currency == address(0), "eth only here");
        require(amount != 0 && msg.value == amount, "AmountMismatch");
        require(amount >= MIN_CONTRIBUTION, "ContributionBelowMinimum");
        require(benefactor != address(0), "InvalidAddress");
        ethOf[benefactor] += amount;
        totalEth += amount;
    }
}

contract NotAnNFT { }

contract MiyaPoolTest is Test {
    uint256 constant UNIT = 1e18;

    MiyaPoolFactory factory;
    MockVault vault;
    Mock721 nft;
    Mock1155 editions;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        vault = new MockVault();
        factory = new MiyaPoolFactory(address(vault));
        nft = new Mock721();
        editions = new Mock1155();
        for (uint256 id = 1; id <= 10; ++id) {
            nft.mint(alice, id);
        }
        editions.mint(alice, 1, 5);
        editions.mint(alice, 2, 3);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _pool721(uint16 premiumBps) internal returns (MiyaPool pool) {
        pool = MiyaPool(factory.createPool(address(nft), premiumBps));
        vm.prank(alice);
        nft.setApprovalForAll(address(pool), true);
    }

    function _pool721() internal returns (MiyaPool) {
        return _pool721(0);
    }

    function _pool1155(uint16 premiumBps) internal returns (MiyaPool pool) {
        pool = MiyaPool(factory.createPool(address(editions), premiumBps));
        vm.prank(alice);
        editions.setApprovalForAll(address(pool), true);
    }

    function _ids(uint256 a) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = a;
    }

    function _ids(uint256 a, uint256 b) internal pure returns (uint256[] memory r) {
        r = new uint256[](2);
        r[0] = a;
        r[1] = b;
    }

    function _ids(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory r) {
        r = new uint256[](3);
        r[0] = a;
        r[1] = b;
        r[2] = c;
    }

    function _ids(uint256 a, uint256 b, uint256 c, uint256 d) internal pure returns (uint256[] memory r) {
        r = new uint256[](4);
        r[0] = a;
        r[1] = b;
        r[2] = c;
        r[3] = d;
    }

    function _range(uint256 from, uint256 to) internal pure returns (uint256[] memory r) {
        r = new uint256[](to - from + 1);
        for (uint256 i; i < r.length; ++i) {
            r[i] = from + i;
        }
    }

    function _none() internal pure returns (uint256[] memory r) { }

    function _assertBacked(MiyaPool pool) internal view {
        assertEq(
            pool.totalSupply() + pool.premiumReserve() + UNIT * pool.pendingUnits(),
            UNIT * pool.heldUnits(),
            "accounting"
        );
        if (pool.randomEnabled()) {
            (uint256 head, uint256 tail) = pool.queueBounds();
            assertEq(tail - head, pool.heldUnits(), "queue length");
        }
    }

    function _mined(MiyaPool pool, uint256 commitId, bytes32 seed) internal {
        (, uint64 target,,) = pool.commits(commitId);
        if (block.number <= target) vm.roll(target + 1);
        vm.setBlockhash(target, seed);
    }

    function _onlyTokenOf(address who) internal view returns (uint256) {
        for (uint256 id = 1; id <= 20; ++id) {
            try nft.ownerOf(id) returns (address o) {
                if (o == who) return id;
            } catch { }
        }
        revert("none");
    }

    // ── factory ──────────────────────────────────────────────────────────────

    function test_factory_createsAndPredicts() public {
        address predicted = factory.predictPool(address(nft), MiyaPool.Kind.ERC721, 500);
        address pool = factory.createPool(address(nft), 500);
        assertEq(pool, predicted);
        assertEq(factory.poolOf(address(nft)), pool);
        assertEq(factory.allPoolsLength(), 1);
        assertEq(uint8(MiyaPool(pool).kind()), uint8(MiyaPool.Kind.ERC721));
        assertEq(MiyaPool(pool).collection(), address(nft));
        assertEq(MiyaPool(pool).premiumBps(), 500);
        assertEq(MiyaPool(pool).vault(), address(vault));
        assertEq(MiyaPool(pool).factory(), address(factory));
        assertTrue(MiyaPool(pool).randomEnabled());
        assertEq(MiyaPool(pool).premiumPerUnit(), 0.05e18);
        assertEq(MiyaPool(pool).targetedCost(3), 3.15e18);
    }

    function test_factory_predictDependsOnPremium() public view {
        assertTrue(
            factory.predictPool(address(nft), MiyaPool.Kind.ERC721, 0)
                != factory.predictPool(address(nft), MiyaPool.Kind.ERC721, 1)
        );
    }

    function test_factory_onePoolPerCollection() public {
        address a = factory.createPool(address(nft), 0);
        vm.expectRevert(abi.encodeWithSelector(MiyaPoolFactory.PoolExists.selector, a));
        factory.createPool(address(nft), 0);
        vm.expectRevert(abi.encodeWithSelector(MiyaPoolFactory.PoolExists.selector, a));
        factory.createPool(address(nft), 2000);
    }

    function test_factory_premiumCap() public {
        uint16 cap = MiyaPool(factory.createPool(address(editions), 0)).MAX_PREMIUM_BPS();
        assertEq(cap, 2000);
        vm.expectRevert(MiyaPool.PremiumTooHigh.selector);
        factory.createPool(address(nft), cap + 1);
        address pool = factory.createPool(address(nft), cap);
        assertEq(MiyaPool(pool).premiumPerUnit(), 0.2e18);
    }

    function test_factory_premiumNeedsAVault() public {
        MiyaPoolFactory bare = new MiyaPoolFactory(address(0));
        vm.expectRevert(MiyaPool.NoVault.selector);
        bare.createPool(address(nft), 1);
        address pool = bare.createPool(address(nft), 0);
        assertEq(MiyaPool(pool).vault(), address(0));
    }

    function test_factory_rejectsVaultWithoutCode() public {
        vm.expectRevert(MiyaPoolFactory.InvalidVault.selector);
        new MiyaPoolFactory(makeAddr("eoa vault"));
    }

    function test_factory_detects1155() public {
        address pool = factory.createPool(address(editions), 100);
        assertEq(uint8(MiyaPool(pool).kind()), uint8(MiyaPool.Kind.ERC1155));
        assertFalse(MiyaPool(pool).randomEnabled(), "random is ERC721 only");
    }

    function test_factory_rejectsNonNFT() public {
        address junk = address(new NotAnNFT());
        vm.expectRevert(MiyaPoolFactory.UnsupportedCollection.selector);
        factory.createPool(junk, 0);
        vm.expectRevert(MiyaPoolFactory.UnsupportedCollection.selector);
        factory.createPool(makeAddr("eoa"), 0);
    }

    function test_factory_rejectsCollectionThatClaimsEverything() public {
        ClaimsEverything c = new ClaimsEverything();
        vm.expectRevert(MiyaPoolFactory.UnsupportedCollection.selector);
        factory.createPool(address(c), 0);
    }

    function test_factory_rejectsCollectionFailingTheErc165Probe() public {
        Claims721AndInvalidId c = new Claims721AndInvalidId();
        vm.expectRevert(MiyaPoolFactory.UnsupportedCollection.selector);
        factory.createPool(address(c), 0);
    }

    // ── chains ───────────────────────────────────────────────────────────────

    function test_robinhoodChain_poolOpensWithoutRandomRedeems() public {
        vm.chainId(4663);
        MiyaPool pool = _pool721(500);
        assertFalse(pool.randomEnabled());
        deal(address(pool), alice, 0); // nothing yet
        vm.startPrank(alice);
        pool.deposit(_ids(1, 2, 3), _none(), alice);
        vm.expectRevert(MiyaPool.RandomUnavailable.selector);
        pool.commitRedeem(1, alice);
        // targeted still works, premium included
        pool.redeem(_ids(2), _none(), bob);
        vm.stopPrank();
        assertEq(nft.ownerOf(2), bob);
        assertEq(pool.premiumReserve(), 0.05e18);
        (uint256 head, uint256 tail) = pool.queueBounds();
        assertEq(head + tail, 0, "no queue kept without random redeems");
        assertFalse(pool.isLocked(1));
        _assertBacked(pool);
    }

    function test_mainnet_randomEnabled() public {
        vm.chainId(1);
        assertTrue(_pool721().randomEnabled());
    }

    function test_1155_commitReverts() public {
        MiyaPool pool = _pool1155(0);
        vm.startPrank(alice);
        pool.deposit(_ids(1), _ids(2), alice);
        vm.expectRevert(MiyaPool.RandomUnavailable.selector);
        pool.commitRedeem(1, alice);
        vm.stopPrank();
    }

    // ── hardening (audit round 1, kept) ──────────────────────────────────────

    function test_safeMintIntoPoolReverts() public {
        SafeMint721 m = new SafeMint721();
        MiyaPool p2 = MiyaPool(factory.createPool(address(m), 0));
        vm.expectRevert(MiyaPool.InvalidRecipient.selector);
        m.safeMint(address(p2), 7);
        assertEq(p2.totalSupply(), 0);
    }

    function test_secondHookForHeldIdCannotMintUnbackedTokens() public {
        MiyaPool pool = _pool721();
        vm.prank(alice);
        pool.deposit(_ids(1), _none(), alice);
        vm.prank(address(nft));
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.AlreadyHeld.selector, 1));
        pool.onERC721Received(address(nft), bob, 1, "");
        assertEq(pool.totalSupply(), UNIT);
    }

    /// New in v2: an escrowed id is still in the pool's custody; a hook for it must not mint tokens against it.
    function test_hookForEscrowedIdCannotMintUnbackedTokens() public {
        Blocking721 blocking = new Blocking721();
        address stuck = makeAddr("stuck");
        blocking.setBlocked(stuck);
        blocking.mint(alice, 1);
        MiyaPool pool = MiyaPool(factory.createPool(address(blocking), 0));
        vm.startPrank(alice);
        blocking.setApprovalForAll(address(pool), true);
        pool.deposit(_ids(1), _none(), alice);
        uint256 c = pool.commitRedeem(1, stuck);
        vm.stopPrank();
        _mined(pool, c, keccak256("e"));
        pool.revealRedeem(c);
        assertEq(pool.escrowedTo(1), stuck);
        vm.prank(address(blocking));
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.AlreadyHeld.selector, 1));
        pool.onERC721Received(address(blocking), bob, 1, "");
        _assertBacked(pool);
    }

    function test_poolCannotBeTheRecipient() public {
        MiyaPool pool = _pool721(500);
        vm.startPrank(alice);
        pool.deposit(_ids(1, 2), _none(), alice);
        vm.expectRevert(MiyaPool.InvalidRecipient.selector);
        pool.redeem(_ids(1), _none(), address(pool));
        vm.expectRevert(MiyaPool.InvalidRecipient.selector);
        pool.commitRedeem(1, address(pool));
        vm.stopPrank();
    }

    function test_heldIdsClampsHugeCount() public {
        MiyaPool pool = _pool721();
        vm.prank(alice);
        pool.deposit(_ids(1, 2, 3), _none(), alice);
        assertEq(pool.heldIds(1, type(uint256).max).length, 2);
    }

    function test_metadata() public {
        MiyaPool pool = _pool721();
        assertEq(pool.name(), "miya pool: miyamaker mini");
        assertEq(pool.symbol(), "mMIYAMINI");
        assertEq(pool.decimals(), 18);
    }

    // ── ERC721 deposits ──────────────────────────────────────────────────────

    function test_721_depositMintsOneUnitEach() public {
        MiyaPool pool = _pool721(500);
        vm.prank(alice);
        pool.deposit(_ids(1, 2, 3), _none(), alice);
        assertEq(pool.balanceOf(alice), 3 * UNIT);
        assertEq(pool.heldUnits(), 3);
        assertTrue(pool.isHeld(2));
        assertEq(nft.ownerOf(2), address(pool));
        assertEq(pool.queuePositionOf(1), 0);
        assertEq(pool.queuePositionOf(3), 2);
        _assertBacked(pool);
    }

    function test_721_depositToOtherRecipient() public {
        MiyaPool pool = _pool721();
        vm.prank(alice);
        pool.deposit(_ids(1), _none(), bob);
        assertEq(pool.balanceOf(bob), UNIT);
        assertEq(pool.balanceOf(alice), 0);
    }

    function test_721_directSafeTransferDeposits() public {
        MiyaPool pool = _pool721();
        vm.prank(alice);
        nft.safeTransferFrom(alice, address(pool), 4);
        assertEq(pool.balanceOf(alice), UNIT);
        _assertBacked(pool);
    }

    function test_721_plainTransferIsNotTracked() public {
        MiyaPool pool = _pool721();
        vm.prank(alice);
        nft.transferFrom(alice, address(pool), 4);
        assertEq(pool.totalSupply(), 0);
        assertEq(pool.heldUnits(), 0);
        _assertBacked(pool);
    }

    function test_721_hookOnlyFromCollection() public {
        MiyaPool pool = _pool721();
        vm.expectRevert(MiyaPool.NotCollection.selector);
        pool.onERC721Received(alice, alice, 1, "");
    }

    function test_721_hookChecksOwnership() public {
        MiyaPool pool = _pool721();
        vm.prank(address(nft));
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.TransferNotReceived.selector, 1));
        pool.onERC721Received(alice, alice, 1, "");
    }

    function test_depositEmptyReverts() public {
        MiyaPool pool = _pool721();
        vm.prank(alice);
        vm.expectRevert(MiyaPool.EmptyRequest.selector);
        pool.deposit(_none(), _none(), alice);
    }

    // ── targeted redeems ─────────────────────────────────────────────────────

    function test_721_targetedRedeemWithoutPremium() public {
        MiyaPool pool = _pool721();
        vm.prank(alice);
        pool.deposit(_ids(1, 2, 3), _none(), alice);
        vm.prank(alice);
        pool.transfer(bob, UNIT);
        vm.prank(bob);
        pool.redeem(_ids(3), _none(), bob);
        assertEq(nft.ownerOf(3), bob);
        assertEq(pool.balanceOf(bob), 0);
        assertFalse(pool.isHeld(3));
        assertEq(pool.heldUnits(), 2);
        assertEq(pool.premiumReserve(), 0);
        _assertBacked(pool);
    }

    function test_721_targetedRedeemPaysPremium() public {
        MiyaPool pool = _pool721(500);
        vm.prank(alice);
        pool.deposit(_ids(1, 2, 3, 4), _none(), alice);
        vm.prank(alice);
        pool.transfer(bob, 2.1e18);
        vm.expectEmit(address(pool));
        emit MiyaPool.PremiumPaid(bob, 0.1e18);
        vm.prank(bob);
        pool.redeem(_ids(4, 1), _none(), bob);
        assertEq(nft.ownerOf(1), bob);
        assertEq(nft.ownerOf(4), bob);
        assertEq(pool.balanceOf(bob), 0);
        assertEq(pool.premiumReserve(), 0.1e18);
        assertEq(pool.totalSupply(), 1.9e18, "the premium is out of circulation");
        _assertBacked(pool);
    }

    function test_721_targetedRedeemShortOfPremiumReverts() public {
        MiyaPool pool = _pool721(500);
        vm.prank(alice);
        pool.deposit(_ids(1, 2), _none(), alice);
        vm.prank(alice);
        pool.transfer(bob, UNIT);
        vm.prank(bob);
        vm.expectRevert(); // InsufficientBalance: 1e18 doesn't cover 1.05e18
        pool.redeem(_ids(1), _none(), bob);
    }

    function test_721_redeemNotHeldReverts() public {
        MiyaPool pool = _pool721();
        vm.prank(alice);
        pool.deposit(_ids(1, 2), _none(), alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.NotHeld.selector, 9));
        pool.redeem(_ids(9), _none(), alice);
    }

    function test_721_redeemDuplicateReverts() public {
        MiyaPool pool = _pool721();
        vm.prank(alice);
        pool.deposit(_ids(1, 2), _none(), alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.NotHeld.selector, 1));
        pool.redeem(_ids(1, 1), _none(), alice);
    }

    function test_721_redeemWithoutTokensReverts() public {
        MiyaPool pool = _pool721();
        vm.prank(alice);
        pool.deposit(_ids(1), _none(), alice);
        vm.prank(bob);
        vm.expectRevert();
        pool.redeem(_ids(1), _none(), bob);
    }

    function test_721_targetedRedeemKeepsQueueConsistent() public {
        MiyaPool pool = _pool721();
        vm.startPrank(alice);
        pool.deposit(_range(1, 6), _none(), alice);
        pool.redeem(_ids(2), _none(), alice); // id 6 moves into 2's place
        vm.stopPrank();
        assertEq(pool.queuePositionOf(6), 1);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.NotHeld.selector, 2));
        pool.queuePositionOf(2);
        _assertBacked(pool);
    }

    // ── ERC1155 ──────────────────────────────────────────────────────────────

    function test_1155_depositAndPartialRedeem() public {
        MiyaPool pool = _pool1155(0);
        vm.prank(alice);
        pool.deposit(_ids(1, 2), _ids(4, 3), alice);
        assertEq(pool.balanceOf(alice), 7 * UNIT);
        assertEq(pool.heldUnits(), 7);
        assertEq(pool.unitsOf(1), 4);

        vm.prank(alice);
        pool.redeem(_ids(1, 2), _ids(1, 3), bob);
        assertEq(editions.balanceOf(bob, 1), 1);
        assertEq(editions.balanceOf(bob, 2), 3);
        assertEq(pool.heldUnits(), 3);
        assertEq(pool.unitsOf(2), 0);
        assertEq(pool.heldIdsCount(), 1);
        _assertBacked(pool);
    }

    function test_1155_targetedRedeemPaysPremiumPerUnit() public {
        MiyaPool pool = _pool1155(1000);
        vm.prank(alice);
        pool.deposit(_ids(1, 2), _ids(5, 3), alice);
        vm.prank(alice);
        pool.redeem(_ids(1, 2), _ids(2, 1), bob);
        assertEq(pool.premiumReserve(), 0.3e18);
        assertEq(pool.balanceOf(alice), 8e18 - 3.3e18);
        _assertBacked(pool);
    }

    function test_1155_directTransferDeposits() public {
        MiyaPool pool = _pool1155(0);
        vm.prank(alice);
        editions.safeTransferFrom(alice, address(pool), 1, 2, "");
        assertEq(pool.balanceOf(alice), 2 * UNIT);
        _assertBacked(pool);
    }

    function test_1155_overRedeemReverts() public {
        MiyaPool pool = _pool1155(0);
        vm.prank(alice);
        pool.deposit(_ids(1), _ids(2), alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.NotHeld.selector, 1));
        pool.redeem(_ids(1), _ids(3), alice);
    }

    function test_1155_lengthMismatchReverts() public {
        MiyaPool pool = _pool1155(0);
        vm.prank(alice);
        vm.expectRevert(MiyaPool.LengthMismatch.selector);
        pool.deposit(_ids(1, 2), _ids(1), alice);
    }

    function test_1155_hookRejectedBy721Pool() public {
        MiyaPool pool = _pool721();
        vm.prank(address(nft));
        vm.expectRevert(MiyaPool.NotCollection.selector);
        pool.onERC1155Received(alice, alice, 1, 1, "");
    }

    // ── random redeems ───────────────────────────────────────────────────────

    function test_random_commitRevealIsFreeOfPremium() public {
        MiyaPool pool = _pool721(2000);
        vm.prank(alice);
        pool.deposit(_ids(1, 2, 3), _none(), alice);

        vm.prank(alice);
        uint256 id = pool.commitRedeem(2, bob);
        assertEq(pool.balanceOf(alice), UNIT, "exactly 1e18 per piece");
        assertEq(pool.premiumReserve(), 0);
        assertEq(pool.pendingUnits(), 2);
        _assertBacked(pool);

        vm.expectRevert(MiyaPool.TooEarly.selector);
        pool.revealRedeem(id);

        (, uint64 target,,) = pool.commits(id);
        vm.roll(target + 1);
        vm.setBlockhash(target, keccak256("seed"));
        vm.prank(makeAddr("anyone"));
        pool.revealRedeem(id);

        assertEq(nft.balanceOf(bob), 2);
        assertEq(pool.heldUnits(), 1);
        assertEq(pool.pendingUnits(), 0);
        _assertBacked(pool);

        vm.expectRevert(MiyaPool.UnknownCommit.selector);
        pool.revealRedeem(id);
    }

    function test_random_reservesHeldUnits() public {
        MiyaPool pool = _pool721();
        vm.startPrank(alice);
        pool.deposit(_ids(1, 2), _none(), alice);
        pool.commitRedeem(1, alice);
        pool.commitRedeem(1, alice);
        assertEq(pool.pendingUnits(), 2);
        pool.deposit(_ids(3), _none(), alice);
        pool.commitRedeem(1, alice);
        vm.stopPrank();
        _assertBacked(pool);
    }

    function test_random_rearmsWhenExpired() public {
        MiyaPool pool = _pool721();
        vm.prank(alice);
        pool.deposit(_ids(1, 2), _none(), alice);
        vm.prank(alice);
        uint256 id = pool.commitRedeem(1, alice);
        (, uint64 target,,) = pool.commits(id);

        vm.roll(target + 9000);
        pool.revealRedeem(id);
        (, uint64 rearmed,,) = pool.commits(id);
        assertEq(rearmed, block.number + 1);
        assertEq(nft.balanceOf(alice), 8);
        _assertBacked(pool);

        vm.roll(rearmed + 1);
        vm.setBlockhash(rearmed, keccak256("late"));
        pool.revealRedeem(id);
        assertEq(nft.balanceOf(alice), 9);
        _assertBacked(pool);
    }

    function test_random_lateDepositsDoNotShiftPick() public {
        MiyaPool pool = _pool721();
        vm.prank(alice);
        pool.deposit(_ids(1, 2, 3, 4), _none(), alice);
        vm.prank(alice);
        uint256 id = pool.commitRedeem(1, bob);
        _mined(pool, id, keccak256("fixed"));

        uint256 snap = vm.snapshotState();
        pool.revealRedeem(id);
        uint256 pickedWithout = _onlyTokenOf(bob);
        vm.revertToState(snap);

        vm.prank(alice);
        pool.deposit(_ids(5, 6, 7), _none(), alice);
        pool.revealRedeem(id);
        assertEq(_onlyTokenOf(bob), pickedWithout, "late deposits changed the pick");
    }

    function test_random_insufficientHeldReverts() public {
        MiyaPool pool = _pool721();
        vm.prank(alice);
        pool.deposit(_ids(1), _none(), alice);
        deal(address(pool), alice, 5 * UNIT, true);
        vm.prank(alice);
        vm.expectRevert(MiyaPool.InsufficientHeld.selector);
        pool.commitRedeem(2, alice);
    }

    function test_random_revealsRunInCommitOrder() public {
        MiyaPool pool = _pool721();
        vm.startPrank(alice);
        pool.deposit(_ids(1, 2, 3), _none(), alice);
        uint256 first = pool.commitRedeem(1, alice);
        uint256 second = pool.commitRedeem(1, bob);
        vm.stopPrank();
        _mined(pool, first, keccak256("a"));
        _mined(pool, second, keccak256("b"));

        vm.expectRevert(MiyaPool.NotNextCommit.selector);
        pool.revealRedeem(second);
        pool.revealRedeem(first);
        assertEq(pool.nextRevealId(), second);
        pool.revealRedeem(second);
    }

    function test_random_depositsAfterACommitAreNeverDrawn() public {
        MiyaPool pool = _pool721();
        vm.startPrank(alice);
        pool.deposit(_ids(1, 2, 3), _none(), alice);
        uint256 id = pool.commitRedeem(3, bob);
        pool.deposit(_ids(4, 5, 6), _none(), alice);
        vm.stopPrank();
        _mined(pool, id, keccak256("x"));
        pool.revealRedeem(id);
        for (uint256 tokenId = 1; tokenId <= 3; ++tokenId) {
            assertEq(nft.ownerOf(tokenId), bob);
        }
        for (uint256 tokenId = 4; tokenId <= 6; ++tokenId) {
            assertEq(nft.ownerOf(tokenId), address(pool));
        }
    }

    /// The M1 attack: with both outcomes public, deposit between two reveals to change what the second one gets.
    function testFuzz_random_depositBetweenRevealsCannotSteer(bytes32 seedA, bytes32 seedB) public {
        vm.assume(seedA != 0 && seedB != 0);
        MiyaPool pool = _pool721();
        vm.startPrank(alice);
        pool.deposit(_ids(1, 2, 3, 4), _none(), alice);
        uint256 first = pool.commitRedeem(2, makeAddr("first"));
        uint256 second = pool.commitRedeem(1, bob);
        vm.stopPrank();
        _mined(pool, first, seedA);
        _mined(pool, second, seedB);

        uint256 snap = vm.snapshotState();
        pool.revealRedeem(first);
        pool.revealRedeem(second);
        uint256 honest = _onlyTokenOf(bob);
        vm.revertToState(snap);

        vm.prank(alice);
        pool.deposit(_ids(5, 6), _none(), alice);
        pool.revealRedeem(first);
        vm.prank(alice);
        pool.deposit(_ids(7), _none(), alice);
        pool.revealRedeem(second);
        assertEq(_onlyTokenOf(bob), honest, "a deposit steered the pick");
    }

    function testFuzz_random_everyDrawIsDistinctAndEligible(bytes32 seed, uint8 extra) public {
        MiyaPool pool = _pool721();
        uint256 late = bound(extra, 0, 4);
        vm.startPrank(alice);
        pool.deposit(_ids(1, 2, 3), _none(), alice);
        uint256 a = pool.commitRedeem(2, bob);
        pool.deposit(_ids(4, 5, 6), _none(), alice);
        uint256 b = pool.commitRedeem(3, bob);
        if (late > 0) pool.deposit(_ids(7), _none(), alice);
        vm.stopPrank();
        _mined(pool, a, keccak256(abi.encode(seed, 1)));
        _mined(pool, b, keccak256(abi.encode(seed, 2)));
        pool.revealRedeem(a);
        pool.revealRedeem(b);
        assertEq(nft.balanceOf(bob), 5);
        assertEq(pool.pendingUnits(), 0);
        if (late > 0) assertEq(nft.ownerOf(7), address(pool));
        _assertBacked(pool);
    }

    // ── random and targeted on one pool ──────────────────────────────────────

    /// Every id a pending commit could draw is locked for targeted redeems, from the commit (before the target block
    /// exists) until the reveal; ids deposited after the newest pending commit stay free.
    function test_mixed_pendingCommitLocksItsRange() public {
        MiyaPool pool = _pool721(500);
        vm.startPrank(alice);
        pool.deposit(_range(1, 4), _none(), alice);
        uint256 c = pool.commitRedeem(1, bob);
        pool.deposit(_ids(5, 6), _none(), alice);

        for (uint256 id = 1; id <= 4; ++id) {
            assertTrue(pool.isLocked(id));
        }
        assertFalse(pool.isLocked(5));
        assertEq(pool.lockedEnd(), 4);

        // the commit's own block, and the target block: the hash isn't known yet, still locked
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.LockedForRandomRedeem.selector, 3));
        pool.redeem(_ids(3), _none(), alice);
        vm.roll(block.number + 1);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.LockedForRandomRedeem.selector, 1));
        pool.redeem(_ids(1), _none(), alice);
        // a mixed request fails whole
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.LockedForRandomRedeem.selector, 2));
        pool.redeem(_ids(5, 2), _none(), alice);

        // a later deposit is free
        pool.redeem(_ids(6), _none(), alice);
        assertEq(nft.ownerOf(6), alice);
        vm.stopPrank();
        _assertBacked(pool);

        _mined(pool, c, keccak256("unlock"));
        pool.revealRedeem(c);
        assertEq(pool.lockedEnd(), 0);
        uint256 got = _onlyTokenOf(bob);
        uint256 other = got == 1 ? 2 : 1;
        assertFalse(pool.isLocked(other));
        vm.prank(alice);
        pool.redeem(_ids(other), _none(), alice);
        assertEq(nft.ownerOf(other), alice);
        _assertBacked(pool);
    }

    /// The lock covers every pending commit: older commits' ranges are prefixes of the newest's.
    function test_mixed_lockFollowsTheNewestPendingCommit() public {
        MiyaPool pool = _pool721();
        vm.startPrank(alice);
        pool.deposit(_ids(1, 2), _none(), alice);
        uint256 a = pool.commitRedeem(1, bob);
        pool.deposit(_ids(3, 4), _none(), alice);
        assertFalse(pool.isLocked(3));
        uint256 b = pool.commitRedeem(1, bob);
        assertTrue(pool.isLocked(3), "the second commit locks what it can draw");
        vm.stopPrank();
        _mined(pool, a, keccak256("a"));
        _mined(pool, b, keccak256("b"));
        pool.revealRedeem(a);
        assertTrue(pool.isLocked(3) || pool.isLocked(4), "b still pending");
        pool.revealRedeem(b);
        assertEq(pool.lockedEnd(), 0);
    }

    /// Once the outcome is public nobody can change it with targeted redeems: the ids it could get are locked, and
    /// removing free ids (deposited after the commit) leaves the pick exactly where it was.
    function testFuzz_mixed_targetedRedeemsCannotSteerAPick(bytes32 seed, uint8 takeMask) public {
        vm.assume(seed != 0);
        MiyaPool pool = _pool721(1000);
        for (uint256 id = 11; id <= 14; ++id) {
            nft.mint(alice, id);
        }
        vm.startPrank(alice);
        pool.deposit(_range(1, 6), _none(), alice);
        uint256 c = pool.commitRedeem(2, bob);
        pool.deposit(_range(7, 14), _none(), alice);
        vm.stopPrank();
        _mined(pool, c, seed);

        uint256 snap = vm.snapshotState();
        pool.revealRedeem(c);
        uint256[2] memory honest = _twoOf(bob);
        vm.revertToState(snap);

        // An attacker who knows the hash tries every id: the drawable ones revert, the free ones go.
        vm.startPrank(alice);
        for (uint256 id = 1; id <= 14; ++id) {
            if (id <= 6) {
                vm.expectRevert(abi.encodeWithSelector(MiyaPool.LockedForRandomRedeem.selector, id));
                pool.redeem(_ids(id), _none(), alice);
            } else if (takeMask & (1 << (id % 8)) != 0) {
                pool.redeem(_ids(id), _none(), alice);
            }
        }
        // ...and deposits a couple more for good measure
        nft.mint(alice, 15);
        pool.deposit(_ids(15), _none(), alice);
        vm.stopPrank();
        pool.revealRedeem(c);
        uint256[2] memory got = _twoOf(bob);
        assertEq(got[0], honest[0], "pick moved");
        assertEq(got[1], honest[1], "pick moved");
        _assertBacked(pool);
    }

    /// The committer can't re-roll a pick they dislike by taking it away with a targeted redeem.
    function test_mixed_committerCannotRerollByTakingTheirPick() public {
        MiyaPool pool = _pool721();
        vm.startPrank(alice);
        pool.deposit(_range(1, 5), _none(), alice);
        uint256 c = pool.commitRedeem(1, alice);
        vm.stopPrank();
        _mined(pool, c, keccak256("dislike"));
        uint256 snap = vm.snapshotState();
        pool.revealRedeem(c);
        uint256 pick;
        for (uint256 id = 1; id <= 5; ++id) {
            if (nft.ownerOf(id) == alice) pick = id;
        }
        vm.revertToState(snap);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.LockedForRandomRedeem.selector, pick));
        pool.redeem(_ids(pick), _none(), alice);
    }

    /// A commit can always settle in full: targeted redeems can't shrink its range below what it reserved.
    function test_mixed_commitOfEveryHeldIdStillSettles() public {
        MiyaPool pool = _pool721();
        vm.startPrank(alice);
        pool.deposit(_range(1, 5), _none(), alice);
        uint256 c = pool.commitRedeem(5, bob);
        pool.deposit(_ids(6, 7), _none(), alice); // tokens to try with; these two stay free
        for (uint256 id = 1; id <= 5; ++id) {
            vm.expectRevert(abi.encodeWithSelector(MiyaPool.LockedForRandomRedeem.selector, id));
            pool.redeem(_ids(id), _none(), alice);
        }
        vm.stopPrank();
        _mined(pool, c, keccak256("all"));
        pool.revealRedeem(c);
        assertEq(nft.balanceOf(bob), 5);
        assertEq(nft.ownerOf(6), address(pool));
        assertEq(nft.ownerOf(7), address(pool));
        _assertBacked(pool);
    }

    function _twoOf(address who) internal view returns (uint256[2] memory r) {
        uint256 k;
        for (uint256 id = 1; id <= 20 && k < 2; ++id) {
            try nft.ownerOf(id) returns (address o) {
                if (o == who) r[k++] = id;
            } catch { }
        }
        require(k == 2, "expected two");
    }

    // ── ordered reveals must not be blockable ───────────────────────────────

    function test_random_zeroRecipientReverts() public {
        MiyaPool pool = _pool721();
        vm.startPrank(alice);
        pool.deposit(_ids(1), _none(), alice);
        vm.expectRevert(MiyaPool.InvalidRecipient.selector);
        pool.commitRedeem(1, address(0));
        vm.stopPrank();
    }

    function test_random_commitIsCapped() public {
        MiyaPool pool = _pool721();
        uint256 cap = pool.MAX_COMMIT_UNITS();
        vm.prank(alice);
        vm.expectRevert(MiyaPool.CommitTooLarge.selector);
        pool.commitRedeem(cap + 1, alice);
    }

    function test_random_largestRevealFitsInABlock() public {
        MiyaPool pool = _pool721();
        uint256 cap = pool.MAX_COMMIT_UNITS();
        for (uint256 tokenId = 100; tokenId < 100 + cap; ++tokenId) {
            nft.mint(alice, tokenId);
        }
        uint256[] memory ids = new uint256[](cap);
        for (uint256 i; i < cap; ++i) {
            ids[i] = 100 + i;
        }
        vm.startPrank(alice);
        pool.deposit(ids, _none(), alice);
        uint256 id = pool.commitRedeem(cap, bob);
        vm.stopPrank();
        _mined(pool, id, keccak256("big"));
        uint256 start = gasleft();
        pool.revealRedeem(id);
        uint256 used = start - gasleft();
        emit log_named_uint("reveal gas (50 ids)", used);
        assertLt(used, 10_000_000, "reveal must stay well under the block gas limit");
    }

    function test_gasBurningRecipientCannotBlockQueue() public {
        Notify721 n = new Notify721();
        for (uint256 id = 1; id <= 6; ++id) {
            n.mint(alice, id);
        }
        MiyaPool pool = MiyaPool(factory.createPool(address(n), 0));
        vm.startPrank(alice);
        n.setApprovalForAll(address(pool), true);
        pool.deposit(_range(1, 6), _none(), alice);
        pool.transfer(bob, UNIT);
        uint256 c0 = pool.commitRedeem(5, address(new GasBurner()));
        vm.stopPrank();
        vm.prank(bob);
        uint256 c1 = pool.commitRedeem(1, bob);
        vm.roll(block.number + 2);

        pool.revealRedeem{ gas: 10_000_000 }(c0);
        assertEq(pool.nextRevealId(), c1, "queue moved past the burner");
        pool.revealRedeem(c1);
        assertEq(n.balanceOf(bob), 1);
    }

    function test_largestRevealToGasBurnerFitsMainnetGasCap() public {
        RefusingNotify721 n = new RefusingNotify721();
        uint256[] memory ids = new uint256[](50);
        for (uint256 i; i < 50; ++i) {
            ids[i] = i + 1;
            n.mint(alice, i + 1);
        }
        MiyaPool pool = MiyaPool(factory.createPool(address(n), 0));
        vm.startPrank(alice);
        n.setApprovalForAll(address(pool), true);
        pool.deposit(ids, _none(), alice);
        address burner = address(new GasBurner());
        n.setNotified(burner);
        uint256 c = pool.commitRedeem(50, burner);
        vm.stopPrank();
        vm.roll(block.number + 2);

        uint256 before = gasleft();
        pool.revealRedeem{ gas: 16_777_216 }(c);
        emit log_named_uint("worst-case reveal gas", before - gasleft());
        assertEq(pool.nextRevealId(), c + 1);
        for (uint256 i; i < 50; ++i) {
            assertTrue(pool.escrowedTo(i + 1) != address(0));
        }
    }

    function test_revealWithTooLittleGasRevertsInsteadOfEscrowing() public {
        MiyaPool pool = _pool721();
        vm.startPrank(alice);
        pool.deposit(_ids(1), _none(), alice);
        uint256 c = pool.commitRedeem(1, bob);
        vm.stopPrank();
        vm.roll(block.number + 2);
        vm.expectRevert(MiyaPool.RevealGasTooLow.selector);
        pool.revealRedeem{ gas: 200_000 }(c);
        assertEq(pool.escrowedTo(1), address(0));
    }

    function test_random_refusedTransferIsEscrowedAndDoesNotBlockTheQueue() public {
        Blocking721 blocking = new Blocking721();
        address stuck = makeAddr("stuck");
        blocking.setBlocked(stuck);
        for (uint256 tokenId = 1; tokenId <= 2; ++tokenId) {
            blocking.mint(alice, tokenId);
        }
        MiyaPool pool = MiyaPool(factory.createPool(address(blocking), 0));
        vm.startPrank(alice);
        blocking.setApprovalForAll(address(pool), true);
        pool.deposit(_ids(1, 2), _none(), alice);
        uint256 first = pool.commitRedeem(1, stuck);
        uint256 second = pool.commitRedeem(1, bob);
        vm.stopPrank();
        _mined(pool, first, keccak256("a"));
        _mined(pool, second, keccak256("b"));

        pool.revealRedeem(first);
        pool.revealRedeem(second);
        assertEq(blocking.balanceOf(bob), 1, "the next commit still settled");

        uint256 escrowed = blocking.ownerOf(1) == address(pool) ? 1 : 2;
        assertEq(pool.escrowedTo(escrowed), stuck);
        assertEq(pool.heldUnits(), 0);

        // an escrowed id can't be taken by a targeted redeem either
        deal(address(pool), alice, UNIT, true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.NotHeld.selector, escrowed));
        pool.redeem(_ids(escrowed), _none(), alice);

        vm.prank(alice);
        vm.expectRevert(MiyaPool.NotEscrowed.selector);
        pool.claimEscrowed(escrowed, alice);

        address elsewhere = makeAddr("elsewhere");
        vm.prank(stuck);
        pool.claimEscrowed(escrowed, elsewhere);
        assertEq(blocking.ownerOf(escrowed), elsewhere);
        assertEq(pool.escrowedTo(escrowed), address(0));
    }

    // ── premium lots: the premium reaches the vault as ETH ───────────────────

    /// Five targeted redeems at 20% build one whole token; the lot goes on sale only then.
    function _poolWithOneLot() internal returns (MiyaPool pool) {
        for (uint256 id = 11; id <= 16; ++id) {
            nft.mint(alice, id);
        }
        pool = _pool721(2000);
        vm.startPrank(alice);
        pool.deposit(_range(1, 16), _none(), alice);
        pool.redeem(_ids(1, 2, 3, 4), _none(), alice);
        vm.stopPrank();
        assertEq(pool.premiumReserve(), 0.8e18);
        assertFalse(pool.lotAvailable());
        vm.expectRevert(MiyaPool.NoLot.selector);
        pool.buyLot(bob, bob);
        // time passing before a lot exists doesn't lower the first lot's price
        vm.warp(block.timestamp + 30 days);
        assertEq(pool.lotPrice(), pool.FIRST_LOT_PRICE());
        vm.prank(alice);
        pool.redeem(_ids(5), _none(), alice);
        assertEq(pool.premiumReserve(), UNIT);
        assertTrue(pool.lotAvailable());
    }

    function test_lot_priceFallsByHalfEachHalfLife() public {
        MiyaPool pool = _poolWithOneLot();
        uint256 start = pool.FIRST_LOT_PRICE();
        uint256 h = pool.LOT_HALF_LIFE();
        assertEq(pool.lotPrice(), start);
        vm.warp(block.timestamp + h / 2);
        assertEq(pool.lotPrice(), start * 3 / 4);
        vm.warp(block.timestamp + h / 2);
        assertEq(pool.lotPrice(), start / 2);
        vm.warp(block.timestamp + h);
        assertEq(pool.lotPrice(), start / 4);
        vm.warp(block.timestamp + 100 * h);
        assertEq(pool.lotPrice(), pool.MIN_LOT_PRICE(), "floored at the vault's minimum");
        vm.warp(block.timestamp + 10_000 * h);
        assertEq(pool.lotPrice(), pool.MIN_LOT_PRICE());
    }

    function testFuzz_lot_priceNeverRisesWhileOnSale(uint32 a, uint32 b) public {
        MiyaPool pool = _poolWithOneLot();
        (uint256 t1, uint256 t2) = a < b ? (uint256(a), uint256(b)) : (uint256(b), uint256(a));
        uint256 t0 = block.timestamp;
        vm.warp(t0 + t1);
        uint256 p1 = pool.lotPrice();
        vm.warp(t0 + t2);
        uint256 p2 = pool.lotPrice();
        assertLe(p2, p1);
        assertGe(p2, pool.MIN_LOT_PRICE());
        assertLe(p1, pool.FIRST_LOT_PRICE());
    }

    function test_lot_saleSendsEthToTheVaultAndMintsAWholeToken() public {
        MiyaPool pool = _poolWithOneLot();
        vm.warp(block.timestamp + 3 * pool.LOT_HALF_LIFE()); // 1.25 ETH
        uint256 price = pool.lotPrice();
        assertEq(price, 1.25 ether);
        address buyer = makeAddr("buyer");
        address benefactor = makeAddr("benefactor");
        vm.deal(buyer, 2 ether);
        uint256 supplyBefore = pool.totalSupply();

        vm.expectEmit(address(pool));
        emit MiyaPool.LotSold(buyer, bob, benefactor, price);
        vm.prank(buyer);
        uint256 paid = pool.buyLot{ value: 2 ether }(bob, benefactor);

        assertEq(paid, price);
        assertEq(pool.balanceOf(bob), UNIT);
        assertEq(pool.totalSupply(), supplyBefore + UNIT);
        assertEq(pool.premiumReserve(), 0);
        assertEq(vault.ethOf(benefactor), price, "the premium's ETH is the benefactor's contribution");
        assertEq(buyer.balance, 2 ether - price, "excess refunded");
        assertEq(address(pool).balance, 0, "the pool never holds ETH");
        assertEq(pool.lotStartPrice(), 2 * price, "the next lot starts at twice this sale");
        _assertBacked(pool);

        // the lot is a whole token: it redeems a piece at once (random: free of premium)
        vm.prank(bob);
        uint256 c = pool.commitRedeem(1, bob);
        _mined(pool, c, keccak256("lot"));
        pool.revealRedeem(c);
        assertEq(pool.balanceOf(bob), 0);
        _assertBacked(pool);
    }

    function test_lot_underpaymentReverts() public {
        MiyaPool pool = _poolWithOneLot();
        uint256 price = pool.lotPrice();
        vm.deal(bob, price);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.PriceNotMet.selector, price));
        pool.buyLot{ value: price - 1 }(bob, bob);
    }

    function test_lot_badRecipientsRevert() public {
        MiyaPool pool = _poolWithOneLot();
        vm.deal(bob, 20 ether);
        vm.startPrank(bob);
        vm.expectRevert(MiyaPool.InvalidRecipient.selector);
        pool.buyLot{ value: 10 ether }(address(0), bob);
        vm.expectRevert(MiyaPool.InvalidRecipient.selector);
        pool.buyLot{ value: 10 ether }(address(pool), bob);
        vm.expectRevert(MiyaPool.InvalidRecipient.selector);
        pool.buyLot{ value: 10 ether }(bob, address(0));
        vm.stopPrank();
    }

    function test_lot_vaultRefusalRevertsTheWholeSale() public {
        MiyaPool pool = _poolWithOneLot();
        vault.setRefuse(true);
        vm.deal(bob, 10 ether);
        vm.prank(bob);
        vm.expectRevert(bytes("vault refused"));
        pool.buyLot{ value: 10 ether }(bob, bob);
        assertEq(pool.premiumReserve(), UNIT);
        assertEq(pool.balanceOf(bob), 0);
        // targeted redeems never touch the vault, so they keep working
        vm.prank(alice);
        pool.redeem(_ids(6), _none(), alice);
        _assertBacked(pool);
    }

    function test_lot_refusedRefundReverts() public {
        MiyaPool pool = _poolWithOneLot();
        RejectsEth buyer = new RejectsEth();
        vm.deal(address(buyer), 20 ether);
        vm.prank(address(buyer));
        vm.expectRevert();
        pool.buyLot{ value: 20 ether }(bob, bob);
        // exact payment needs no refund
        uint256 price = pool.lotPrice();
        vm.prank(address(buyer));
        pool.buyLot{ value: price }(bob, bob);
        assertEq(pool.balanceOf(bob), UNIT);
    }

    /// Several lots: each sells in turn; the next starts at twice the last sale, at once if a lot is still there.
    function test_lot_backToBackLotsAndReserveCarry() public {
        for (uint256 id = 11; id <= 20; ++id) {
            nft.mint(alice, id);
        }
        MiyaPool pool = _pool721(2000);
        vm.startPrank(alice);
        pool.deposit(_range(1, 20), _none(), alice);
        pool.redeem(_range(1, 11), _none(), alice); // 11 x 0.2 = 2.2 tokens of premium
        vm.stopPrank();
        assertEq(pool.premiumReserve(), 2.2e18);
        vm.warp(block.timestamp + 10 * pool.LOT_HALF_LIFE());
        uint256 p1 = pool.lotPrice();
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        pool.buyLot{ value: p1 }(bob, bob);
        assertEq(pool.lotPrice(), 2 * p1, "second lot on sale at once, from twice the first");
        vm.warp(block.timestamp + pool.LOT_HALF_LIFE());
        uint256 p2 = pool.lotPrice();
        assertEq(p2, p1);
        vm.prank(bob);
        pool.buyLot{ value: p2 }(bob, bob);
        assertEq(pool.premiumReserve(), 0.2e18);
        assertFalse(pool.lotAvailable());
        assertEq(vault.totalEth(), p1 + p2);
        _assertBacked(pool);
    }

    function test_lot_noPremiumNoLots() public {
        MiyaPool pool = _pool721(0);
        vm.startPrank(alice);
        pool.deposit(_range(1, 10), _none(), alice);
        pool.redeem(_range(1, 10), _none(), alice);
        vm.stopPrank();
        assertEq(pool.premiumReserve(), 0);
        vm.expectRevert(MiyaPool.NoLot.selector);
        pool.buyLot(bob, bob);
    }
}

contract ClaimsEverything {
    function supportsInterface(bytes4) external pure returns (bool) {
        return true;
    }
}

contract SafeMint721 is Mock721 {
    function safeMint(address to, uint256 id) external {
        _safeMint(to, id);
    }
}

/// @dev A collection whose plain transferFrom notifies contract recipients and ignores failures.
contract Notify721 is Mock721 {
    function transferFrom(address from, address to, uint256 id) public payable override {
        super.transferFrom(from, to, id);
        if (to.code.length != 0) {
            try GasBurner(payable(to)).onNotify() { } catch { }
        }
    }
}

contract GasBurner {
    function onNotify() external pure {
        while (true) { }
    }
}

contract RejectsEth { }

/// @dev Answers true for everything except ERC-1155, so only the ERC-165 probe can catch it.
contract Claims721AndInvalidId {
    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id != 0xd9b67a26;
    }
}

/// @dev Calls contract recipients on transferFrom and lets their failure refuse the transfer.
contract RefusingNotify721 is Mock721 {
    address public notified;

    function setNotified(address who) external {
        notified = who;
    }

    function transferFrom(address from, address to, uint256 id) public payable override {
        super.transferFrom(from, to, id);
        if (to == notified) GasBurner(to).onNotify();
    }
}
