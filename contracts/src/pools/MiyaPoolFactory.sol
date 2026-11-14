// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { MiyaPool } from "./MiyaPool.sol";

interface IVaultTokens {
    function imd() external view returns (address);
    function infer() external view returns (address);
}

/**
 * @title MiyaPoolFactory (v2)
 * @notice Permissionless, ownerless factory for MiyaPool. One pool per collection, with both redeem paths (random
 *         redeems only where `MiyaPool.randomEnabled`). Whoever creates a collection's pool sets its pick fee per piece
 *         in IMD and in INFER (0 = not offered; both 0 = free picks), fixed forever; each offered fee must be at least
 *         the vault's minimum contribution for that token. Pick fees go to `vault` as the picker's contribution.
 *         Pools deploy with CREATE2 from (collection, kind, fees) and read the vault and its tokens from this factory,
 *         so with the factory at the same address on every chain, a collection's pool address is the same everywhere
 *         for the same fees.
 */
contract MiyaPoolFactory {
    bytes4 internal constant ERC721_ID = 0x80ac58cd;
    bytes4 internal constant ERC1155_ID = 0xd9b67a26;

    /// @notice The alignment vault every pool's pick fees go to. address(0) on a chain without one: picks are free.
    address public immutable vault;

    mapping(address collection => address pool) public poolOf;
    address[] public allPools;

    event PoolCreated(
        address indexed collection,
        address indexed pool,
        MiyaPool.Kind kind,
        uint256 imdFee,
        uint256 inferFee,
        bool randomEnabled,
        address creator
    );

    error PoolExists(address pool);
    error UnsupportedCollection();

    /// @dev Stores the vault only. The launch's deployment rehearsal runs this constructor on an empty chain where the
    ///      vault has no code, so nothing may be read from it here: `imd()` / `infer()` read the live vault when a pool
    ///      is created, and `MiyaPool`'s constructor requires vault code and a registered fee token for any nonzero fee.
    constructor(address vault_) {
        vault = vault_;
    }

    /// @notice The vault's IMD, the first token pick fees can be paid in (address(0) without a vault).
    function imd() public view returns (address) {
        return _vaultToken(IVaultTokens.imd.selector);
    }

    /// @notice The vault's INFER, the second token pick fees can be paid in (address(0) without a vault).
    function infer() public view returns (address) {
        return _vaultToken(IVaultTokens.infer.selector);
    }

    /// @notice Create `collection`'s pool with a pick fee per piece of `imdFee` IMD and/or `inferFee` INFER (token wei;
    ///         0 = not offered in that token; both 0 = free picks). Fixed forever.
    function createPool(address collection, uint256 imdFee, uint256 inferFee) external returns (address pool) {
        if (poolOf[collection] != address(0)) revert PoolExists(poolOf[collection]);
        MiyaPool.Kind kind = _detectKind(collection);
        MiyaPool p = new MiyaPool{ salt: _salt(collection) }(collection, kind, imdFee, inferFee);
        pool = address(p);
        poolOf[collection] = pool;
        allPools.push(pool);
        emit PoolCreated(collection, pool, kind, imdFee, inferFee, p.randomEnabled(), msg.sender);
    }

    /// @notice Address `collection`'s pool has, or will have if created with this kind and these fees.
    function predictPool(address collection, MiyaPool.Kind kind, uint256 imdFee, uint256 inferFee)
        external
        view
        returns (address)
    {
        // bytes.concat: the same init code `new MiyaPool{salt}(...)` hashes, without packing two dynamic values.
        bytes32 initHash =
            keccak256(bytes.concat(type(MiyaPool).creationCode, abi.encode(collection, kind, imdFee, inferFee)));
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

    /// @dev `vault.imd()` / `vault.infer()`, read live; address(0) without a vault, where the vault has no code, or
    ///      where it does not answer with an address.
    function _vaultToken(bytes4 selector) internal view returns (address) {
        address v = vault;
        if (v.code.length == 0) return address(0);
        (bool ok, bytes memory ret) = v.staticcall(abi.encodeWithSelector(selector));
        if (!ok || ret.length != 32) return address(0);
        uint256 word = abi.decode(ret, (uint256));
        return word > type(uint160).max ? address(0) : address(uint160(word));
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
