// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UniAlignmentVault} from "./UniAlignmentVault.sol";
import {IVaultRoutes, RouteHop, HOP_V3, HOP_V4} from "./IVaultRoutes.sol";
import {IMiyaRegistry} from "../../registry/interfaces/IMiyaRegistry.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {ICreateX, CREATEX} from "../../shared/CreateXConstants.sol";
import {Ownable} from "solady/auth/Ownable.sol";

/// @title UniAlignmentVaultFactory (v2)
/// @notice Deploys UniAlignmentVault clones aligned to one INFER/IMD pool and registers each in the MiyaRegistry (this
///         factory must be registered there via setVaultFactory). The factory owns every vault (no passthrough: a
///         vault's config is fixed at deploy) and holds the route table every vault reads: for each payment token, the
///         zRouter hops that turn it into IMD (or into ETH, which then goes to IMD with the rest of the batch's ETH along
///         the ETH route), and the least an ERC-20 contribution in it may carry. The table is owner-managed (a Safe), so
///         a thin or broken route can be replaced, and a minimum raised, for all vaults at once.
contract UniAlignmentVaultFactory is Ownable, IVaultRoutes {
    uint256 public constant MAX_ROUTE_HOPS = 4;
    address internal constant ETH = address(0);

    address public immutable vaultImplementation;
    IMiyaRegistry public immutable registry;
    IPoolManager public immutable poolManager;
    address public immutable zRouter;
    address public immutable infer;
    address public immutable imd;

    /// @notice The alignment pool every vault provides liquidity to (INFER/IMD, hooked, fixed at construction).
    PoolKey internal _poolKey;

    mapping(address token => RouteHop[]) internal _routes;
    address[] internal _routedTokens;
    mapping(address token => bool) internal _everRouted;

    /// @inheritdoc IVaultRoutes
    mapping(address token => uint256) public minContribution;

    event VaultDeployed(address indexed vault, uint256 indexed alignmentTargetId);
    event RouteSet(address indexed token, RouteHop[] hops);
    event MinContributionSet(address indexed token, uint256 amount);

    error InvalidVaultSalt();
    error InvalidAddress();
    error BadRoute();

    constructor(
        IMiyaRegistry registry_,
        IPoolManager poolManager_,
        address zRouter_,
        address infer_,
        address imd_,
        PoolKey memory alignmentPoolKey_
    ) {
        if (
            address(registry_) == address(0) || address(poolManager_) == address(0) || zRouter_ == address(0)
                || infer_ == address(0) || imd_ == address(0)
        ) revert InvalidAddress();
        _initializeOwner(msg.sender);
        registry = registry_;
        poolManager = poolManager_;
        zRouter = zRouter_;
        infer = infer_;
        imd = imd_;
        _poolKey = alignmentPoolKey_;
        UniAlignmentVault implementation = new UniAlignmentVault();
        implementation.disableInitializer();
        vaultImplementation = address(implementation);
    }

    // ── routes ──────────────────────────────────────────────────────────────

    /// @notice Set (or, with no hops, clear) the route that turns `token` into IMD. address(0) = ETH: its route ends in
    ///         IMD, carries every batch's ETH, and is run in reverse for claims taken as ETH. Any other token's route ends
    ///         in IMD (run on its own) or in ETH (that ETH joins the batch's one swap along the ETH route).
    /// @dev Checks shape only: hops chain from `token` to IMD (or ETH), each a v3 hop (fee tier) or a hookless v4 hop
    ///      (static fee, positive spacing). Pool depth is the owner's and the keeper's call. For conversions to be order
    ///      independent, no two routes' own hops should share a pool, nor with the ETH route.
    function setRoute(address token, RouteHop[] calldata hops) external onlyOwner {
        if (token == infer || token == imd) revert BadRoute();
        uint256 h = hops.length;
        if (h > MAX_ROUTE_HOPS) revert BadRoute();
        delete _routes[token];
        if (h != 0) {
            address end = hops[h - 1].tokenOut;
            if (hops[0].tokenIn != token || (end != imd && (end != ETH || token == ETH))) revert BadRoute();
            for (uint256 i; i < h; ++i) {
                RouteHop calldata hop = hops[i];
                if (hop.tokenIn == hop.tokenOut) revert BadRoute();
                if (i != 0 && hop.tokenIn != hops[i - 1].tokenOut) revert BadRoute();
                if (hop.kind == HOP_V4) {
                    if (hop.fee >= 1_000_000 || hop.tickSpacing <= 0) revert BadRoute();
                } else if (hop.kind == HOP_V3) {
                    if (hop.fee != 100 && hop.fee != 500 && hop.fee != 3000 && hop.fee != 10000) revert BadRoute();
                } else {
                    revert BadRoute();
                }
                _routes[token].push(hop);
            }
            if (!_everRouted[token]) {
                _everRouted[token] = true;
                _routedTokens.push(token);
            }
        }
        emit RouteSet(token, hops);
    }

    /// @notice Least amount of `token` one contribution may carry (0 = none), so dust can't be spammed. ERC-20s only:
    ///         ETH contributions have the vault's fixed MIN_CONTRIBUTION.
    function setMinContribution(address token, uint256 amount) external onlyOwner {
        if (token == ETH) revert InvalidAddress();
        minContribution[token] = amount;
        emit MinContributionSet(token, amount);
    }

    function getRoute(address token) external view returns (RouteHop[] memory) {
        return _routes[token];
    }

    function hasRoute(address token) external view returns (bool) {
        return _routes[token].length != 0;
    }

    /// @notice Every token that has had a route (some may be cleared since).
    function routedTokens() external view returns (address[] memory) {
        return _routedTokens;
    }

    function alignmentPoolKey() external view returns (PoolKey memory) {
        return _poolKey;
    }

    // ── vaults ──────────────────────────────────────────────────────────────

    /// @notice Deploy a vault clone via CREATE3, bound to `alignmentTargetId` (active, containing INFER).
    // slither-disable-next-line reentrancy-events
    function deployVault(bytes32 salt, uint256 alignmentTargetId) external onlyOwner returns (address vault) {
        _requireFactorySalt(salt);
        bytes memory proxyCreationCode = abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", vaultImplementation, hex"5af43d82803e903d91602b57fd5bf3"
        );
        vault = ICreateX(CREATEX).deployCreate3(salt, proxyCreationCode);
        UniAlignmentVault(payable(vault)).initialize(
            address(this), poolManager, zRouter, registry, IVaultRoutes(address(this)), infer, imd, _poolKey,
            alignmentTargetId
        );
        registry.registerVault(vault);
        emit VaultDeployed(vault, alignmentTargetId);
    }

    /// @notice Preview the deterministic address for a given salt
    function computeVaultAddress(bytes32 salt) external view returns (address) {
        _requireFactorySalt(salt);
        bytes32 guardedSalt = keccak256(abi.encodePacked(uint256(uint160(address(this))), salt));
        return ICreateX(CREATEX).computeCreate3Address(guardedSalt, CREATEX);
    }

    /// @dev CreateX only binds a salt to its sender when it starts with that sender and a 0x00 byte. Any other salt could
    ///      be claimed by anyone first, and would land somewhere other than computeVaultAddress says.
    function _requireFactorySalt(bytes32 salt) private view {
        if (bytes20(salt) != bytes20(address(this)) || salt[20] != 0x00) revert InvalidVaultSalt();
    }
}
