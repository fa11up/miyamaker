// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";

/**
 * @title CurveMath
 * @notice Prices of a curve edition (docs/CURVE-EDITIONS.md). Pure and exact: the same inputs always give the same
 *         price, so what a copy's mint puts in the reserve is exactly what burning that copy takes out.
 *
 *         Copy n (1-based) costs:
 *         - EXPONENTIAL: P(n) = startPrice * (1 + growthBps / 10_000)^(n - 1), in 1e18 fixed point (rounded down)
 *         - LINEAR:      P(n) = startPrice + step * (n - 1)
 *         Its burn value is P(n) minus the spread, P(n) - floor(P(n) * spreadBps / 10_000).
 */
library CurveMath {
    uint8 internal constant EXPONENTIAL = 0;
    uint8 internal constant LINEAR = 1;

    uint256 internal constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;
    /// @notice The most copies an edition can have.
    uint256 internal constant MAX_SUPPLY = 10_000;
    /// @notice The fastest an exponential curve can grow: 5% per copy.
    uint256 internal constant MAX_GROWTH_BPS = 500;
    /// @notice The spread's bounds: 5% to 30% of the price.
    uint256 internal constant MIN_SPREAD_BPS = 500;
    uint256 internal constant MAX_SPREAD_BPS = 3000;

    error InvalidShape();

    /// @notice Price of copy `n` (n >= 1). Reverts on overflow (checked maths; solady's rpow reverts too).
    function price(uint8 shape, uint256 startPrice, uint256 step, uint256 n) internal pure returns (uint256) {
        if (shape == LINEAR) return startPrice + step * (n - 1);
        if (shape != EXPONENTIAL) revert InvalidShape();
        uint256 factor = FixedPointMathLib.rpow(WAD + step * (WAD / BPS), n - 1, WAD);
        return FixedPointMathLib.fullMulDiv(startPrice, factor, WAD);
    }

    /// @notice The part of a price the reserve keeps for the burn: the price minus the spread.
    function burnValue(uint256 p, uint256 spreadBps) internal pure returns (uint256) {
        return p - (p * spreadBps) / BPS;
    }

    /// @notice What minting `qty` copies costs at supply `supply`, and how much of it the reserve keeps.
    function mintCost(uint8 shape, uint256 startPrice, uint256 step, uint256 spreadBps, uint256 supply, uint256 qty)
        internal
        pure
        returns (uint256 cost, uint256 toReserve)
    {
        for (uint256 i = 1; i <= qty; ++i) {
            uint256 p = price(shape, startPrice, step, supply + i);
            cost += p;
            toReserve += burnValue(p, spreadBps);
        }
    }

    /// @notice What burning the top `qty` copies at supply `supply` pays (highest first).
    function burnPayout(uint8 shape, uint256 startPrice, uint256 step, uint256 spreadBps, uint256 supply, uint256 qty)
        internal
        pure
        returns (uint256 payout)
    {
        for (uint256 i; i < qty; ++i) {
            payout += burnValue(price(shape, startPrice, step, supply - i), spreadBps);
        }
    }
}
