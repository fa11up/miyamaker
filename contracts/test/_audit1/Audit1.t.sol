// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/console2.sol";
import {VaultTestBase} from "../vaults/VaultTestBase.sol";
import {MockToken} from "../vaults/mocks/VaultMocks.sol";

contract Audit1Test is VaultTestBase {
    function _free() internal view returns (uint256 fImd, uint256 fInfer) {
        (, uint256 d, uint256 c, uint256 pr) = vault.feeStats(IMD_ADDR);
        fImd = imd.balanceOf(address(vault)) - (d - c + pr) - vault.pendingByToken(IMD_ADDR);
        (, d, c, pr) = vault.feeStats(INFER_ADDR);
        fInfer = infer.balanceOf(address(vault)) - (d - c + pr) - vault.pendingByToken(INFER_ADDR);
    }

    // Natural leftover of a big batch is collected by the next tiny batch.
    function test_a1_leftoverCapturedByTinyBatch() public {
        _contribute(alice, imd, 10_000e18);
        uint256 s1 = _convert();
        (uint256 fImd, uint256 fInfer) = _free();
        console2.log("batch1 shares", s1);
        console2.log("leftover IMD", fImd);
        console2.log("leftover INFER", fInfer);
        _contribute(bob, imd, 10e18); // 0.1% of alice
        uint256 s2 = _convert();
        console2.log("batch2 shares (bob)", s2);
        console2.log("bob/alice shares x1e6", vault.benefactorShares(bob) * 1e6 / vault.benefactorShares(alice));
        console2.log("fair x1e6", uint256(1000));
    }

    // Leftover of 1% (the bound the repo's own test allows) taken by a 0.1-ETH-worth batch.
    function test_a1_leftoverDonationEquivalent() public {
        _contribute(alice, imd, 100_000e18); // 10 ETH
        _convert();
        (uint256 fImd0, uint256 fInfer0) = _free();
        imd.mint(address(vault), 500e18);  // stand-in for a 1% leftover: 500 IMD + 500 INFER (=0.1 ETH)
        infer.mint(address(vault), 500e18);
        _contribute(bob, imd, 1_000e18); // 0.1 ETH, the keeper's minimum batch
        uint256 s2 = _convert();
        uint256 fair = s2 * 1000e18 / (1000e18 + 1000e18 + fImd0 + fInfer0);
        console2.log("bob shares", vault.benefactorShares(bob));
        console2.log("bob fair approx", fair);
        console2.log("alice shares", vault.benefactorShares(alice));
    }

    // Stranded shares: totalShares minus what all benefactors own, after many partial conversions.
    function test_a1_strandedShares() public {
        _contribute(alice, infer, 1_000_000e18);
        _contribute(bob, infer, 333_333e18 + 7);
        _contribute(carol, imd, 1e18 + 3);
        for (uint256 k; k < 6; ++k) {
            uint256 pend = vault.pendingByToken(INFER_ADDR);
            _convertSome(_one(INFER_ADDR), _amts(pend - pend / 1000)); // leave 0.1% each time
            _contribute(dan, infer, 3500e18);
        }
        _convert();
        uint256 owned = vault.benefactorShares(alice) + vault.benefactorShares(bob) + vault.benefactorShares(carol)
            + vault.benefactorShares(dan);
        console2.log("totalShares", vault.totalShares());
        console2.log("owned", owned);
        console2.log("stranded", vault.totalShares() - owned);
        console2.log("pending INFER left (unowned)", vault.pendingByToken(INFER_ADDR));
        _assertSolvent(vault);
    }
}
