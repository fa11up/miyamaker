// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "solady/auth/Ownable.sol";
import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";
import { IMiyaRegistry } from "../../registry/interfaces/IMiyaRegistry.sol";
import { CurveEdition } from "./CurveEdition.sol";

/**
 * @title CurveEditionFactory
 * @notice Launches CurveEdition collections (docs/CURVE-EDITIONS.md) and registers them in the MiyaRegistry, which
 *         must list this factory first (`registry.setFactory`). Each collection snapshots the registry's treasury and
 *         protocol fee at launch.
 *
 *         The owner (the miyamints Safe) sets the highest price a curve may reach in each currency (`priceCap`): an
 *         edition whose last copy would cost more is refused when it is added. A currency without a cap can't be used.
 *         Caps apply to editions added after they change; an edition's curve never changes.
 */
contract CurveEditionFactory is Ownable, ReentrancyGuard {
    error InvalidAddress();
    error InvalidName();
    error InvalidVault();
    error NotCreator();
    error CapTooHigh();

    /// @notice The vault's share of each spread, checked against the registry's alignment minimum.
    uint16 public constant VAULT_SHARE_OF_SPREAD_BPS = 3000;

    IMiyaRegistry public immutable registry;
    address public immutable weth;

    /// @notice Highest price a curve's last copy may have, per currency (address(0) = ETH). 0 = not allowed.
    mapping(address token => uint256) public priceCap;

    event InstanceCreated(
        address indexed instance, address indexed creator, string name, address indexed vault, uint16 protocolFeeBps
    );
    event PriceCapSet(address indexed token, uint256 cap);

    /// @dev Stores its arguments only, so it deploys the same on an empty chain.
    constructor(address owner_, IMiyaRegistry registry_, address weth_) {
        if (owner_ == address(0) || address(registry_) == address(0) || weth_ == address(0)) revert InvalidAddress();
        _initializeOwner(owner_);
        registry = registry_;
        weth = weth_;
    }

    /// @notice Launch a curve-edition collection owned by the caller. Editions are added on the collection.
    function createInstance(bytes32 salt, string calldata name, string calldata contractURI, address vault)
        external
        nonReentrant
        returns (address instance)
    {
        if (bytes(name).length == 0) revert InvalidName();
        if (vault == address(0) || !registry.isVault(vault)) revert InvalidVault();
        registry.checkAlignmentBps(VAULT_SHARE_OF_SPREAD_BPS);
        address treasury = registry.treasury();
        uint16 protocolFeeBps = registry.protocolFeeBps();

        instance = address(
            new CurveEdition{ salt: _creatorSalt(salt, msg.sender) }(
                name, contractURI, msg.sender, vault, address(registry), treasury, protocolFeeBps, weth
            )
        );
        registry.registerInstance(instance, vault, msg.sender);
        emit InstanceCreated(instance, msg.sender, name, vault, protocolFeeBps);
    }

    /// @notice Set the highest price a curve may reach in `token`. 0 stops new editions in that token.
    /// @dev Bounded so no price under the cap can overflow the per-copy splits or a 50-copy sum.
    function setPriceCap(address token, uint256 cap) external onlyOwner {
        if (cap > type(uint128).max) revert CapTooHigh();
        priceCap[token] = cap;
        emit PriceCapSet(token, cap);
    }

    /// @dev Binds the address to the creator, so nobody else can take the address a creator's salt gives.
    function _creatorSalt(bytes32 salt, address creator) internal pure returns (bytes32) {
        return keccak256(abi.encode(creator, salt));
    }
}
