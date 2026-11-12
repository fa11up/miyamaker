// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { MiyaPool } from "../../src/pools/MiyaPool.sol";
import { MiyaPoolFactory } from "../../src/pools/MiyaPoolFactory.sol";

interface IDrop {
    function totalSupply() external view returns (uint256);
    function ownerOf(uint256 id) external view returns (address);
    function setApprovalForAll(address operator, bool approved) external;
}

interface IVaultCfg {
    function config() external view returns (address);
    function minContribution(address token) external view returns (uint256);
}

interface IERC20Like {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IVaultView {
    function pendingOf(address benefactor, address token) external view returns (uint256);
    function pendingByToken(address token) external view returns (uint256);
    function openBatchTokens() external view returns (address[] memory);
}

/// @notice MiyaPool v2 on a mainnet fork: a pool for the live Miyamaker drop, filled by its real holders (impersonated),
///         exercising random redeems, picks paying the fee in IMD and in INFER into the LIVE default alignment vault
///         (deployments/1.json defaultVault, booked to the picker), and the lock between them. No change to the vault or
///         registry: the fees are the live vault's minimum contributions, read on chain.
///         RPC: MAINNET_RPC_URL (default https://ethereum-rpc.publicnode.com); FORK_BLOCK pins a block.
///         Skipped (not failed) when the RPC is unreachable or SKIP_FORK_TESTS=true; REQUIRE_FORK_TESTS=true fails instead.
contract MiyaPoolV2ForkTest is Test {
    address constant DROP = 0xB86B68BCa287AFD48F81D1F792db69368664a120;
    address constant DEFAULT_VAULT = 0x34bE8C25C7922B3052D1955b8E63fB97F778AA08;
    address constant IMD = 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7;
    address constant INFER = 0x53d0eA0A685220718Dc6a0a6e4617194C6F37921;
    uint256 constant UNIT = 1e18;
    uint256 IMD_FEE;
    uint256 INFER_FEE;

    bool forked;
    MiyaPoolFactory factory;
    MiyaPool pool;
    address trader = makeAddr("trader");
    uint256[] deposited;

    function setUp() public {
        if (vm.envOr("SKIP_FORK_TESTS", false)) return;
        string memory rpc = vm.envOr("MAINNET_RPC_URL", string("https://ethereum-rpc.publicnode.com"));
        uint256 blockNo = vm.envOr("FORK_BLOCK", uint256(0));
        if (blockNo == 0) {
            try vm.createSelectFork(rpc) {
                forked = true;
            } catch { }
        } else {
            try vm.createSelectFork(rpc, blockNo) {
                forked = true;
            } catch { }
        }
        if (!forked) {
            require(!vm.envOr("REQUIRE_FORK_TESTS", false), "fork tests required but no mainnet fork");
            return;
        }
        factory = new MiyaPoolFactory(DEFAULT_VAULT);
        address cfg = IVaultCfg(DEFAULT_VAULT).config();
        IMD_FEE = IVaultCfg(cfg).minContribution(IMD);
        INFER_FEE = IVaultCfg(cfg).minContribution(INFER);
        // below the live minimum is refused at creation
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.FeeBelowVaultMinimum.selector, IMD, IMD_FEE));
        factory.createPool(DROP, IMD_FEE - 1, INFER_FEE);
        pool = MiyaPool(factory.createPool(DROP, IMD_FEE, INFER_FEE));

