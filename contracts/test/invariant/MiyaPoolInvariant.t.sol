// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { MiyaPool } from "../../src/pools/MiyaPool.sol";
import { MiyaPoolFactory } from "../../src/pools/MiyaPoolFactory.sol";
import { Mock721, Mock1155, MockVault } from "../pools/MiyaPool.t.sol";

/// @dev Interleaves deposits, targeted redeems (with premium), random commits and reveals, lot sales and transfers on
///      three pools: an ERC721 pool with both paths, an ERC1155 pool and an ERC721 pool made on Robinhood Chain
///      (targeted only). Breaches of the random/targeted rules are counted as `violations`, not reverted, so the
///      invariant reports them.
contract MiyaPoolHandler is Test {
    uint256 constant UNIT = 1e18;

    Mock721 public nft;
    Mock721 public nftHood;
    Mock1155 public editions;
    MockVault public vault;
    MiyaPool public both;
    MiyaPool public pool1155;
    MiyaPool public hood;

    address[] public actors;
    uint256 public nextId = 1;
    uint256 public nextHoodId = 1;

    // ghost state
    uint256 public depositSeq;
    mapping(uint256 id => uint256 seq) public depositSeqOf;
    mapping(uint256 commitId => uint256 seq) public seqAtCommit;
    uint256 public violations;
    uint256 public lockedRejections;
    uint256 public reveals;
    uint256 public targetedRedeems;
    uint256 public lotEth;
    mapping(address pool => uint256) public lotsSold;

    constructor(MockVault vault_, MiyaPoolFactory factory) {
        vault = vault_;
        nft = new Mock721();
        nftHood = new Mock721();
        editions = new Mock1155();
        both = MiyaPool(factory.createPool(address(nft), 2000));
        pool1155 = MiyaPool(factory.createPool(address(editions), 1000));
        uint256 chain = block.chainid;
        vm.chainId(4663);
        hood = MiyaPool(factory.createPool(address(nftHood), 500));
        vm.chainId(chain);
        for (uint256 i; i < 3; ++i) {
            address a = makeAddr(string(abi.encodePacked("actor", i)));
            actors.push(a);
            vm.deal(a, 1_000_000 ether);
            vm.startPrank(a);
            nft.setApprovalForAll(address(both), true);
            nftHood.setApprovalForAll(address(hood), true);
            editions.setApprovalForAll(address(pool1155), true);
            vm.stopPrank();
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _one(uint256 v) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = v;
    }

    function pools() external view returns (MiyaPool[3] memory) {
        return [both, pool1155, hood];
    }

    // ── deposits ─────────────────────────────────────────────────────────────

    function deposit721(uint256 actorSeed, uint256 count) external {
        address a = _actor(actorSeed);
        count = bound(count, 1, 4);
        uint256[] memory ids = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            uint256 id = nextId++;
            nft.mint(a, id);
            ids[i] = id;
            depositSeqOf[id] = ++depositSeq;
        }
        vm.prank(a);
        both.deposit(ids, new uint256[](0), a);
    }

    function depositHood(uint256 actorSeed) external {
        address a = _actor(actorSeed);
        uint256 id = nextHoodId++;
        nftHood.mint(a, id);
        vm.prank(a);
        hood.deposit(_one(id), new uint256[](0), a);
    }

    function deposit1155(uint256 actorSeed, uint256 id, uint256 amount) external {
        address a = _actor(actorSeed);
        id = bound(id, 1, 5);
        amount = bound(amount, 1, 10);
        editions.mint(a, id, amount);
        vm.prank(a);
        pool1155.deposit(_one(id), _one(amount), a);
    }

    // ── targeted ─────────────────────────────────────────────────────────────

    function redeemTargeted(uint256 actorSeed, uint256 pick) external {
        uint256 n = both.heldIdsCount();
        address a = _actor(actorSeed);
        if (n == 0) return;
        uint256 id = both.heldIds(pick % n, 1)[0];
        if (both.balanceOf(a) < both.targetedCost(1)) return;
        bool locked = both.isLocked(id);
        vm.prank(a);
        try both.redeem(_one(id), new uint256[](0), a) {
            if (locked) ++violations; // took an id a pending commit could draw
            ++targetedRedeems;
        } catch (bytes memory err) {
            if (!locked || bytes4(err) != MiyaPool.LockedForRandomRedeem.selector) ++violations;
            ++lockedRejections;
        }
    }

    function redeemHood(uint256 actorSeed, uint256 pick) external {
        uint256 n = hood.heldIdsCount();
        address a = _actor(actorSeed);
        if (n == 0 || hood.balanceOf(a) < hood.targetedCost(1)) return;
        uint256 id = hood.heldIds(pick % n, 1)[0];
        vm.prank(a);
        hood.redeem(_one(id), new uint256[](0), a);
    }

    function redeem1155(uint256 actorSeed, uint256 pick, uint256 amount) external {
        uint256 n = pool1155.heldIdsCount();
        address a = _actor(actorSeed);
        if (n == 0) return;
        uint256 id = pool1155.heldIds(pick % n, 1)[0];
        uint256 max = pool1155.unitsOf(id);
        uint256 affordable = pool1155.balanceOf(a) / pool1155.targetedCost(1);
        if (affordable < max) max = affordable;
        if (max == 0) return;
        amount = bound(amount, 1, max);
        vm.prank(a);
        pool1155.redeem(_one(id), _one(amount), a);
    }

    // ── random ───────────────────────────────────────────────────────────────

    function commitRandom(uint256 actorSeed, uint256 amount) external {
        address a = _actor(actorSeed);
        uint256 free = both.heldUnits() - both.pendingUnits();
        uint256 affordable = both.balanceOf(a) / UNIT;
        if (free < affordable) affordable = free;
        if (affordable > both.MAX_COMMIT_UNITS()) affordable = both.MAX_COMMIT_UNITS();
        if (affordable == 0) return;
        amount = bound(amount, 1, affordable);
        vm.prank(a);
        uint256 c = both.commitRedeem(amount, a);
        seqAtCommit[c] = depositSeq;
    }

    function revealRandom(uint256 pick, uint256 blocks) external {
        uint256 id = both.nextRevealId();
        if (id == both.nextCommitId()) return;
        (, uint64 target,,) = both.commits(id);
        vm.roll(block.number + bound(blocks, 0, 300));
        if (block.number <= target) vm.roll(target + 1);
        if (block.number - target <= 256) vm.setBlockhash(target, keccak256(abi.encode(pick, target)));
        vm.recordLogs();
        both.revealRedeem(id);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(both) || logs[i].topics[0] != MiyaPool.RedeemRevealed.selector) continue;
            ++reveals;
            uint256[] memory ids = abi.decode(logs[i].data, (uint256[]));
            for (uint256 k; k < ids.length; ++k) {
                // drew only ids deposited before the commit
                if (depositSeqOf[ids[k]] > seqAtCommit[id]) ++violations;
            }
        }
    }

    // ── lots ─────────────────────────────────────────────────────────────────

    function buyLot(uint256 actorSeed, uint256 which, uint256 wait) external {
        MiyaPool p = which % 3 == 0 ? both : which % 3 == 1 ? pool1155 : hood;
        if (!p.lotAvailable()) return;
        vm.warp(block.timestamp + bound(wait, 0, 20 days));
        address a = _actor(actorSeed);
        uint256 price = p.lotPrice();
        vm.prank(a);
        p.buyLot{ value: price + 1 ether }(a, a);
        lotEth += price;
        ++lotsSold[address(p)];
    }

    function transferTokens(uint256 fromSeed, uint256 toSeed, uint256 which, uint256 amount) external {
        MiyaPool p = which % 3 == 0 ? both : which % 3 == 1 ? pool1155 : hood;
        address from = _actor(fromSeed);
        amount = bound(amount, 0, p.balanceOf(from));
        vm.prank(from);
        p.transfer(_actor(toSeed), amount);
    }
}

