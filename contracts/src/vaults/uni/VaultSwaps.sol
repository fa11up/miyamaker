// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {IVaultRoutes, IzRouter, RouteHop, HOP_V3, HOP_V4} from "./IVaultRoutes.sol";

/**
 * @title VaultSwaps
 * @notice UniAlignmentVault's route execution through zRouter and the balancing-swap math, as a linked library: the vault
 *         calls it by DELEGATECALL, so every swap, approval and balance is the vault's own (and its receive() sees the
 *         same transient "collecting" flag), while this code stays out of the vault's bytecode (EIP-170).
 * @dev Errors carry the vault's names and so the vault's selectors.
 */
library VaultSwaps {
    error NoRoute(address token);
    error BadRoute(address token);
    error BadParams();
    error InsufficientOutput();

    address internal constant ETH = address(0);
    uint256 internal constant MAX_ROUTE_HOPS = 4;
    uint256 private constant Q96 = 1 << 96;
    /// @dev = UniAlignmentVault._COLLECTING_SLOT: set while zRouter pays the vault, so receive() books nothing.
    uint256 private constant _COLLECTING_SLOT = 0x9fffd68a8e82dadd8810fe84758545b0fb4c40f84b514ef129e417c2e244d1a1;

    /// @dev Run `token`'s route (or its reverse) through zRouter; returns the final output and whether it is ETH (a
    ///      route ending in ETH, for the batch's one ETH -> IMD swap). The ETH route itself always ends in IMD. A hop that
    ///      receives nothing (dust) ends the route at 0.
    function route(
        IVaultRoutes routes,
        address zRouter,
        address imd,
        address token,
        uint256 amountIn,
        uint256[] memory minOuts,
        bool reverse
    ) external returns (uint256 amount, bool toEth) {
        RouteHop[] memory hops = routes.getRoute(token);
        uint256 h = hops.length;
        if (h == 0) revert NoRoute(token);
        if (h > MAX_ROUTE_HOPS) revert BadRoute(token);
        if (!reverse && minOuts.length != h) revert BadParams();
        // Re-checked here so a bad table can never send the vault's tokens anywhere but to IMD (or to ETH, then IMD).
        address first = reverse ? hops[h - 1].tokenOut : hops[0].tokenIn;
        address last = reverse ? hops[0].tokenIn : hops[h - 1].tokenOut;
        toEth = !reverse && token != ETH && last == ETH;
        if (first != (reverse ? imd : token) || (last != (reverse ? token : imd) && !toEth)) revert BadRoute(token);

        amount = amountIn;
        for (uint256 k; k < h; ++k) {
            if (amount == 0) return (0, toEth);
            RouteHop memory hop = hops[reverse ? h - 1 - k : k];
            if (reverse) (hop.tokenIn, hop.tokenOut) = (hop.tokenOut, hop.tokenIn);
            amount = _swapHop(zRouter, hop, amount, reverse ? 0 : minOuts[k]);
        }
    }

    // slither-disable-next-line arbitrary-send-eth,unused-return
    function _swapHop(address zRouter, RouteHop memory hop, uint256 amountIn, uint256 minOut)
        private
        returns (uint256 amountOut)
    {
        uint256 before = _balanceOf(hop.tokenOut);
        uint256 value;
        if (hop.tokenIn == ETH) value = amountIn;
        else SafeTransferLib.safeApproveWithRetry(hop.tokenIn, zRouter, amountIn);

        // zRouter pays ETH outputs and refunds into receive(): not contributions.
        _setCollecting(true);
        if (hop.kind == HOP_V4) {
            IzRouter(zRouter).swapV4{value: value}(
                address(this), false, hop.fee, hop.tickSpacing, hop.tokenIn, hop.tokenOut, amountIn, minOut,
                block.timestamp
            );
        } else if (hop.kind == HOP_V3) {
            IzRouter(zRouter).swapV3{value: value}(
                address(this), false, hop.fee, hop.tokenIn, hop.tokenOut, amountIn, minOut, block.timestamp
            );
        } else {
            revert BadRoute(hop.tokenIn);
        }
        _setCollecting(false);
        if (hop.tokenIn != ETH) SafeTransferLib.safeApprove(hop.tokenIn, zRouter, 0);

        amountOut = _balanceOf(hop.tokenOut) - before;
        if (amountOut < minOut) revert InsufficientOutput();
    }

    /// @dev How much of the side in excess to swap so what is left pairs at the pool's ratio after the swap has moved
    ///      its price: the single-sided add formula on the excess against the pool's virtual reserve of that token.
    ///      Returns the direction (true = INFER -> IMD), the amount, and the excess.
    function splitAmount(
        uint256 amtInfer,
        uint256 amtImd,
        uint160 sqrtP,
        uint128 poolL,
        bool inferIsCurrency0,
        uint24 fee
    ) external pure returns (bool inferToImd, uint256 swapAmount, uint256 excess) {
        (uint256 a0, uint256 a1) = inferIsCurrency0 ? (amtInfer, amtImd) : (amtImd, amtInfer);
        bool zeroForOne;
        uint256 reserve;
        (zeroForOne, excess, reserve) = _excess(a0, a1, sqrtP, poolL);
        swapAmount = _balancedSwap(excess, reserve, fee);
        inferToImd = zeroForOne == inferIsCurrency0;
    }

    /// @dev The side in excess (zeroForOne = currency0 in excess), by how much, and the pool's virtual reserve of it.
    function _excess(uint256 a0, uint256 a1, uint160 sqrtP, uint128 poolL)
        private
        pure
        returns (bool zeroForOne, uint256 excess, uint256 reserve)
    {
        // Value of a0 in token1 units: a0 * P, P = (sqrtP / 2^96)^2.
        uint256 a0In1 = FixedPointMathLib.fullMulDiv(FixedPointMathLib.fullMulDiv(a0, sqrtP, Q96), sqrtP, Q96);
        if (a1 > a0In1) {
            excess = a1 - a0In1; // token1 in excess: swap token1 -> token0
            reserve = FixedPointMathLib.fullMulDiv(poolL, sqrtP, Q96);
        } else {
            uint256 a1In0 = FixedPointMathLib.fullMulDiv(FixedPointMathLib.fullMulDiv(a1, Q96, sqrtP), Q96, sqrtP);
            excess = a0 > a1In0 ? a0 - a1In0 : 0;
            reserve = FixedPointMathLib.fullMulDiv(poolL, Q96, sqrtP);
            zeroForOne = true;
        }
    }

    /// @dev Bounded by the no-price-impact answer, amount / (2 - fee), which also covers depth too large to compute.
    function _balancedSwap(uint256 amount, uint256 reserve, uint24 fee) private pure returns (uint256) {
        if (amount == 0) return 0;
        uint256 afterFee = 1e6 - fee;
        uint256 feeTerm = 2e6 - fee;
        uint256 bound = FixedPointMathLib.fullMulDiv(amount, 1e6, feeTerm);
        if (reserve == 0 || reserve > 1e30 || amount > 1e30) return bound;
        uint256 root = FixedPointMathLib.sqrt(reserve * (reserve * feeTerm * feeTerm + 4 * afterFee * 1e6 * amount));
        uint256 base = reserve * feeTerm;
        uint256 balanced = root > base ? (root - base) / (2 * afterFee) : 0;
        return balanced < bound ? balanced : bound;
    }

    function _balanceOf(address token) private view returns (uint256) {
        return token == ETH ? address(this).balance : SafeTransferLib.balanceOf(token, address(this));
    }

    function _setCollecting(bool collecting) private {
        assembly ("memory-safe") {
            tstore(_COLLECTING_SLOT, collecting)
        }
    }
}
