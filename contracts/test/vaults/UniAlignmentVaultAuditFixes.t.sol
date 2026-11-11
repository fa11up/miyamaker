// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {UniAlignmentVault} from "../../src/vaults/uni/UniAlignmentVault.sol";
import {UniAlignmentVaultFactory} from "../../src/vaults/uni/UniAlignmentVaultFactory.sol";
import {ClaimMode} from "../../src/interfaces/IAlignmentVault.sol";
import {TestableUniAlignmentVault} from "../helpers/TestableUniAlignmentVault.sol";
import {VaultTestBase} from "./VaultTestBase.sol";
import {SeizableToken, MockToken} from "./mocks/VaultMocks.sol";

/// @dev A benefactor (or delegate) contract with no receive(): it cannot take ETH.
contract NoEthHolder {
    function claim(UniAlignmentVault v, ClaimMode mode, uint256 minEthOut) external returns (uint256, uint256, uint256) {
        return v.claimFees(mode, minEthOut);
    }

    function claimAs(UniAlignmentVault v, address[] calldata bs) external returns (uint256, uint256, uint256) {
        return v.claimFeesAsDelegate(bs, ClaimMode.TOKENS, 0);
    }

    function delegate(UniAlignmentVault v, address d) external {
        v.delegateBenefactor(d);
    }
}

