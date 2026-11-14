// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC721 } from "solady/tokens/ERC721.sol";
import { ERC1155 } from "solady/tokens/ERC1155.sol";
import { ERC20 } from "solady/tokens/ERC20.sol";
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

contract MockToken is ERC20 {
    string internal _n;

    constructor(string memory n) {
        _n = n;
    }

    function name() public view override returns (string memory) {
        return _n;
    }

    function symbol() public view override returns (string memory) {
        return _n;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev A fee-on-transfer token, to show the pool refuses a short pull.
contract TaxToken is MockToken("TAX") {
    function _afterTokenTransfer(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0) && to != address(0xdead)) {
            _transfer(to, address(0xdead), amount / 100);
        }
    }
}

/// @dev The checks UniAlignmentVault.receiveContribution makes, its config (minContribution) and registry
///      (isPaymentToken) in one, and a record of what each benefactor contributed.
contract MockVault {
    address public imd;
    address public infer;
    mapping(address token => uint256) public minContribution;
    mapping(address token => bool) public isPaymentToken;
    mapping(address benefactor => mapping(address token => uint256)) public pendingOf;
    mapping(address token => uint256) public totalOf;
    bool public refuse;
    bool public pullLess;

    constructor(address imd_, address infer_) {
        (imd, infer) = (imd_, infer_);
        isPaymentToken[imd_] = true;
        isPaymentToken[infer_] = true;
        minContribution[imd_] = 1e18;
        minContribution[infer_] = 3500e18;
    }

    function config() external view returns (address) {
        return address(this);
    }

    function registry() external view returns (address) {
        return address(this);
    }

    function setRefuse(bool r) external {
        refuse = r;
    }

    function setPullLess(bool r) external {
        pullLess = r;
    }

    function setPaymentToken(address token, bool ok) external {
        isPaymentToken[token] = ok;
    }

    function setMin(address token, uint256 m) external {
        minContribution[token] = m;
    }

    function receiveContribution(address currency, uint256 amount, address benefactor) external payable virtual {
        require(!refuse, "vault refused");
        require(amount != 0, "AmountMustBePositive");
        require(benefactor != address(0), "InvalidAddress");
        require(msg.value == 0, "AmountMismatch");
        require(isPaymentToken[currency], "TokenNotAllowed");
        require(amount >= minContribution[currency], "ContributionBelowMinimum");
        uint256 before = ERC20(currency).balanceOf(address(this));
        ERC20(currency).transferFrom(msg.sender, address(this), pullLess ? amount - 1 : amount);
        if (!pullLess) require(ERC20(currency).balanceOf(address(this)) - before == amount, "ReceivedLess");
        pendingOf[benefactor][currency] += amount;
        totalOf[currency] += amount;
    }
}

contract NotAnNFT { }

