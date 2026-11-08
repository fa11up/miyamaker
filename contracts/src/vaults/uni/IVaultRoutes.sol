// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev A Uniswap v3 hop through zRouter.swapV3 (`fee` is the pool fee; `tickSpacing` unused, 0).
uint8 constant HOP_V3 = 3;
/// @dev A hookless Uniswap v4 hop through zRouter.swapV4.
uint8 constant HOP_V4 = 4;

/// @notice One swap of a conversion route. address(0) = native ETH (zRouter wraps/unwraps WETH for v3 hops).
struct RouteHop {
    uint8 kind;
    address tokenIn;
    address tokenOut;
    uint24 fee;
    int24 tickSpacing;
}

/// @notice The owner-set route table vaults read at conversion time: for each payment token, the hops that turn it
///         into IMD. IMD and INFER have no route (IMD is used as is; INFER is the pool's other side).
interface IVaultRoutes {
    function getRoute(address token) external view returns (RouteHop[] memory);

    function hasRoute(address token) external view returns (bool);
}

/// @notice zRouter 0x000000000000FB114709235f1ccBFfb925F600e4 (Sourcify-verified source, mainnet). With
///         `exactOut = false`, `amountLimit` is the minimum out (0 = none); it pulls a non-ETH `tokenIn` from msg.sender
///         and refunds its whole ETH balance to msg.sender after an ETH-in swap.
interface IzRouter {
    function swapV3(
        address to,
        bool exactOut,
        uint24 swapFee,
        address tokenIn,
        address tokenOut,
        uint256 swapAmount,
        uint256 amountLimit,
        uint256 deadline
    ) external payable returns (uint256 amountIn, uint256 amountOut);

    function swapV4(
        address to,
        bool exactOut,
        uint24 swapFee,
        int24 tickSpace,
        address tokenIn,
        address tokenOut,
        uint256 swapAmount,
        uint256 amountLimit,
        uint256 deadline
    ) external payable returns (uint256 amountIn, uint256 amountOut);
}
