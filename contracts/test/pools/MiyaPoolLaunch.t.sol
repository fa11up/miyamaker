// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { MiyaPool } from "../../src/pools/MiyaPool.sol";
import { MiyaPoolFactory } from "../../src/pools/MiyaPoolFactory.sol";
import { Mock721, Mock1155, MockToken, MockVault } from "./MiyaPool.t.sol";

/// @dev An ERC-721 whose ownerOf claims the pool owns everything, and which calls the pool's hook itself.
contract Liar721 is Mock721 {
    address public pool;

    function setPool(address p) external {
        pool = p;
    }

    function ownerOf(uint256 id) public view override returns (address) {
        return pool != address(0) ? pool : super.ownerOf(id);
    }

    function fakeDeposit(uint256 id, address to) external {
        MiyaPool(pool).onERC721Received(address(this), to, id, abi.encode(to));
    }
}

/// @dev An ERC-1155 that calls the pool's hook without moving anything.
contract Liar1155 is Mock1155 {
    function fakeDeposit(address pool, uint256 id, uint256 amount, address to) external {
        MiyaPool(pool).onERC1155Received(address(this), to, id, amount, abi.encode(to));
    }
}

/// @dev A vault that reenters the pool from receiveContribution.
contract ReenteringVault is MockVault {
    uint8 public mode; // 1 deposit, 2 redeem, 3 commit
    uint256[] ids;

    constructor(address imd_, address infer_) MockVault(imd_, infer_) { }

    function arm(uint8 m, uint256 id) external {
        mode = m;
        delete ids;
        ids.push(id);
    }

    function receiveContribution(address currency, uint256 amount, address benefactor) external payable override {
        MiyaPool pool = MiyaPool(msg.sender);
        if (mode == 1) pool.deposit(ids, new uint256[](0), benefactor);
        if (mode == 2) pool.redeem(ids, new uint256[](0), benefactor, currency);
        if (mode == 3) pool.commitRedeem(1, benefactor);
        MockToken(currency).transferFrom(msg.sender, address(this), amount);
        pendingOf[benefactor][currency] += amount;
        totalOf[currency] += amount;
    }
}

/// @dev A vault whose imd() answers with something that is not an address.
contract GarbageVault {
    function imd() external pure returns (uint256) {
        return type(uint256).max;
    }

    function infer() external pure returns (bytes memory) {
        return "no";
    }
}