/// @notice Regression tests for the swarm audit of the vault (job 4884eb75, 2026-11-09), one per finding. Each fails on
///         the audited code (b5bdcc6 = 9659cff's contracts) and passes on the fix.
contract UniAlignmentVaultAuditFixesTest is VaultTestBase {
    bytes32 constant SPLIT_SIG = keccak256("SplitSwap(bool,uint256,uint256)");
    bytes32 constant BATCH_SIG = keccak256("BatchConverted(uint256,uint256,uint256,uint256,uint256,uint256)");

    /// @dev The keeper's flow on a TestableUniAlignmentVault: simulate with loose floors, then set the split's direction,
    ///      its rate floor and the liquidity floor from the simulation, `slipBps` under it.
    function _quote(TestableUniAlignmentVault v, UniAlignmentVault.ConvertParams memory p, uint256 slipBps)
        internal
        returns (UniAlignmentVault.ConvertParams memory)
    {
        uint256 snap = vm.snapshotState();
        vm.recordLogs();
        vm.prank(keeper);
        v.convertAndAddLiquidity(p);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        vm.revertToState(snap);
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(v)) continue;
            if (logs[i].topics[0] == SPLIT_SIG) {
                (bool dir, uint256 sin, uint256 out) = abi.decode(logs[i].data, (bool, uint256, uint256));
                p.splitInferToImd = dir;
                p.minSplitRate = FixedPointMathLib.fullMulDiv(out, 1e18, sin) * (10_000 - slipBps) / 10_000;
            } else if (logs[i].topics[0] == BATCH_SIG) {
                (, uint256 liquidity,,,) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256, uint256));
                p.minLiquidity = liquidity * (10_000 - slipBps) / 10_000;
            }
        }
        return p;
    }

    // ═══ 1 (Medium): the split floor has a direction, and the batch a liquidity floor ═══════════════════════════════

    /// @dev The judge's test, adapted: the keeper quotes INFER -> IMD at 1 IMD = 3,887 INFER; the pool is pushed to
    ///      33.30% of the INFER price before the call lands, which flips the balancing swap to IMD -> INFER. The old
    ///      bare-number floor (IMD wei) was cleared by the flipped swap's INFER-wei output and the batch landed 13% under
    ///      the keeper's floor. Now the call must revert.
    function test_splitFloor_hasNoDirection() public {
        uint160 sqrtP = uint160(FixedPointMathLib.sqrt((uint256(1) << 192) / 3887));
        vault.setMockPool(sqrtP, 7.62e23);
        _contribute(alice, infer, 583_050e18); // ~150 IMD worth
        _contribute(bob, imd, 50e18);

        UniAlignmentVault.ConvertParams memory p = _quote(vault, _params(vault), 100);
        assertTrue(p.splitInferToImd, "quote direction is INFER -> IMD");
        uint256 quotedLiquidity = p.minLiquidity * 10_000 / 9_900;

        uint160 sqrtP2 = uint160(FixedPointMathLib.sqrt(((uint256(1) << 192) * 3330 / 10000) / 3887));
        vault.setMockPool(sqrtP2, 7.62e23);

        vm.prank(keeper);
        try vault.convertAndAddLiquidity(p) {
            assertGe(vault.totalLPUnits(), quotedLiquidity * 99 / 100, "landed beyond the keeper's 1% floor");
            revert("the flipped split must not land");
        } catch (bytes memory err) {
            assertEq(bytes4(err), UniAlignmentVault.SplitDirection.selector, "refused for its direction");
        }

        // Even with the direction guessed right for the moved pool, the liquidity floor holds the batch to its quote.
        p.splitInferToImd = false;
        p.minSplitRate = 1;
        vm.prank(keeper);
        vm.expectRevert(UniAlignmentVault.InsufficientLiquidity.selector);
        vault.convertAndAddLiquidity(p);

        // At the quoted price the quote lands.
        vault.setMockPool(sqrtP, 7.62e23);
        p = _quote(vault, _params(vault), 100);
        vm.prank(keeper);
        vault.convertAndAddLiquidity(p);
        assertGe(vault.totalLPUnits(), quotedLiquidity * 99 / 100);
    }

    // ═══ 2 (Low): the first batch keeps its ETH dust and its own pass-2/3 fees ═════════════════════════════════════

    function test_firstBatch_keepsEthDustAndOwnFees() public {
        _contribute(alice, imd, 1000e18);
        vm.deal(address(vault), 1 ether); // a leg refund / stray on the first batch
        vault.accrueFees(0, 50e18); // the fees the batch's own adds collect (pass-1 swap fees on mainnet)
        _convert();
        (,,, uint256 protEth) = vault.feeStats(ETH);
        (, uint256 distImd,, uint256 protImd) = vault.feeStats(IMD_ADDR);
        assertEq(protEth, 0, "no ETH dust to the protocol");
        assertEq(protImd, 0.5e18, "only the 1% cut of the fees");
        assertEq(distImd, 0, "the rest stays with the batch (added, or a leftover it owns)");
        (,, uint256 ethA) = vault.claimable(alice);
        assertApproxEqAbs(ethA, 1 ether, 1e6, "the dust is the first batch's (index rounding only)");
        // The 49.5 IMD went into the position for alice (or stays free and belongs to her shares).
        assertApproxEqRel(vault.benefactorShares(alice), vault.totalShares(), 1e12);
        _assertSolvent(vault);
    }

    // ═══ 3 (Low): ETH dust never blocks a TOKENS claim ═════════════════════════════════════════════════════════════

    function test_tokensClaim_notBlockedByEthDust() public {
        NoEthHolder c = new NoEthHolder();
        NoEthHolder d = new NoEthHolder();
        imd.mint(alice, 150e18);
        vm.startPrank(alice);
        imd.approve(address(vault), 150e18);
        vault.receiveContribution(Currency.wrap(IMD_ADDR), 150e18, address(c));
        vm.stopPrank();
        _contribute(bob, infer, 100e18);
        _convert();
        vm.deal(address(vault), address(vault).balance + 1000);
        _contribute(bob, imd, 10e18);
        _convert(); // distributes the 1000 wei
        (,, uint256 ethC) = vault.claimable(address(c));
        assertGt(ethC, 0, "c is owed ETH dust");
        vault.accrueFees(10e18, 10e18);
        vault.collectFees();
        (uint256 iC, uint256 mC,) = vault.claimable(address(c));

        vm.expectEmit(true, false, false, true, address(vault));
        emit UniAlignmentVault.EthDustKept(address(c), ethC);
        (uint256 io, uint256 mo, uint256 eo) = c.claim(vault, ClaimMode.TOKENS, 0);
        assertEq(io, iC);
        assertEq(mo, mC);
        assertEq(eo, 0, "no ETH sent");
        assertEq(infer.balanceOf(address(c)), iC);
        assertEq(imd.balanceOf(address(c)), mC);
        (uint256 i2, uint256 m2, uint256 e2) = vault.claimable(address(c));
        assertEq(i2 + m2, 0);
        assertEq(e2, ethC, "the dust stays claimable");
        _assertSolvent(vault);

        // ETH mode still needs a payee that takes ETH.
        vm.expectRevert(UniAlignmentVault.TransferFailed.selector);
        c.claim(vault, ClaimMode.ETH, 1);

        // Through a delegate that refuses ETH too.
        c.delegate(vault, address(d));
        vault.accrueFees(10e18, 10e18);
        vault.collectFees();
        address[] memory bs = new address[](1);
        bs[0] = address(c);
        (io, mo, eo) = d.claimAs(vault, bs);
        assertGt(io, 0);
        assertGt(mo, 0);
        assertEq(eo, 0);
        (,, e2) = vault.claimable(address(c));
        assertEq(e2, ethC, "still claimable after the delegate's claim");
        _assertSolvent(vault);
    }

    // ═══ 4 (Low): REINVEST is priced after the leftover's liquidity ═════════════════════════════════════════════════

    function test_reinvest_pricesTheLeftover() public {
        TestableUniAlignmentVault v2 = _newVault();
        TestableUniAlignmentVault[2] memory vs = [vault, v2];
        for (uint256 k; k < 2; ++k) {
            _giveEth(alice, 1 ether, vs[k]);
            _giveEth(bob, 3 ether, vs[k]);
            _convert(vs[k]);
            vs[k].accrueFees(400e18, 400e18);
            vs[k].collectFees();
        }
        // A leftover only on v2: 1000 INFER + 1000 IMD, owned by alice and bob (as _batchShares would see it).
        infer.mint(address(v2), 1000e18);
        imd.mint(address(v2), 1000e18);
        uint256 units = v2.totalLPUnits();
        uint256 sharesBefore = v2.totalShares();

        uint256 a1 = vault.benefactorShares(alice);
        uint256 a2 = v2.benefactorShares(alice);
        vm.prank(alice);
        vault.claimFees(ClaimMode.REINVEST, 1);
        vm.prank(alice);
        v2.claimFees(ClaimMode.REINVEST, 1);
        uint256 got1 = vault.benefactorShares(alice) - a1;
        uint256 got2 = v2.benefactorShares(alice) - a2;
        // 1000 INFER + 1000 IMD at 1:1 is ~1000e18 units: priced at totalShares / (units + 1000e18).
        assertApproxEqRel(got2, got1 * units / (units + 1000e18), 1e15, "leftover priced in");
        assertLt(got2, got1);
        assertEq(sharesBefore, units, "before: one share per unit");
        _assertSolvent(v2);
    }

    /// @dev 7 (Info): REINVEST refuses a zero floor, as ETH mode does.
    function test_reinvest_zeroFloorRefused() public {
        _contributeEth(alice, 1 ether);
        _convert();
        vault.accrueFees(100e18, 0);
        vm.prank(alice);
        vm.expectRevert(UniAlignmentVault.ZeroFloor.selector);
        vault.claimFees(ClaimMode.REINVEST, 0);
        vm.prank(alice);
        vault.claimFees(ClaimMode.REINVEST, 1);
    }

    // ═══ 5 (Low): the split floor is a rate, so it covers every unit sold, earlier holders' leftovers included ══════

    function test_keeperFloor_coversLeftoverPerUnit() public {
        _contributeEth(alice, 10 ether);
        _convert();
        imd.mint(address(vault), 1000e18); // stray: alice's shares own it (_batchShares)
        _contribute(bob, imd, 1e18);
        UniAlignmentVault.ConvertParams memory p = _quote(vault, _paramsFor(_one(IMD_ADDR), _amts(1e18)), 100);
        assertFalse(p.splitInferToImd);
        // ~504 IMD is swapped, nearly all of it alice's: the floor is per unit, so the keeper's rate holds for all of it.
        // The pool 2% worse than the quote: refused.
        vault.setMockPool(uint160(FixedPointMathLib.sqrt((uint256(1) << 192) * 102 / 100)), 1e24);
        vm.prank(keeper);
        vm.expectRevert(UniAlignmentVault.InsufficientOutput.selector);
        vault.convertAndAddLiquidity(p);
        // A rate floor just above the realized rate refuses whatever the size.
        vault.setMockPool(Q96, 1e24);
        p.minSplitRate = p.minSplitRate * 10_000 / 9_900 + 1e12;
        vm.prank(keeper);
        vm.expectRevert(UniAlignmentVault.InsufficientOutput.selector);
        vault.convertAndAddLiquidity(p);
        p.minSplitRate = p.minSplitRate * 9_900 / 10_000;
        vm.recordLogs();
        vm.prank(keeper);
        vault.convertAndAddLiquidity(p);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(vault) && logs[i].topics[0] == SPLIT_SIG) {
                (, uint256 sin, uint256 out) = abi.decode(logs[i].data, (bool, uint256, uint256));
                assertGt(sin, 500e18, "the leftover was swapped too");
                assertGe(out * 1e18 / sin, p.minSplitRate, "at no less than the keeper's rate");
            }
        }
    }

    // ═══ 6 (Info): payment tokens and vaults are refused as swap targets ═══════════════════════════════════════════

    function test_setSwapTarget_refusesPaymentTokensAndVaults() public {
        vm.expectRevert(UniAlignmentVaultFactory.InvalidAddress.selector);
        factory.setSwapTarget(USDC_ADDR, true);
        vm.expectRevert(UniAlignmentVaultFactory.InvalidAddress.selector);
        factory.setSwapTarget(WBTC_ADDR, true);
        registry.setVaultFactory(address(this), true);
        registry.registerVault(address(vault));
        vm.expectRevert(UniAlignmentVaultFactory.InvalidAddress.selector);
        factory.setSwapTarget(address(vault), true);
        // Removing is always allowed.
        factory.setSwapTarget(USDC_ADDR, false);
        assertFalse(factory.isSwapTarget(USDC_ADDR));
    }

    // ═══ 8 (Info): a shortfall in one open token blocks no other token's batch ═════════════════════════════════════

    function test_shortfallInAnotherTokenDoesNotBlock() public {
        address seizableAddr = makeAddr("seizable");
        deployCodeTo("VaultMocks.sol:SeizableToken", abi.encode("SZ", "SZ", 6), seizableAddr);
        SeizableToken sz = SeizableToken(seizableAddr);
        registry.setPaymentToken(seizableAddr, true);
        _contribute(alice, MockToken(seizableAddr), 100e6);
        _contributeEth(bob, 1 ether);
        sz.seize(address(vault), address(this), 1e6); // the issuer takes 1 unit: 99e6 held, 100e6 pending
        UniAlignmentVault.ConvertParams memory p = _paramsFor(_one(ETH), _amts(1 ether));
        vm.prank(keeper);
        uint256 shares = vault.convertAndAddLiquidity(p);
        assertGt(shares, 0, "an ETH batch is not blocked by the other token's shortfall");
        assertEq(vault.pendingByToken(seizableAddr), 100e6, "the shortfall stays with that token");
    }
}