        // Real holders deposit up to 12 pieces, minting the pool tokens to one trader.
        uint256 supply = IDrop(DROP).totalSupply();
        for (uint256 id = 0; id <= supply + 5 && deposited.length < 12; ++id) {
            address owner;
            try IDrop(DROP).ownerOf(id) returns (address o) {
                owner = o;
            } catch {
                continue;
            }
            vm.startPrank(owner);
            IDrop(DROP).setApprovalForAll(address(pool), true);
            uint256[] memory one = new uint256[](1);
            one[0] = id;
            try pool.deposit(one, new uint256[](0), trader) {
                deposited.push(id);
            } catch { }
            vm.stopPrank();
        }
    }

    function test_fork_bothRedeemPathsAndPickFeesIntoTheLiveVault() public {
        vm.skip(!forked);
        uint256 n = deposited.length;
        assertGe(n, 7, "need at least 7 real pieces deposited");
        emit log_named_uint("pieces deposited by real holders", n);
        assertEq(pool.balanceOf(trader), n * UNIT);
        assertTrue(pool.randomEnabled());
        assertEq(pool.vault(), DEFAULT_VAULT);

        // Random redeem: exactly 1 token, and while it is pending every piece it could draw is locked.
        address luck = makeAddr("luck");
        vm.prank(trader);
        uint256 c = pool.commitRedeem(1, luck);
        assertEq(pool.balanceOf(trader), (n - 1) * UNIT);
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(MiyaPool.LockedForRandomRedeem.selector, deposited[0]));
        pool.redeem(_one(deposited[0]), new uint256[](0), trader, IMD);
        (, uint64 target,,) = pool.commits(c);
        vm.roll(target + 1);
        vm.setBlockhash(target, keccak256("fork seed"));
        pool.revealRedeem(c);
        uint256 got;
        for (uint256 i; i < n; ++i) {
            if (IDrop(DROP).ownerOf(deposited[i]) == luck) got = deposited[i];
        }
        assertTrue(IDrop(DROP).ownerOf(got) == luck, "random piece delivered");

        // Picks: 1 pool token each plus the fee, paid in IMD or INFER at the picker's choice, booked by the LIVE vault
        // as the picker's contribution.
        address picker = makeAddr("picker");
        vm.prank(trader);
        pool.transfer(picker, 3 * UNIT);
        deal(IMD, picker, 2 * IMD_FEE);
        deal(INFER, picker, INFER_FEE);
        vm.startPrank(picker);
        IERC20Like(IMD).approve(address(pool), type(uint256).max);
        IERC20Like(INFER).approve(address(pool), type(uint256).max);
        vm.stopPrank();
        uint256[] memory free = new uint256[](3);
        uint256 k;
        for (uint256 i; i < n && k < 3; ++i) {
            if (deposited[i] != got) free[k++] = deposited[i];
        }

        IVaultView v = IVaultView(DEFAULT_VAULT);
        uint256 imdPendingBefore = v.pendingByToken(IMD);
        uint256 vaultImdBefore = IERC20Like(IMD).balanceOf(DEFAULT_VAULT);
        vm.prank(picker);
        uint256 g = gasleft();
        pool.redeem(_one(free[0]), new uint256[](0), picker, IMD);
        emit log_named_uint("pick gas, fee in IMD (live vault)", g - gasleft());
        assertEq(IDrop(DROP).ownerOf(free[0]), picker);
        assertEq(v.pendingOf(picker, IMD), IMD_FEE, "IMD fee booked to the picker");
        assertEq(v.pendingByToken(IMD) - imdPendingBefore, IMD_FEE);
        assertEq(IERC20Like(IMD).balanceOf(DEFAULT_VAULT) - vaultImdBefore, IMD_FEE);

        uint256 inferPendingBefore = v.pendingByToken(INFER);
        vm.prank(picker);
        g = gasleft();
        pool.redeem(_one(free[1]), new uint256[](0), picker, INFER);
        emit log_named_uint("pick gas, fee in INFER (live vault)", g - gasleft());
        assertEq(IDrop(DROP).ownerOf(free[1]), picker);
        assertEq(v.pendingOf(picker, INFER), INFER_FEE, "INFER fee booked to the picker");
        assertEq(v.pendingByToken(INFER) - inferPendingBefore, INFER_FEE);

        // a second IMD pick adds to the same booking
        vm.prank(picker);
        pool.redeem(_one(free[2]), new uint256[](0), picker, IMD);
        assertEq(v.pendingOf(picker, IMD), 2 * IMD_FEE);
        assertEq(pool.balanceOf(picker), 0, "1 pool token per pick");

        assertEq(IERC20Like(IMD).balanceOf(address(pool)), 0, "pool kept no IMD");
        assertEq(IERC20Like(INFER).balanceOf(address(pool)), 0, "pool kept no INFER");
        assertEq(IERC20Like(IMD).allowance(address(pool), DEFAULT_VAULT), 0);
        assertEq(pool.totalSupply() + UNIT * pool.pendingUnits(), UNIT * pool.heldUnits());
        bool hasImd;
        bool hasInfer;
        address[] memory open = v.openBatchTokens();
        for (uint256 i; i < open.length; ++i) {
            if (open[i] == IMD) hasImd = true;
            if (open[i] == INFER) hasInfer = true;
        }
        assertTrue(hasImd && hasInfer, "both fees pending for the keeper's next batch");
    }

    function _one(uint256 v) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = v;
    }
}