/// forge-config: default.invariant.fail-on-revert = true
/// forge-config: ci.invariant.runs = 1000
/// forge-config: ci.invariant.fail-on-revert = true
contract MiyaPoolInvariantTest is Test {
    uint256 constant UNIT = 1e18;
    MiyaPoolHandler handler;
    MockVault vault;

    function setUp() public {
        vault = new MockVault();
        handler = new MiyaPoolHandler(vault, new MiyaPoolFactory(address(vault)));
        targetContract(address(handler));
    }

    function _check(MiyaPool p) internal view {
        assertEq(
            p.totalSupply() + p.premiumReserve() + UNIT * p.pendingUnits(),
            UNIT * p.heldUnits(),
            "supply + reserve + pending != backing"
        );
        assertLe(p.pendingUnits(), p.heldUnits(), "pending exceeds held");
        assertEq(address(p).balance, 0, "pool holds ETH");
        assertGe(p.lotStartPrice(), p.MIN_LOT_PRICE(), "lot start price below the floor");
    }

    function invariant_tokensExactlyBacked() public view {
        MiyaPool[3] memory ps = handler.pools();
        for (uint256 i; i < 3; ++i) {
            _check(ps[i]);
        }
    }

    function invariant_trackedEqualsCustody() public view {
        assertEq(handler.nft().balanceOf(address(handler.both())), handler.both().heldUnits());
        assertEq(handler.nftHood().balanceOf(address(handler.hood())), handler.hood().heldUnits());
    }

    /// The random pool's queue holds exactly the held ids, each once, at a position in [head, tail).
    function invariant_queueIsABijection() public view {
        MiyaPool p = handler.both();
        (uint256 head, uint256 tail) = p.queueBounds();
        uint256 n = p.heldIdsCount();
        assertEq(tail - head, n, "queue length");
        uint256[] memory ids = p.heldIds(0, n);
        bool[] memory seen = new bool[](n);
        for (uint256 i; i < n; ++i) {
            uint256 pos = p.queuePositionOf(ids[i]);
            assertTrue(pos >= head && pos < tail, "position out of range");
            assertFalse(seen[pos - head], "two ids at one position");
            seen[pos - head] = true;
        }
        assertTrue(p.lockedEnd() <= tail, "lock past the tail");
    }

    function invariant_randomAndTargetedRulesHold() public view {
        assertEq(handler.violations(), 0, "a targeted redeem took a drawable id, or a draw took a later deposit");
    }

    function invariant_vaultGotEveryLotsEth() public view {
        assertEq(vault.totalEth(), handler.lotEth(), "vault ETH != lot sales");
    }

    function invariant_noRandomOnRobinhoodPool() public view {
        assertFalse(handler.hood().randomEnabled());
        (uint256 head, uint256 tail) = handler.hood().queueBounds();
        assertEq(head + tail, 0);
    }

    /// Coverage of the run: how often the interesting paths ran (printed with -vv).
    function afterInvariant() external {
        emit log_named_uint("reveals", handler.reveals());
        emit log_named_uint("targeted redeems (random pool)", handler.targetedRedeems());
        emit log_named_uint("targeted redeems refused as locked", handler.lockedRejections());
        emit log_named_uint("lots sold (721 both)", handler.lotsSold(address(handler.both())));
        emit log_named_uint("lots sold (1155)", handler.lotsSold(address(handler.pool1155())));
        emit log_named_uint("lots sold (4663)", handler.lotsSold(address(handler.hood())));
    }
}