/// @notice Launch rehearsal of the factory as the IMD floor deploys it, and reproductions of the imported audit's
///         findings against the code as it arrived (the `test_known_*` tests document accepted behaviour, see
///         ADAPTATION.md).
contract MiyaPoolLaunchTest is Test {
    uint256 constant UNIT = 1e18;
    /// The live miyamints default alignment vault, the launch's one constructor argument.
    address constant LIVE_VAULT = 0x34bE8C25C7922B3052D1955b8E63fB97F778AA08;

    MockToken imd;
    MockToken infer;
    MockVault vault;
    MiyaPoolFactory factory;
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
        for (uint256 id = 1; id <= 60; ++id) {
            nft.mint(alice, id);
        }
        editions.mint(alice, 1, 5);
    }

    // ── launch floor ─────────────────────────────────────────────────────────

    /// The protected harness CREATE2-deploys the init code on an empty chain (chain id set, no fork) and requires
    /// runtime code. With the live vault address as the argument there is no code at that address.
    function test_launch_factoryDeploysOnAnEmptyChainWithTheLiveVaultArgument() public {
        vm.chainId(1);
        assertEq(LIVE_VAULT.code.length, 0, "rehearsal chain has no vault");
        bytes memory code = abi.encodePacked(type(MiyaPoolFactory).creationCode, abi.encode(LIVE_VAULT));
        assertLe(code.length, 49_152, "init code limit");
        bytes32 salt = keccak256("imd launch salt");
        address created;
        assembly ("memory-safe") {
            created := create2(0, add(code, 32), mload(code), salt)
        }
        assertTrue(created != address(0), "constructor reverted");
        assertGt(created.code.length, 0, "no runtime");
        assertLe(created.code.length, 24_576, "runtime exceeds EIP-170");
        _assertNoEscapeOpcodes(created.code);

        MiyaPoolFactory f = MiyaPoolFactory(created);
        assertEq(f.vault(), LIVE_VAULT);
        assertEq(f.imd(), address(0), "no vault code: no tokens yet");
        assertEq(f.infer(), address(0));
        // a pool with a fee needs the vault; a free pool does not
        vm.expectRevert(MiyaPool.NoVault.selector);
        f.createPool(address(nft), 1e18, 0);
        MiyaPool p = MiyaPool(f.createPool(address(nft), 0, 0));
        assertEq(p.vault(), LIVE_VAULT);
        assertTrue(p.picksFree());
        assertTrue(p.randomEnabled());
        // pools deploy where predictPool says, whatever the vault state
        assertEq(address(p), f.predictPool(address(nft), MiyaPool.Kind.ERC721, 0, 0));
    }

    /// A pool's runtime also has no escape opcodes (the floor checks only the factory; pools are its children).
    function test_launch_poolRuntimeHasNoEscapeOpcodes() public {
        MiyaPool p = MiyaPool(factory.createPool(address(nft), 1e18, 3500e18));
        _assertNoEscapeOpcodes(address(p).code);
        assertLe(address(p).code.length, 24_576);
    }

    /// On mainnet the lazy reads give the same result the eager constructor reads gave.
    function test_launch_factoryReadsTheVaultTokensFromTheVault() public {
        assertEq(factory.imd(), address(imd));
        assertEq(factory.infer(), address(infer));
        MiyaPool p = MiyaPool(factory.createPool(address(nft), 1e18, 3500e18));
        assertEq(p.imd(), address(imd));
        assertEq(p.infer(), address(infer));
        assertEq(p.vault(), address(vault));
        assertEq(p.pickFee(address(imd), 2), 2e18);
        assertEq(p.pickFee(address(infer), 2), 7000e18);
    }

    /// A vault that does not answer imd()/infer() with an address yields address(0): no fee pool can be created on it.
    function test_launch_vaultWithoutAddressAnswersGivesNoFeeTokens() public {
        MiyaPoolFactory f = new MiyaPoolFactory(address(new GarbageVault()));
        assertEq(f.imd(), address(0));
        assertEq(f.infer(), address(0));
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.FeeTokenNotAccepted.selector, address(0)));
        f.createPool(address(nft), 1e18, 0);
        MiyaPool p = MiyaPool(f.createPool(address(nft), 0, 0));
        assertTrue(p.picksFree());
    }

    // ── audit reproductions ──────────────────────────────────────────────────

    /// Finding 4e9dcd9a (reproduced, accepted): a squatted ERC-1155 pool with an unpayable fee has no exit.
    function test_known_squattedErc1155PoolWithUnpayableFeeHasNoExit() public {
        address squatter = makeAddr("squatter");
        vm.prank(squatter);
        MiyaPool pool = MiyaPool(factory.createPool(address(editions), 0, type(uint256).max));
        assertEq(uint8(pool.kind()), uint8(MiyaPool.Kind.ERC1155));
        assertFalse(pool.randomEnabled());
        vm.startPrank(alice);
        editions.setApprovalForAll(address(pool), true);
        pool.deposit(_one(1), _one(2), alice);
        assertEq(pool.balanceOf(alice), 2 * UNIT);
        vm.expectRevert(MiyaPool.RandomUnavailable.selector);
        pool.commitRedeem(1, alice);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.FeeTokenNotOffered.selector, address(0)));
        pool.redeem(_one(1), _one(1), alice, address(0));
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.FeeTokenNotOffered.selector, address(imd)));
        pool.redeem(_one(1), _one(1), alice, address(imd));
        vm.expectRevert(); // overflow in fee x units
        pool.redeem(_one(1), _one(2), alice, address(infer));
        vm.stopPrank();
        assertEq(pool.pickFee(address(infer), 1), type(uint256).max, "one unit needs more INFER than can exist");
        vm.expectRevert(abi.encodeWithSelector(MiyaPoolFactory.PoolExists.selector, address(pool)));
        factory.createPool(address(editions), 0, 3500e18);
    }

    /// Finding 4e9dcd9a (reproduced, accepted): the same on Robinhood Chain for an ERC-721 pool.
    function test_known_squattedRobinhoodPoolHasNoExit() public {
        vm.chainId(4663);
        MiyaPool pool = MiyaPool(factory.createPool(address(nft), type(uint256).max, 0));
        assertFalse(pool.randomEnabled());
        vm.startPrank(alice);
        nft.setApprovalForAll(address(pool), true);
        pool.deposit(_one(1), new uint256[](0), alice);
        vm.expectRevert(MiyaPool.RandomUnavailable.selector);
        pool.commitRedeem(1, alice);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.FeeTokenNotOffered.selector, address(0)));
        pool.redeem(_one(1), new uint256[](0), alice, address(0));
        vm.stopPrank();
        assertEq(nft.ownerOf(1), address(pool));
    }

    /// Finding c2cfa51a (reproduced, accepted): one 50-unit commit locks every earlier id until someone pays the
    /// reveal; the committer pays only the commit.
    function test_known_largeCommitShiftsTheUnlockCostToTheRevealer() public {
        MiyaPool pool = MiyaPool(factory.createPool(address(nft), 1e18, 0));
        vm.startPrank(alice);
        nft.setApprovalForAll(address(pool), true);
        pool.deposit(_range(1, 60), new uint256[](0), alice);
        pool.transfer(bob, 50 * UNIT);
        vm.stopPrank();
        address victim = makeAddr("victim");
        vm.prank(alice);
        pool.transfer(victim, UNIT);
        imd.mint(victim, 1e18);
        vm.prank(victim);
        imd.approve(address(pool), 1e18);

        vm.prank(bob);
        uint256 g = gasleft();
        uint256 c = pool.commitRedeem(50, bob);
        uint256 commitGas = g - gasleft();
        assertEq(pool.lockedEnd(), 60, "every held id is locked");

        vm.prank(victim);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.LockedForRandomRedeem.selector, 5));
        pool.redeem(_one(5), new uint256[](0), victim, address(imd));
        (, uint64 target,,) = pool.commits(c);
        vm.roll(target + 1);
        vm.setBlockhash(target, keccak256("seed"));
        // still locked after the target block: only a reveal clears it, and bob never sends one
        vm.prank(victim);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.LockedForRandomRedeem.selector, 5));
        pool.redeem(_one(5), new uint256[](0), victim, address(imd));

        vm.prank(victim);
        g = gasleft();
        pool.revealRedeem(c);
        uint256 revealGas = g - gasleft();
        emit log_named_uint("attacker's commit gas", commitGas);
        emit log_named_uint("victim's reveal gas", revealGas);
        assertGt(revealGas, 10 * commitGas, "the victim pays far more than the attacker");
        assertEq(pool.lockedEnd(), 0);
        assertEq(pool.balanceOf(bob), 0);
        assertEq(nft.balanceOf(bob), 50, "the attacker's tokens came back as NFTs");
        // only now can the victim pick one of the ten ids left
        uint256[] memory left = pool.heldIds(0, 10);
        vm.prank(victim);
        pool.redeem(_one(left[0]), new uint256[](0), victim, address(imd));
        assertEq(nft.ownerOf(left[0]), victim);
    }

    /// Finding 8e6d454a (reproduced, accepted): a collection that lies about custody mints unbacked tokens, in its own
    /// pool only.
    function test_known_lyingCollectionMintsUnbackedTokensInItsOwnPoolOnly() public {
        Liar721 liar = new Liar721();
        Liar1155 liar1155 = new Liar1155();
        MiyaPool liarPool = MiyaPool(factory.createPool(address(liar), 0, 0));
        MiyaPool liarPool1155 = MiyaPool(factory.createPool(address(liar1155), 0, 0));
        MiyaPool honest = MiyaPool(factory.createPool(address(nft), 1e18, 0));
        vm.startPrank(alice);
        nft.setApprovalForAll(address(honest), true);
        honest.deposit(_range(1, 3), new uint256[](0), alice);
        vm.stopPrank();

        liar.setPool(address(liarPool));
        liar.fakeDeposit(1, bob);
        liar.fakeDeposit(2, bob);
        assertEq(liarPool.totalSupply(), 2 * UNIT);
        assertEq(liarPool.heldUnits(), 2);
        assertEq(liar.balanceOf(address(liarPool)), 0, "nothing was transferred");
        liar1155.fakeDeposit(address(liarPool1155), 7, 1000, bob);
        assertEq(liarPool1155.totalSupply(), 1000 * UNIT);

        // the honest pool, the factory and the vault are untouched; the liar cannot call another pool's hook
        assertEq(honest.totalSupply(), 3 * UNIT);
        assertEq(honest.heldUnits(), 3);
        vm.prank(address(liar));
        vm.expectRevert(MiyaPool.NotCollection.selector);
        honest.onERC721Received(address(liar), bob, 9, abi.encode(bob));
        assertEq(imd.balanceOf(address(vault)), 0);
    }

    /// Finding fcbb161b (reproduced, accepted): the EnumerableSetLib sentinel id cannot be deposited; nothing is lost.
    function test_known_sentinelIdCannotBeDeposited() public {
        uint256 sentinel = 0xfbb67fda52d4bfb8bf;
        nft.mint(alice, sentinel);
        MiyaPool pool = MiyaPool(factory.createPool(address(nft), 0, 0));
        vm.startPrank(alice);
        nft.setApprovalForAll(address(pool), true);
        vm.expectRevert();
        pool.deposit(_one(sentinel), new uint256[](0), alice);
        vm.expectRevert();
        nft.safeTransferFrom(alice, address(pool), sentinel);
        vm.stopPrank();
        assertEq(nft.ownerOf(sentinel), alice);
        assertEq(pool.totalSupply(), 0);
    }

    // ── own checks (question 3: fee path) ────────────────────────────────────

    /// A vault reentering the pool from receiveContribution cannot reach any state-changing entry.
    function test_feeVaultCannotReenterThePool() public {
        ReenteringVault rv = new ReenteringVault(address(imd), address(infer));
        MiyaPoolFactory f = new MiyaPoolFactory(address(rv));
        MiyaPool pool = MiyaPool(f.createPool(address(nft), 1e18, 0));
        vm.startPrank(alice);
        nft.setApprovalForAll(address(pool), true);
        pool.deposit(_range(1, 4), new uint256[](0), alice);
        imd.mint(alice, 10e18);
        imd.approve(address(pool), type(uint256).max);
        for (uint8 m = 1; m <= 3; ++m) {
            rv.arm(m, m == 1 ? 10 : 2);
            vm.expectRevert(); // ReentrancyGuard.Reentrancy
            pool.redeem(_one(1), new uint256[](0), alice, address(imd));
        }
        rv.arm(0, 0);
        pool.redeem(_one(1), new uint256[](0), alice, address(imd));
        vm.stopPrank();
        assertEq(nft.ownerOf(1), alice);
        assertEq(rv.pendingOf(alice, address(imd)), 1e18);
        assertEq(imd.balanceOf(address(pool)), 0);
        assertEq(pool.totalSupply() + UNIT * pool.pendingUnits(), UNIT * pool.heldUnits());
    }

    /// Fee tokens donated to the pool stay there, are never counted as a fee, and do not break a pick.
    function test_donatedFeeTokensDoNotAffectPicks() public {
        MiyaPool pool = MiyaPool(factory.createPool(address(nft), 1e18, 0));
        imd.mint(address(pool), 5e18);
        vm.startPrank(alice);
        nft.setApprovalForAll(address(pool), true);
        pool.deposit(_range(1, 2), new uint256[](0), alice);
        imd.mint(alice, 1e18);
        imd.approve(address(pool), 1e18);
        pool.redeem(_one(1), new uint256[](0), alice, address(imd));
        vm.stopPrank();
        assertEq(imd.balanceOf(address(pool)), 5e18, "donation untouched");
        assertEq(vault.pendingOf(alice, address(imd)), 1e18, "the picker paid the full fee");
        assertEq(imd.balanceOf(alice), 0);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _one(uint256 v) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = v;
    }

    function _range(uint256 from, uint256 to) internal pure returns (uint256[] memory r) {
        r = new uint256[](to - from + 1);
        for (uint256 i; i < r.length; ++i) {
            r[i] = from + i;
        }
    }

    /// Same scan as the protected floor: reachable DELEGATECALL, CALLCODE or SELFDESTRUCT fail.
    function _assertNoEscapeOpcodes(bytes memory code) internal pure {
        bool reachable = true;
        for (uint256 j; j < code.length; ++j) {
            uint8 op = uint8(code[j]);
            if (op == 0x5b) reachable = true;
            if (op >= 0x60 && op <= 0x7f) {
                j += op - 0x5f;
                continue;
            }
            if (reachable) assertTrue(op != 0xf4 && op != 0xf2 && op != 0xff, "forbidden opcode");
            if (op == 0x00 || op == 0x56 || op == 0xf3 || op == 0xfd || op == 0xfe || op == 0xff) reachable = false;
        }
    }
}
