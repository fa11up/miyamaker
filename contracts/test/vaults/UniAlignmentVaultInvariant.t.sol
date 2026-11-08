// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {UniAlignmentVault} from "../../src/vaults/uni/UniAlignmentVault.sol";
import {UniAlignmentVaultFactory} from "../../src/vaults/uni/UniAlignmentVaultFactory.sol";
import {ClaimMode} from "../../src/interfaces/IAlignmentVault.sol";
import {TestableUniAlignmentVault} from "../helpers/TestableUniAlignmentVault.sol";
import {MockToken} from "./mocks/VaultMocks.sol";
import {VaultTestBase} from "./VaultTestBase.sol";

contract VaultHandler is Test {
    TestableUniAlignmentVault public vault;
    UniAlignmentVaultFactory public factory;
    address public keeper;
    address[] public actors;
    address[] public tokens; // address(0) = ETH
    address constant INFER = 0x53d0eA0A685220718Dc6a0a6e4617194C6F37921;
    address constant IMD = 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7;

    // ghosts: monotonicity (a violation flips the flag; the invariant reads it)
    bool public sharesDecreased;
    bool public accDecreased;
    mapping(address => uint256) public lastShares;
    uint256 public lastTotalShares;
    uint256[3] public lastAcc;
    uint256 public conversions;
    bytes4 public unexpected;
    bytes public unexpectedErr;
    uint256 public claims;

    constructor(
        TestableUniAlignmentVault v,
        UniAlignmentVaultFactory f,
        address keeper_,
        address[] memory actors_,
        address[] memory tokens_
    ) {
        vault = v;
        factory = f;
        keeper = keeper_;
        actors = actors_;
        tokens = tokens_;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function contribute(uint256 actorSeed, uint256 tokenSeed, uint256 amount) external {
        address who = _actor(actorSeed);
        address t = tokens[tokenSeed % tokens.length];
        if (t == address(0)) {
            amount = bound(amount, 0.001 ether, 50 ether);
            vm.deal(who, amount);
            vm.prank(who);
            vault.receiveContribution{value: amount}(Currency.wrap(t), amount, who);
        } else {
            uint8 dec = MockToken(t).decimals();
            amount = bound(amount, 1, 100_000 * 10 ** dec);
            MockToken(t).mint(who, amount);
            vm.startPrank(who);
            MockToken(t).approve(address(vault), amount);
            vault.receiveContribution(Currency.wrap(t), amount, who);
            vm.stopPrank();
        }
        _check();
    }

    function convert() external {
        address[] memory toks = vault.openBatchTokens();
        if (toks.length == 0) return;
        UniAlignmentVault.ConvertParams memory p;
        p.tokens = toks;
        p.minOuts = new uint256[][](toks.length);
        for (uint256 i; i < toks.length; ++i) {
            if (toks[i] == INFER || toks[i] == IMD) continue;
            p.minOuts[i] = new uint256[](factory.getRoute(toks[i]).length);
        }
        p.minSplitOut = 1;
        p.deadline = block.timestamp;
        vm.prank(keeper);
        try vault.convertAndAddLiquidity(p) {
            ++conversions;
        } catch (bytes memory err) {
            // A batch too small to make liquidity, or a split too small to clear the floor, may fail; nothing else.
            bytes4 sel = bytes4(err);
            if (
                sel != UniAlignmentVault.InsufficientLiquidity.selector
                    && sel != UniAlignmentVault.InsufficientOutput.selector
            ) {
                unexpected = sel;
                unexpectedErr = err;
            }
        }
        _check();
    }

    function accrue(uint256 f0, uint256 f1, bool collect) external {
        if (vault.totalLPUnits() == 0) return;
        vault.accrueFees(bound(f0, 0, 1_000e18), bound(f1, 0, 1_000e18));
        if (collect) vault.collectFees();
        _check();
    }

    function claim(uint256 actorSeed, uint256 modeSeed) external {
        address who = _actor(actorSeed);
        ClaimMode mode = ClaimMode(modeSeed % 3);
        vm.prank(who);
        try vault.claimFees(mode, 1) {
            ++claims;
        } catch {}
        _check();
    }

    function movePrice(uint256 seed) external {
        // 0.25x .. 4x around 1 IMD per INFER
        uint256 s = bound(seed, (uint256(1) << 96) / 2, (uint256(1) << 96) * 2);
        vault.setMockPool(uint160(s), 1e24);
        _check();
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 3 days));
    }

    function _check() internal {
        for (uint256 i; i < actors.length; ++i) {
            uint256 s = vault.benefactorShares(actors[i]);
            if (s < lastShares[actors[i]]) sharesDecreased = true;
            lastShares[actors[i]] = s;
        }
        uint256 ts = vault.totalShares();
        if (ts < lastTotalShares) sharesDecreased = true;
        lastTotalShares = ts;
        address[3] memory ft = [INFER, IMD, address(0)];
        for (uint256 i; i < 3; ++i) {
            (uint256 acc,,,) = vault.feeStats(ft[i]);
            if (acc < lastAcc[i]) accDecreased = true;
            lastAcc[i] = acc;
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }
}