contract MiyaPoolTest is Test {
    uint256 constant UNIT = 1e18;

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
        for (uint256 id = 1; id <= 10; ++id) {
            nft.mint(alice, id);
        }
        editions.mint(alice, 1, 5);
        editions.mint(alice, 2, 3);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _pool721(uint256 imdFee, uint256 inferFee) internal returns (MiyaPool pool) {
        pool = MiyaPool(factory.createPool(address(nft), imdFee, inferFee));
        vm.prank(alice);
        nft.setApprovalForAll(address(pool), true);
    }

    function _pool721() internal returns (MiyaPool) {
        return _pool721(0, 0);
    }

    function _pool1155() internal returns (MiyaPool) {
        return _pool1155(0, 0);
    }

    function _pool1155(uint256 imdFee, uint256 inferFee) internal returns (MiyaPool pool) {
        pool = MiyaPool(factory.createPool(address(editions), imdFee, inferFee));
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
        assertEq(pool.totalSupply() + UNIT * pool.pendingUnits(), UNIT * pool.heldUnits(), "accounting");
        assertEq(imd.balanceOf(address(pool)), 0, "pool kept IMD");
        assertEq(infer.balanceOf(address(pool)), 0, "pool kept INFER");
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
        address predicted = factory.predictPool(address(nft), MiyaPool.Kind.ERC721, 2e18, 5000e18);
        address pool = factory.createPool(address(nft), 2e18, 5000e18);
        assertEq(pool, predicted);
        assertEq(factory.poolOf(address(nft)), pool);
        assertEq(factory.allPoolsLength(), 1);
        assertEq(factory.imd(), address(imd));
        assertEq(factory.infer(), address(infer));
        MiyaPool p = MiyaPool(pool);
        assertEq(uint8(p.kind()), uint8(MiyaPool.Kind.ERC721));
        assertEq(p.collection(), address(nft));
        assertEq(p.vault(), address(vault));
        assertEq(p.imd(), address(imd));
        assertEq(p.infer(), address(infer));
        assertEq(p.imdFee(), 2e18);
        assertEq(p.inferFee(), 5000e18);
        assertEq(p.factory(), address(factory));
        assertTrue(p.randomEnabled());
        assertFalse(p.picksFree());
        assertEq(p.pickFee(address(imd), 3), 6e18);
        assertEq(p.pickFee(address(infer), 2), 10_000e18);
    }

    function test_factory_predictDependsOnFees() public view {
        address a = factory.predictPool(address(nft), MiyaPool.Kind.ERC721, 0, 0);
        assertTrue(a != factory.predictPool(address(nft), MiyaPool.Kind.ERC721, 1e18, 0));
        assertTrue(a != factory.predictPool(address(nft), MiyaPool.Kind.ERC721, 0, 3500e18));
    }

    function test_factory_onePoolPerCollection() public {
        address a = factory.createPool(address(nft), 0, 0);
        vm.expectRevert(abi.encodeWithSelector(MiyaPoolFactory.PoolExists.selector, a));
        factory.createPool(address(nft), 0, 0);
        vm.expectRevert(abi.encodeWithSelector(MiyaPoolFactory.PoolExists.selector, a));
        factory.createPool(address(nft), 1e18, 3500e18);
    }

    /// Each offered fee must be at least the vault's minimum contribution for its token, read from the vault's config.
    function test_factory_feesAtLeastTheVaultMinimums() public {
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.FeeBelowVaultMinimum.selector, address(imd), 1e18));
        factory.createPool(address(nft), 1e18 - 1, 0);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.FeeBelowVaultMinimum.selector, address(infer), 3500e18));
        factory.createPool(address(nft), 0, 3500e18 - 1);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.FeeBelowVaultMinimum.selector, address(infer), 3500e18));
        factory.createPool(address(nft), 5e18, 1);
        // exactly the minimums
        MiyaPool p = MiyaPool(factory.createPool(address(nft), 1e18, 3500e18));
        assertEq(p.imdFee(), 1e18);
        // a minimum raised later binds only new pools
        vault.setMin(address(imd), 2e18);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.FeeBelowVaultMinimum.selector, address(imd), 2e18));
        factory.createPool(address(editions), 1e18, 0);
    }

    function test_factory_feeTokenMustBeAVaultPaymentToken() public {
        vault.setPaymentToken(address(infer), false);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.FeeTokenNotAccepted.selector, address(infer)));
        factory.createPool(address(nft), 0, 3500e18);
        // IMD alone is fine
        factory.createPool(address(nft), 1e18, 0);
    }

    function test_factory_feesNeedAVault() public {
        MiyaPoolFactory bare = new MiyaPoolFactory(address(0));
        assertEq(bare.imd(), address(0));
        vm.expectRevert(MiyaPool.NoVault.selector);
        bare.createPool(address(nft), 1e18, 0);
        vm.expectRevert(MiyaPool.NoVault.selector);
        bare.createPool(address(nft), 0, 3500e18);
        MiyaPool p = MiyaPool(bare.createPool(address(nft), 0, 0));
        assertEq(p.vault(), address(0));
        assertTrue(p.picksFree());
    }

    /// The launch rehearses the constructor on an empty chain (no vault code), so it must not read the vault. A pool
    /// with a fee still needs the vault to exist when it is created.
    function test_factory_deploysWithAVaultWithoutCodeAndReadsItLazily() public {
        address eoaVault = makeAddr("eoa vault");
        MiyaPoolFactory f = new MiyaPoolFactory(eoaVault);
        assertEq(f.vault(), eoaVault);
        assertEq(f.imd(), address(0));
        assertEq(f.infer(), address(0));
        vm.expectRevert(MiyaPool.NoVault.selector);
        f.createPool(address(nft), 1e18, 0);
        vm.expectRevert(MiyaPool.NoVault.selector);
        f.createPool(address(editions), 0, 3500e18);
        MiyaPool p = MiyaPool(f.createPool(address(nft), 0, 0));
        assertTrue(p.picksFree());
        assertEq(p.vault(), eoaVault);
        // once the vault exists at that address, the factory answers with its tokens and fee pools can be created
        vm.etch(eoaVault, address(vault).code);
        vm.store(eoaVault, bytes32(uint256(0)), bytes32(uint256(uint160(address(imd)))));
        vm.store(eoaVault, bytes32(uint256(1)), bytes32(uint256(uint160(address(infer)))));
        vm.store(eoaVault, keccak256(abi.encode(address(imd), uint256(2))), bytes32(uint256(1e18)));
        vm.store(eoaVault, keccak256(abi.encode(address(imd), uint256(3))), bytes32(uint256(1)));
        assertEq(f.imd(), address(imd));
        assertEq(f.infer(), address(infer));
        MiyaPool q = MiyaPool(f.createPool(address(editions), 1e18, 0));
        assertEq(q.imd(), address(imd));
        assertEq(q.imdFee(), 1e18);
    }

    function test_factory_detects1155() public {
        address pool = factory.createPool(address(editions), 1e18, 0);
        assertEq(uint8(MiyaPool(pool).kind()), uint8(MiyaPool.Kind.ERC1155));
        assertFalse(MiyaPool(pool).randomEnabled(), "random is ERC721 only");
    }

    function test_factory_rejectsNonNFT() public {
        address junk = address(new NotAnNFT());
        vm.expectRevert(MiyaPoolFactory.UnsupportedCollection.selector);
        factory.createPool(junk, 0, 0);
        vm.expectRevert(MiyaPoolFactory.UnsupportedCollection.selector);
        factory.createPool(makeAddr("eoa"), 0, 0);
    }

    function test_factory_rejectsCollectionThatClaimsEverything() public {
        ClaimsEverything c = new ClaimsEverything();
        vm.expectRevert(MiyaPoolFactory.UnsupportedCollection.selector);
        factory.createPool(address(c), 0, 0);
    }

    function test_factory_rejectsCollectionFailingTheErc165Probe() public {
        Claims721AndInvalidId c = new Claims721AndInvalidId();
        vm.expectRevert(MiyaPoolFactory.UnsupportedCollection.selector);
        factory.createPool(address(c), 0, 0);
    }

    // ── chains ───────────────────────────────────────────────────────────────

    function test_robinhoodChain_poolOpensWithoutRandomRedeems() public {
        vm.chainId(4663);
        MiyaPool pool = _pool721(1e18, 0);
        assertFalse(pool.randomEnabled());
        imd.mint(alice, 1e18);
        vm.startPrank(alice);
        pool.deposit(_ids(1, 2, 3), _none(), alice);
        vm.expectRevert(MiyaPool.RandomUnavailable.selector);
        pool.commitRedeem(1, alice);
        // picks still work, fee included
        imd.approve(address(pool), 1e18);
        pool.redeem(_ids(2), _none(), bob, address(imd));
        vm.stopPrank();
        assertEq(nft.ownerOf(2), bob);
        assertEq(vault.pendingOf(alice, address(imd)), 1e18);
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
        MiyaPool pool = _pool1155();
        vm.startPrank(alice);
        pool.deposit(_ids(1), _ids(2), alice);
        vm.expectRevert(MiyaPool.RandomUnavailable.selector);
        pool.commitRedeem(1, alice);
        vm.stopPrank();
    }

    // ── hardening (audit round 1, kept) ──────────────────────────────────────

    function test_safeMintIntoPoolReverts() public {
        SafeMint721 m = new SafeMint721();
        MiyaPool p2 = MiyaPool(factory.createPool(address(m), 0, 0));
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
        MiyaPool pool = MiyaPool(factory.createPool(address(blocking), 0, 0));
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
        MiyaPool pool = _pool721();
        vm.startPrank(alice);
        pool.deposit(_ids(1, 2), _none(), alice);
        vm.expectRevert(MiyaPool.InvalidRecipient.selector);
        pool.redeem(_ids(1), _none(), address(pool), address(0));
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
        MiyaPool pool = _pool721();
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

    function test_721_freePick() public {
        MiyaPool pool = _pool721();
        vm.prank(alice);
        pool.deposit(_ids(1, 2, 3), _none(), alice);
        vm.prank(alice);
        pool.transfer(bob, UNIT);
        vm.prank(bob);
        pool.redeem(_ids(3), _none(), bob, address(0));
        assertEq(nft.ownerOf(3), bob);
        assertEq(pool.balanceOf(bob), 0);
        assertFalse(pool.isHeld(3));
        assertEq(pool.heldUnits(), 2);
        _assertBacked(pool);
    }

    function test_721_freePickRefusesAFeeToken() public {
        MiyaPool pool = _pool721();
        vm.startPrank(alice);
        pool.deposit(_ids(1), _none(), alice);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.FeeTokenNotOffered.selector, address(imd)));
        pool.redeem(_ids(1), _none(), alice, address(imd));
        vm.stopPrank();
    }

    function _bobWithTokens(MiyaPool pool, uint256 units) internal {
        vm.prank(alice);
        pool.transfer(bob, units * UNIT);
    }

    function test_721_pickPaysTheFeeInImdToTheVaultForThePicker() public {
        MiyaPool pool = _pool721(2e18, 0);
        vm.prank(alice);
        pool.deposit(_ids(1, 2, 3, 4), _none(), alice);
        _bobWithTokens(pool, 2);
        imd.mint(bob, 4e18);
        vm.startPrank(bob);
        imd.approve(address(pool), 4e18);
        vm.expectEmit(address(pool));
        emit MiyaPool.PickFeePaid(bob, address(imd), 4e18);
        pool.redeem(_ids(4, 1), _none(), makeAddr("elsewhere"), address(imd));
        vm.stopPrank();
        assertEq(nft.ownerOf(1), makeAddr("elsewhere"));
        assertEq(pool.balanceOf(bob), 0, "exactly 1 token per piece");
        assertEq(imd.balanceOf(bob), 0, "fee x count");
        assertEq(vault.pendingOf(bob, address(imd)), 4e18, "booked to the picker");
        assertEq(imd.balanceOf(address(vault)), 4e18);
        assertEq(imd.allowance(address(pool), address(vault)), 0, "no allowance left");
        _assertBacked(pool);
    }

    function test_721_pickerChoosesAmongOfferedTokens() public {
        MiyaPool pool = _pool721(1e18, 3500e18);
        vm.prank(alice);
        pool.deposit(_ids(1, 2), _none(), alice);
        _bobWithTokens(pool, 2);
        imd.mint(bob, 1e18);
        infer.mint(bob, 3500e18);
        vm.startPrank(bob);
        imd.approve(address(pool), type(uint256).max);
        infer.approve(address(pool), type(uint256).max);
        pool.redeem(_ids(1), _none(), bob, address(infer));
        pool.redeem(_ids(2), _none(), bob, address(imd));
        vm.stopPrank();
        assertEq(vault.pendingOf(bob, address(infer)), 3500e18);
        assertEq(vault.pendingOf(bob, address(imd)), 1e18);
        _assertBacked(pool);
    }

    function test_721_pickRefusesATokenNotOffered() public {
        MiyaPool pool = _pool721(0, 3500e18); // INFER only
        vm.prank(alice);
        pool.deposit(_ids(1), _none(), alice);
        imd.mint(alice, 10e18);
        vm.startPrank(alice);
        imd.approve(address(pool), 10e18);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.FeeTokenNotOffered.selector, address(imd)));
        pool.redeem(_ids(1), _none(), alice, address(imd));
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.FeeTokenNotOffered.selector, address(0)));
        pool.redeem(_ids(1), _none(), alice, address(0));
        address other = address(new MockToken("OTHER"));
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.FeeTokenNotOffered.selector, other));
        pool.redeem(_ids(1), _none(), alice, other);
        vm.stopPrank();
        assertEq(nft.ownerOf(1), address(pool));
    }

    function test_721_pickWithoutFeeApprovalOrBalanceReverts() public {
        MiyaPool pool = _pool721(1e18, 0);
        vm.prank(alice);
        pool.deposit(_ids(1), _none(), alice);
        vm.prank(alice);
        vm.expectRevert(); // no IMD
        pool.redeem(_ids(1), _none(), alice, address(imd));
        imd.mint(alice, 1e18);
        vm.prank(alice);
        vm.expectRevert(); // no approval
        pool.redeem(_ids(1), _none(), alice, address(imd));
        assertEq(nft.ownerOf(1), address(pool));
        _assertBacked(pool);
    }

    /// The pool never keeps fee tokens: a vault that pulls less than the fee makes the pick revert.
    function test_721_vaultPullingLessReverts() public {
        MiyaPool pool = _pool721(1e18, 0);
        vm.prank(alice);
        pool.deposit(_ids(1), _none(), alice);
        imd.mint(alice, 1e18);
        vault.setPullLess(true);
        vm.startPrank(alice);
        imd.approve(address(pool), 1e18);
        vm.expectRevert(MiyaPool.FeeNotForwarded.selector);
        pool.redeem(_ids(1), _none(), alice, address(imd));
        vm.stopPrank();
    }

    /// The vault refusing (here: the token delisted, or a minimum raised past the pool's fee) blocks picks in that
    /// token only; random redeems never touch the vault.
    function test_721_vaultRefusalBlocksPicksNotRandom() public {
        MiyaPool pool = _pool721(1e18, 0);
        vm.prank(alice);
        pool.deposit(_ids(1, 2), _none(), alice);
        imd.mint(alice, 1e18);
        vault.setMin(address(imd), 5e18);
        vm.startPrank(alice);
        imd.approve(address(pool), 1e18);
        vm.expectRevert(bytes("ContributionBelowMinimum"));
        pool.redeem(_ids(1), _none(), alice, address(imd));
        uint256 c = pool.commitRedeem(1, bob);
        vm.stopPrank();
        _mined(pool, c, keccak256("r"));
        pool.revealRedeem(c);
        assertEq(nft.balanceOf(bob), 1);
        _assertBacked(pool);
    }

    function test_721_feeOnTransferTokenRefused() public {
        // A vault that listed a taxed token: the pool sees less than the fee arrive and reverts.
        TaxToken tax = new TaxToken();
        MockVault v2 = new MockVault(address(tax), address(infer));
        v2.setMin(address(tax), 1e18);
        MiyaPoolFactory f2 = new MiyaPoolFactory(address(v2));
        MiyaPool pool = MiyaPool(f2.createPool(address(nft), 1e18, 0));
        vm.startPrank(alice);
        nft.setApprovalForAll(address(pool), true);
        pool.deposit(_ids(1), _none(), alice);
        vm.stopPrank();
        tax.mint(alice, 2e18);
        vm.startPrank(alice);
        tax.approve(address(pool), 2e18);
        vm.expectRevert(MiyaPool.FeeNotReceived.selector);
        pool.redeem(_ids(1), _none(), alice, address(tax));
        vm.stopPrank();
    }

    function test_721_pickShortOfPoolTokensReverts() public {
        MiyaPool pool = _pool721(1e18, 0);
        vm.prank(alice);
        pool.deposit(_ids(1, 2), _none(), alice);
        imd.mint(bob, 2e18);
        _bobWithTokens(pool, 1);
        vm.startPrank(bob);
        imd.approve(address(pool), 2e18);
        vm.expectRevert(); // InsufficientBalance: 2 pieces need 2e18 pool tokens
        pool.redeem(_ids(1, 2), _none(), bob, address(imd));
        vm.stopPrank();
    }

    function test_721_redeemNotHeldReverts() public {
        MiyaPool pool = _pool721();
        vm.prank(alice);
        pool.deposit(_ids(1, 2), _none(), alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.NotHeld.selector, 9));
        pool.redeem(_ids(9), _none(), alice, address(0));
    }

    function test_721_redeemDuplicateReverts() public {
        MiyaPool pool = _pool721();
        vm.prank(alice);
        pool.deposit(_ids(1, 2), _none(), alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.NotHeld.selector, 1));
        pool.redeem(_ids(1, 1), _none(), alice, address(0));
    }

    function test_721_redeemWithoutTokensReverts() public {
        MiyaPool pool = _pool721();
        vm.prank(alice);
        pool.deposit(_ids(1), _none(), alice);
        vm.prank(bob);
        vm.expectRevert();
        pool.redeem(_ids(1), _none(), bob, address(0));
    }

    function test_721_targetedRedeemKeepsQueueConsistent() public {
        MiyaPool pool = _pool721();
        vm.startPrank(alice);
        pool.deposit(_range(1, 6), _none(), alice);
        pool.redeem(_ids(2), _none(), alice, address(0)); // id 6 moves into 2's place
        vm.stopPrank();
        assertEq(pool.queuePositionOf(6), 1);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.NotHeld.selector, 2));
        pool.queuePositionOf(2);
        _assertBacked(pool);
    }

    // ── ERC1155 ──────────────────────────────────────────────────────────────

    function test_1155_depositAndPartialRedeem() public {
        MiyaPool pool = _pool1155();
        vm.prank(alice);
        pool.deposit(_ids(1, 2), _ids(4, 3), alice);
        assertEq(pool.balanceOf(alice), 7 * UNIT);
        assertEq(pool.heldUnits(), 7);
        assertEq(pool.unitsOf(1), 4);

        vm.prank(alice);
        pool.redeem(_ids(1, 2), _ids(1, 3), bob, address(0));
        assertEq(editions.balanceOf(bob, 1), 1);
        assertEq(editions.balanceOf(bob, 2), 3);
        assertEq(pool.heldUnits(), 3);
        assertEq(pool.unitsOf(2), 0);
        assertEq(pool.heldIdsCount(), 1);
        _assertBacked(pool);
    }

    function test_1155_pickFeePerUnit() public {
        MiyaPool pool = _pool1155(0, 4000e18);
        vm.prank(alice);
        pool.deposit(_ids(1, 2), _ids(5, 3), alice);
        infer.mint(alice, 12_000e18);
        vm.startPrank(alice);
        infer.approve(address(pool), 12_000e18);
        pool.redeem(_ids(1, 2), _ids(2, 1), bob, address(infer));
        vm.stopPrank();
        assertEq(vault.pendingOf(alice, address(infer)), 12_000e18, "3 units x 4,000 INFER");
        assertEq(pool.balanceOf(alice), 5e18);
        assertEq(editions.balanceOf(bob, 1), 2);
        _assertBacked(pool);
    }

    function test_1155_directTransferDeposits() public {
        MiyaPool pool = _pool1155();
        vm.prank(alice);
        editions.safeTransferFrom(alice, address(pool), 1, 2, "");
        assertEq(pool.balanceOf(alice), 2 * UNIT);
        _assertBacked(pool);
    }

    function test_1155_overRedeemReverts() public {
        MiyaPool pool = _pool1155();
        vm.prank(alice);
        pool.deposit(_ids(1), _ids(2), alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.NotHeld.selector, 1));
        pool.redeem(_ids(1), _ids(3), alice, address(0));
    }

    function test_1155_lengthMismatchReverts() public {
        MiyaPool pool = _pool1155();
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

    function test_random_commitRevealIsFree() public {
        MiyaPool pool = _pool721(5e18, 5000e18);
        vm.prank(alice);
        pool.deposit(_ids(1, 2, 3), _none(), alice);

        vm.prank(alice);
        uint256 id = pool.commitRedeem(2, bob);
        assertEq(pool.balanceOf(alice), UNIT, "exactly 1e18 per piece");
        assertEq(vault.pendingOf(alice, address(imd)) + vault.pendingOf(alice, address(infer)), 0, "no fee");
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
        MiyaPool pool = _pool721();
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
        pool.redeem(_ids(3), _none(), alice, address(0));
        vm.roll(block.number + 1);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.LockedForRandomRedeem.selector, 1));
        pool.redeem(_ids(1), _none(), alice, address(0));
        // a mixed request fails whole
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.LockedForRandomRedeem.selector, 2));
        pool.redeem(_ids(5, 2), _none(), alice, address(0));

        // a later deposit is free
        pool.redeem(_ids(6), _none(), alice, address(0));
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
        pool.redeem(_ids(other), _none(), alice, address(0));
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
        MiyaPool pool = _pool721();
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
                pool.redeem(_ids(id), _none(), alice, address(0));
            } else if (takeMask & (1 << (id % 8)) != 0) {
                pool.redeem(_ids(id), _none(), alice, address(0));
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
        pool.redeem(_ids(pick), _none(), alice, address(0));
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
            pool.redeem(_ids(id), _none(), alice, address(0));
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
        MiyaPool pool = MiyaPool(factory.createPool(address(n), 0, 0));
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
        MiyaPool pool = MiyaPool(factory.createPool(address(n), 0, 0));
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
        MiyaPool pool = MiyaPool(factory.createPool(address(blocking), 0, 0));
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
        pool.redeem(_ids(escrowed), _none(), alice, address(0));

        vm.prank(alice);
        vm.expectRevert(MiyaPool.NotEscrowed.selector);
        pool.claimEscrowed(escrowed, alice);

        address elsewhere = makeAddr("elsewhere");
        vm.prank(stuck);
        pool.claimEscrowed(escrowed, elsewhere);
        assertEq(blocking.ownerOf(escrowed), elsewhere);
        assertEq(pool.escrowedTo(escrowed), address(0));
    }

    /// Mixed: a pick with a fee between a commit and its reveal (of a free id) leaves the pick where it was.
    function test_mixed_feePickBetweenCommitAndReveal() public {
        MiyaPool pool = _pool721(1e18, 0);
        imd.mint(alice, 10e18);
        vm.startPrank(alice);
        imd.approve(address(pool), 10e18);
        pool.deposit(_range(1, 4), _none(), alice);
        uint256 c = pool.commitRedeem(1, bob);
        pool.deposit(_ids(5, 6), _none(), alice);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.LockedForRandomRedeem.selector, 2));
        pool.redeem(_ids(2), _none(), alice, address(imd));
        pool.redeem(_ids(6), _none(), alice, address(imd));
        vm.stopPrank();
        assertEq(imd.balanceOf(alice), 9e18, "only the successful pick paid");
        _mined(pool, c, keccak256("m"));
        pool.revealRedeem(c);
        assertEq(nft.balanceOf(bob), 1);
        _assertBacked(pool);
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
