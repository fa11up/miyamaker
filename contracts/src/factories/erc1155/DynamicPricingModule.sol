// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "solady/auth/Ownable.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {IDynamicPricingModule} from "./interfaces/IDynamicPricingModule.sol";

/// @title DynamicPricingModule
/// @notice Exponential pricing math for ERC1155 LIMITED_DYNAMIC editions.
///         Extracted from ERC1155Instance to avoid inlining rpow into every deployed instance.
///         Deploy once, approve in MiyaRegistry (setComponent), set as factory default.
contract DynamicPricingModule is Ownable, IDynamicPricingModule {
    using FixedPointMathLib for uint256;

    string private _metadataURI;

    constructor() {
        _initializeOwner(msg.sender);
    }

    // ── IComponentModule ─────────────────────────────────────────────────────

    function metadataURI() external view returns (string memory) {
        return _metadataURI;
    }

    function setMetadataURI(string calldata uri) external onlyOwner {
        _metadataURI = uri;
        emit MetadataURIUpdated(uri);
    }

    // ── IDynamicPricingModule ─────────────────────────────────────────────────

    /// @inheritdoc IDynamicPricingModule
    /// @dev Equal to `calculateBatchCost(basePrice, priceIncreaseRate, minted, 1)`: the quoted next price is what a
    ///      one-piece mint charges, rounded up the same way.
    function calculatePrice(
        uint256 basePrice,
        uint256 priceIncreaseRate,
        uint256 minted
    ) external pure returns (uint256) {
        return _batchCost(basePrice, priceIncreaseRate, minted, 1);
    }

    /// @inheritdoc IDynamicPricingModule
    function calculateBatchCost(
        uint256 basePrice,
        uint256 priceIncreaseRate,
        uint256 startMinted,
        uint256 amount
    ) external pure returns (uint256) {
        return _batchCost(basePrice, priceIncreaseRate, startMinted, amount);
    }

    /// @dev Rounds up (the buyer never pays less than the curve) with a floor of basePrice per piece. One piece is
    ///      basePrice * r^start rounded up; more use the geometric series.
    function _batchCost(uint256 basePrice, uint256 priceIncreaseRate, uint256 startMinted, uint256 amount)
        private
        pure
        returns (uint256 cost)
    {
        if (priceIncreaseRate == 0) return basePrice * amount;
        uint256 r = 1e18 + (priceIncreaseRate * 1e14);
        uint256 rStart = FixedPointMathLib.rpow(r, startMinted, 1e18);
        if (amount == 1) {
            cost = FixedPointMathLib.mulWadUp(basePrice, rStart);
        } else {
            // Geometric series: sum = basePrice * r^start * (r^amount - 1) / (r - 1). Divide first and last by the
            // large terms, so a small basePrice doesn't truncate to nothing on the way.
            uint256 rAmount = FixedPointMathLib.rpow(r, amount, 1e18);
            cost = FixedPointMathLib.fullMulDivUp(
                FixedPointMathLib.fullMulDivUp(basePrice, rStart, r - 1e18), rAmount - 1e18, 1e18
            );
        }
        uint256 least = basePrice * amount;
        if (cost < least) cost = least;
    }
}