/// forge-config: default.invariant.fail-on-revert = true
contract UniAlignmentVaultInvariantTest is VaultTestBase {
    VaultHandler handler;
    address[] actorList;
    address[] tokenList;

    function setUp() public override {
        super.setUp();
        actorList.push(alice);
        actorList.push(bob);
        actorList.push(carol);
        actorList.push(dan);
        tokenList.push(ETH);
        tokenList.push(USDC_ADDR);
        tokenList.push(WBTC_ADDR);
        tokenList.push(CBBTC_ADDR);
        tokenList.push(IMDUSD_ADDR);
        tokenList.push(IMD_ADDR);
        tokenList.push(INFER_ADDR);
        handler = new VaultHandler(vault, factory, keeper, actorList, tokenList);
        targetContract(address(handler));
    }

    /// @dev No balance owed beyond what is held, per token: fees + protocol cut + pending contributions.
    function invariant_solventPerToken() public view {
        _assertSolvent(vault);
        address[4] memory others = [USDC_ADDR, WBTC_ADDR, CBBTC_ADDR, IMDUSD_ADDR];
        for (uint256 i; i < 4; ++i) {
            assertGe(MockToken(others[i]).balanceOf(address(vault)), vault.pendingByToken(others[i]));
        }
    }

    /// @dev What benefactors can claim never exceeds what was distributed and not yet claimed, per fee token.
    function invariant_claimsWithinDistributed() public view {
        uint256[3] memory sum;
        for (uint256 a; a < actorList.length; ++a) {
            (uint256 i, uint256 m, uint256 e) = vault.claimable(actorList[a]);
            sum[0] += i;
            sum[1] += m;
            sum[2] += e;
        }
        address[3] memory ft = [INFER_ADDR, IMD_ADDR, ETH];
        for (uint256 k; k < 3; ++k) {
            (, uint256 dist, uint256 claimed,) = vault.feeStats(ft[k]);
            assertLe(sum[k], dist - claimed);
        }
    }

    function invariant_sharesWithinTotal() public view {
        uint256 sum;
        for (uint256 a; a < actorList.length; ++a) sum += vault.benefactorShares(actorList[a]);
        assertLe(sum, vault.totalShares());
        assertLe(vault.totalShares(), vault.totalLPUnits());
    }

    function invariant_pendingMatchesBenefactors() public view {
        for (uint256 t; t < tokenList.length; ++t) {
            uint256 sum;
            for (uint256 a; a < actorList.length; ++a) sum += vault.pendingOf(actorList[a], tokenList[t]);
            assertEq(sum, vault.pendingByToken(tokenList[t]));
        }
    }

    /// @dev Shares (per benefactor and total) and fees per share never decrease.
    function invariant_monotonic() public view {
        assertFalse(handler.sharesDecreased(), "shares decreased");
        assertFalse(handler.accDecreased(), "fee per share decreased");
        assertEq(handler.unexpectedErr(), "", "unexpected conversion failure");
    }

    function afterInvariant() external view {
        // The campaign must actually exercise conversions and claims.
        assertGt(handler.conversions(), 0, "no conversion ran");
    }
}
