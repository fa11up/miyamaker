// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { MiyaPool } from "./MiyaPool.sol";

/**
 * @title MiyaPoolFactory (v2)
 * @notice Permissionless, ownerless factory for MiyaPool. One pool per collection, with both redeem paths (random
 *         redeems only where `MiyaPool.randomEnabled`). Whoever creates a collection's pool sets its targeted-redeem
 *         premium (0 to MiyaPool.MAX_PREMIUM_BPS), fixed forever. The premium is sold for ETH that goes to `vault`.
 *         Pools deploy with CREATE2 from (collection, kind, premium) and read the vault from this factory, so with the
 *         factory at the same address on every chain, a collection's pool address is the same everywhere for the same
 *         premium.
 */
contract MiyaPoolFactory {
    bytes4 internal constant ERC721_ID = 0x80ac58cd;
    bytes4 internal constant ERC1155_ID = 0xd9b67a26;

    /// @notice The alignment vault every pool's premium goes to. address(0) on a chain without one: premiums must be 0.
    address public immutable vault;

    mapping(address collection => address pool) public poolOf;
    address[] public allPools;

    event PoolCreated(
        address indexed collection,
        address indexed pool,
        MiyaPool.Kind kind,
        uint16 premiumBps,
        bool randomEnabled,
        address creator
    );

    error PoolExists(address pool);
    error UnsupportedCollection();
    error InvalidVault();

    constructor(address vault_) {
        if (vault_ != address(0) && vault_.code.length == 0) revert InvalidVault();
        vault = vault_;
    }

    /// @notice Create `collection`'s pool with a targeted-redeem premium of `premiumBps` (basis points of one token).
    function createPool(address collection, uint16 premiumBps) external returns (address pool) {
        if (poolOf[collection] != address(0)) revert PoolExists(poolOf[collection]);
        MiyaPool.Kind kind = _detectKind(collection);
        MiyaPool p = new MiyaPool{ salt: _salt(collection) }(collection, kind, premiumBps);
        pool = address(p);
        poolOf[collection] = pool;
        allPools.push(pool);
        emit PoolCreated(collection, pool, kind, premiumBps, p.randomEnabled(), msg.sender);
    }

    /// @notice Address `collection`'s pool has, or will have if created with this kind and premium.
    function predictPool(address collection, MiyaPool.Kind kind, uint16 premiumBps) external view returns (address) {
        bytes32 initHash =
            keccak256(abi.encodePacked(type(MiyaPool).creationCode, abi.encode(collection, kind, premiumBps)));
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), _salt(collection), initHash))))
        );
    }

    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }

    function _salt(address collection) internal pure returns (bytes32) {
        return keccak256(abi.encode(collection));
    }

    function _detectKind(address collection) internal view returns (MiyaPool.Kind) {
        // ERC-165 detection: a contract answering true for everything would otherwise pass as anything.
        if (!_supports(collection, 0x01ffc9a7) || _supports(collection, 0xffffffff)) revert UnsupportedCollection();
        bool is721 = _supports(collection, ERC721_ID);
        bool is1155 = _supports(collection, ERC1155_ID);
        if (is721 == is1155) revert UnsupportedCollection();
        return is721 ? MiyaPool.Kind.ERC721 : MiyaPool.Kind.ERC1155;
    }

    function _supports(address target, bytes4 id) internal view returns (bool) {
        if (target.code.length == 0) return false;
        (bool ok, bytes memory ret) = target.staticcall{ gas: 30_000 }(abi.encodeWithSelector(0x01ffc9a7, id));
        return ok && ret.length >= 32 && abi.decode(ret, (bool));
    }
}
