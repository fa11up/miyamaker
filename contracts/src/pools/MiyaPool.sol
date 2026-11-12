// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "solady/tokens/ERC20.sol";
import { EnumerableSetLib } from "solady/utils/EnumerableSetLib.sol";
import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";

interface IERC721Pool {
    function ownerOf(uint256 id) external view returns (address);
    function transferFrom(address from, address to, uint256 id) external;
    function safeTransferFrom(address from, address to, uint256 id, bytes calldata data) external;
}

interface IERC1155Pool {
    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bytes calldata data
    ) external;
}

/// @dev The pool reads its vault from the factory that deploys it, so a pool's init code (and its CREATE2 address)
///      does not depend on which vault a chain has.
interface IMiyaPoolDeployer {
    function vault() external view returns (address);
}

/// @dev `UniAlignmentVault.receiveContribution(Currency, uint256, address)`: `Currency` is an address in the ABI.
interface IVaultContribution {
    function receiveContribution(address currency, uint256 amount, address benefactor) external payable;
}

/**
 * @title MiyaPool (v2)
 * @notice NFT pool in the style of NFTX v2, one per collection, with both redeem paths. No admin, no pause, no upgrade.
 *         Each NFT (or ERC1155 unit) the pool holds backs exactly 1e18 pool tokens. The accounting invariant is
 *
 *             totalSupply() + premiumReserve + UNIT * pendingUnits == UNIT * heldUnits()
 *
 *         - Deposit: 1 NFT in, 1e18 tokens out.
 *         - Random redeem (ERC721 only, not on Robinhood Chain): burn exactly 1e18 per piece now, receive random ids
 *           later, chosen with the hash of a block mined after the commit. Anyone can reveal, oldest commit first.
 *         - Targeted redeem: burn 1e18 per piece plus the premium, and pick the ids. The premium is a share of 1e18 set
 *           by the pool's creator (at most MAX_PREMIUM_BPS) and fixed forever.
 *
 *         The premium goes to the alignment vault. The vault only takes ETH and registry payment tokens, and pool
 *         tokens are neither, so the pool keeps the premium as `premiumReserve` (tokens burned from the redeemer and
 *         not yet re-minted: still backed by NFTs in the pool) and sells it one whole token (LOT) at a time for ETH in
 *         a falling-price auction (`buyLot`). The ETH goes straight into `vault.receiveContribution` in the same call;
 *         the pool never holds ETH. Selling whole tokens means every lot can be redeemed for a piece right away.
 *
 * @dev Random and targeted redeems on one pool:
 *      - Each commit draws only from ids deposited before it (its queue range), and reveals run in commit order, so
 *        once a target block is mined the pick is fixed: deposits, the reveal order and targeted redeems cannot move it.
 *      - While any commit is pending, the ids it could draw are locked for targeted redeems (`LockedForRandomRedeem`):
 *        every id deposited before the newest pending commit. A targeted redeem therefore can never take an id a
 *        pending commit might get (no sniping once the hash is public, no re-roll by the committer, and a commit's
 *        range never shrinks, so a reveal can't run short). Ids deposited after the newest pending commit stay free.
 *        The lock ends when the commits are revealed, which anyone can do from the block after the target block.
 *      Randomness limitations (documented for the audit):
 *      - The seed is a future block hash; block producers can influence it. Robinhood Chain (4663), whose block hashes
 *        come from its sequencer, gets no random redeems at all (`randomEnabled` is false there).
 *      - A commit not revealed within the block-hash window (256 blocks via BLOCKHASH, 8191 via EIP-2935) is re-armed
 *        to a new future block, which is a re-roll for a committer who waits it out.
 *      - Ordered reveals must not be blockable: the recipient cannot be zero, a commit is capped at MAX_COMMIT_UNITS,
 *        and an id the collection refuses to transfer is escrowed for the recipient.
 *      NFTs sent with plain `transferFrom` (no receiver hook), and pool tokens sent to the pool, are not tracked and
 *      cannot be recovered.
 */
contract MiyaPool is ERC20, ReentrancyGuard {
    using EnumerableSetLib for EnumerableSetLib.Uint256Set;

    enum Kind {
        ERC721,
        ERC1155
    }

    struct Commit {
        address recipient;
        uint64 targetBlock;
        uint32 amount;
        uint32 queueEnd;
    }

    uint256 public constant UNIT = 1e18;
    /// @notice Highest targeted-redeem premium a pool can have: 20% of a token.
    uint16 public constant MAX_PREMIUM_BPS = 2000;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant ROBINHOOD_CHAIN_ID = 4663;

    /// @dev EIP-2935 block-hash history contract, same address on every chain that supports it.
    address internal constant HISTORY = 0x0000F90827F1C53a10cb7A02335B175320002935;
    uint256 internal constant HISTORY_WINDOW = 8191;
    /// @notice Most ids one commit can draw, so a reveal always fits in a block.
    uint256 public constant MAX_COMMIT_UNITS = 50;
    /// @notice Gas each reveal transfer may use: above a standard transfer's cost, and low enough that the largest
    ///         commit fits in one transaction under mainnet's gas cap even if every transfer burns all of it.
    uint256 public constant REVEAL_TRANSFER_GAS = 200_000;

    /// @notice Premium tokens are sold this many at a time (one whole token: one piece).
    uint256 public constant LOT = UNIT;
    /// @notice Where the first lot's price starts.
    uint256 public constant FIRST_LOT_PRICE = 10 ether;
    /// @notice A lot's price never falls below this: the vault's least ETH contribution.
    uint256 public constant MIN_LOT_PRICE = 0.001 ether;
    /// @notice A lot's price halves every LOT_HALF_LIFE while a lot is for sale (linear within each half-life).
    uint256 public constant LOT_HALF_LIFE = 1 days;

    address public immutable factory;
    address public immutable collection;
    Kind public immutable kind;
    /// @notice The alignment vault the premium's ETH goes to (address(0) only when premiumBps is 0).
    address public immutable vault;
    /// @notice Targeted-redeem premium, in basis points of one token. Fixed at creation.
    uint16 public immutable premiumBps;
    /// @notice Random redeems: ERC721 pools, except on Robinhood Chain.
    bool public immutable randomEnabled;

    /// @dev ERC721: ids held. ERC1155: ids with a nonzero held balance.
    EnumerableSetLib.Uint256Set internal _ids;
    /// @dev ERC1155 only: units held per id.
    mapping(uint256 id => uint256 units) public unitsOf;
    /// @dev ERC1155 only: total units held.
    uint256 internal _units1155;

    uint256 public pendingUnits;
    uint256 public nextCommitId;
    mapping(uint256 commitId => Commit) public commits;
    /// @notice The only commit that can be revealed now.
    uint256 public nextRevealId;
    /// @notice Ids the collection refused to transfer at reveal, claimable by their recipient.
    mapping(uint256 id => address recipient) public escrowedTo;

    /// @dev Random pools: every held id, in deposit order. Live entries are [_queueHead, _queueTail). A commit draws
    ///      from [_queueHead, queueEnd), which stays exactly the ids it could draw at commit minus those already drawn:
    ///      reveals swap the picked id with the head, and targeted redeems only take ids at or past the newest pending
    ///      commit's queueEnd (swapping with the tail).
    mapping(uint256 position => uint256 id) internal _queue;
    /// @dev Random pools: queue position + 1 of each held id (0 = not queued).
    mapping(uint256 id => uint256 positionPlusOne) internal _positionOf;
    uint256 internal _queueHead;
    uint256 internal _queueTail;

    /// @notice Premium burned from targeted redeemers and not yet sold (token wei).
    uint256 public premiumReserve;
    /// @notice The current (or next) lot's starting price: FIRST_LOT_PRICE, then twice the last sale.
    uint128 public lotStartPrice;
    /// @notice When the current lot went on sale (the reserve reached LOT, or the previous lot sold).
    uint64 public lotStartTime;

    event Deposited(address indexed from, address indexed to, uint256[] ids, uint256[] amounts);
    event Redeemed(address indexed by, address indexed to, uint256[] ids, uint256[] amounts);
    event PremiumPaid(address indexed by, uint256 amount);
    event RedeemCommitted(
        uint256 indexed commitId, address indexed by, address indexed to, uint256 amount, uint256 targetBlock
    );
    event RedeemRearmed(uint256 indexed commitId, uint256 targetBlock);
    event RedeemRevealed(uint256 indexed commitId, uint256[] ids);
    event RedeemEscrowed(uint256 indexed commitId, address indexed recipient, uint256 id);
    event EscrowClaimed(address indexed recipient, address indexed to, uint256 id);
    event LotSold(address indexed buyer, address indexed to, address indexed benefactor, uint256 price);

    error NotCollection();
    error RandomUnavailable();
    error EmptyRequest();
    error LengthMismatch();
    error NotHeld(uint256 id);
    error InsufficientHeld();
    error TooEarly();
    error UnknownCommit();
    error NotNextCommit();
    error CommitTooLarge();
    error InvalidRecipient();
    error NotEscrowed();
    error AlreadyHeld(uint256 id);
    error RevealGasTooLow();
    error TransferNotReceived(uint256 id);
    error LockedForRandomRedeem(uint256 id);
    error PremiumTooHigh();
    error NoVault();
    error NoLot();
    error PriceNotMet(uint256 price);

    constructor(address _collection, Kind _kind, uint16 _premiumBps) {
        if (_premiumBps > MAX_PREMIUM_BPS) revert PremiumTooHigh();
        address v = IMiyaPoolDeployer(msg.sender).vault();
        if (_premiumBps != 0 && v.code.length == 0) revert NoVault();
        factory = msg.sender;
        collection = _collection;
        kind = _kind;
        vault = v;
        premiumBps = _premiumBps;
        // Robinhood Chain's block hashes come from its sequencer, so a random draw there could be steered.
        randomEnabled = _kind == Kind.ERC721 && block.chainid != ROBINHOOD_CHAIN_ID;
        lotStartPrice = uint128(FIRST_LOT_PRICE);
    }

    // ┌─────────────────────────┐
    // │        Metadata         │
    // └─────────────────────────┘

    function name() public view override returns (string memory) {
        return string.concat("miya pool: ", _collectionString(0x06fdde03, "NFT"));
    }

    function symbol() public view override returns (string memory) {
        return string.concat("m", _collectionString(0x95d89b41, "NFT"));
    }

    /// @notice Units currently backing tokens, the premium reserve or pending commits.
    function heldUnits() public view returns (uint256) {
        return kind == Kind.ERC721 ? _ids.length() : _units1155;
    }

    /// @notice Ids currently held (ERC1155: ids with a nonzero balance). Paginate with `heldIdsCount`.
    function heldIds(uint256 start, uint256 count) external view returns (uint256[] memory ids) {
        uint256 len = _ids.length();
        if (start >= len) return ids;
        if (count > len - start) count = len - start;
        ids = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            ids[i] = _ids.at(start + i);
        }
    }

    function heldIdsCount() external view returns (uint256) {
        return _ids.length();
    }

    function isHeld(uint256 id) external view returns (bool) {
        return _ids.contains(id);
    }

    /// @notice Pool tokens a targeted redeem burns per piece, on top of the UNIT.
    function premiumPerUnit() public view returns (uint256) {
        return UNIT * premiumBps / BPS;
    }

    /// @notice Pool tokens a targeted redeem of `units` pieces burns in all (UNIT + premium each).
    function targetedCost(uint256 units) external view returns (uint256) {
        return units * (UNIT + premiumPerUnit());
    }

    /// @notice True while a pending random redeem could draw `id`, so a targeted redeem of it would revert.
    function isLocked(uint256 id) external view returns (bool) {
        uint256 pos = _positionOf[id];
        return pos != 0 && pos - 1 < _lockedEnd();
    }

    /// @notice Queue positions [0, end) are locked for targeted redeems (0 when no commit is pending).
    function lockedEnd() external view returns (uint256) {
        return _lockedEnd();
    }

    /// @notice Live queue range [head, tail) of a random pool (tail - head == heldUnits()).
    function queueBounds() external view returns (uint256 head, uint256 tail) {
        return (_queueHead, _queueTail);
    }

    /// @notice Queue position of a held id in a random pool (reverts if it isn't queued).
    function queuePositionOf(uint256 id) external view returns (uint256) {
        uint256 pos = _positionOf[id];
        if (pos == 0) revert NotHeld(id);
        return pos - 1;
    }

    /// @notice True when a whole lot of premium tokens is for sale.
    function lotAvailable() external view returns (bool) {
        return premiumReserve >= LOT;
    }

    /// @notice What a lot costs now in ETH (if none is for sale: what the next one will start at).
    function lotPrice() public view returns (uint256) {
        if (premiumReserve < LOT) return _floorPrice(lotStartPrice);
        uint256 elapsed = block.timestamp - lotStartTime;
        uint256 halvings = elapsed / LOT_HALF_LIFE;
        if (halvings >= 128) return MIN_LOT_PRICE;
        uint256 p = uint256(lotStartPrice) >> halvings;
        p -= p * (elapsed % LOT_HALF_LIFE) / (2 * LOT_HALF_LIFE);
        return _floorPrice(p);
    }

    // ┌─────────────────────────┐
    // │        Deposits         │
    // └─────────────────────────┘

    /// @notice Pull NFTs from the caller (approval required) and mint UNIT tokens per unit to `to`.
    /// @dev Minting happens in the receiver hooks, so direct `safeTransferFrom` deposits work the same way.
    function deposit(uint256[] calldata ids, uint256[] calldata amounts, address to) external nonReentrant {
        if (ids.length == 0) revert EmptyRequest();
        bytes memory data = abi.encode(to);
        if (kind == Kind.ERC721) {
            for (uint256 i; i < ids.length; ++i) {
                IERC721Pool(collection).safeTransferFrom(msg.sender, address(this), ids[i], data);
            }
        } else {
            if (amounts.length != ids.length) revert LengthMismatch();
            IERC1155Pool(collection).safeBatchTransferFrom(msg.sender, address(this), ids, amounts, data);
        }
    }

    function onERC721Received(address, address from, uint256 id, bytes calldata data) external returns (bytes4) {
        if (msg.sender != collection || kind != Kind.ERC721) revert NotCollection();
        if (IERC721Pool(collection).ownerOf(id) != address(this)) revert TransferNotReceived(id);
        // An escrowed id is still in custody but owed to its recipient: it must not back new tokens.
        if (escrowedTo[id] != address(0) || !_ids.add(id)) revert AlreadyHeld(id);
        if (randomEnabled) {
            uint256 tail = _queueTail;
            _queue[tail] = id;
            _positionOf[id] = tail + 1;
            _queueTail = tail + 1;
        }
        address to = _recipient(from, data);
        _mint(to, UNIT);
        uint256[] memory ids = new uint256[](1);
        uint256[] memory amounts = new uint256[](1);
        ids[0] = id;
        amounts[0] = 1;
        emit Deposited(from, to, ids, amounts);
        return this.onERC721Received.selector;
    }

    function onERC1155Received(address, address from, uint256 id, uint256 amount, bytes calldata data)
        external
        returns (bytes4)
    {
        uint256[] memory ids = new uint256[](1);
        uint256[] memory amounts = new uint256[](1);
        ids[0] = id;
        amounts[0] = amount;
        _receive1155(from, ids, amounts, data);
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address from,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bytes calldata data
    ) external returns (bytes4) {
        _receive1155(from, ids, amounts, data);
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 // ERC165
            || id == 0x150b7a02 // ERC721Receiver
            || id == 0x4e2312e0; // ERC1155Receiver
    }

    // ┌─────────────────────────┐
    // │    Targeted redeems     │
    // └─────────────────────────┘

    /// @notice Burn UNIT + the premium per unit and withdraw the chosen ids to `to`.
    /// @dev ERC721 in a random pool: reverts with `LockedForRandomRedeem` for an id a pending commit could draw.
    function redeem(uint256[] calldata ids, uint256[] calldata amounts, address to) external nonReentrant {
        if (to == address(this)) revert InvalidRecipient();
        if (ids.length == 0) revert EmptyRequest();
        if (kind == Kind.ERC721) {
            _payTargeted(ids.length);
            uint256 locked = randomEnabled ? _lockedEnd() : 0;
            for (uint256 i; i < ids.length; ++i) {
                if (!_ids.remove(ids[i])) revert NotHeld(ids[i]);
                if (randomEnabled) _dequeue(ids[i], locked);
            }
            uint256[] memory ones = new uint256[](ids.length);
            for (uint256 i; i < ids.length; ++i) {
                ones[i] = 1;
                IERC721Pool(collection).transferFrom(address(this), to, ids[i]);
            }
            emit Redeemed(msg.sender, to, ids, ones);
        } else {
            if (amounts.length != ids.length) revert LengthMismatch();
            uint256 total;
            for (uint256 i; i < ids.length; ++i) {
                uint256 have = unitsOf[ids[i]];
                if (amounts[i] == 0 || have < amounts[i]) revert NotHeld(ids[i]);
                unchecked {
                    unitsOf[ids[i]] = have - amounts[i];
                }
                if (have == amounts[i]) _ids.remove(ids[i]);
                total += amounts[i];
            }
            _units1155 -= total;
            _payTargeted(total);
            IERC1155Pool(collection).safeBatchTransferFrom(address(this), to, ids, amounts, "");
            emit Redeemed(msg.sender, to, ids, amounts);
        }
    }

    // ┌─────────────────────────┐
    // │     Random redeems      │
    // └─────────────────────────┘

    /// @notice Burn `amount` * UNIT tokens now (no premium); `amount` random ids go to `to` once revealed.
    function commitRedeem(uint256 amount, address to) external nonReentrant returns (uint256 commitId) {
        if (!randomEnabled) revert RandomUnavailable();
        if (amount == 0) revert EmptyRequest();
        if (amount > MAX_COMMIT_UNITS) revert CommitTooLarge();
        if (to == address(0) || to == address(this)) revert InvalidRecipient();
        if (_ids.length() < pendingUnits + amount) revert InsufficientHeld();
        _burn(msg.sender, UNIT * amount);
        pendingUnits += amount;
        commitId = nextCommitId++;
        uint256 target = block.number + 1;
        commits[commitId] = Commit(to, uint64(target), uint32(amount), uint32(_queueTail));
        emit RedeemCommitted(commitId, msg.sender, to, amount, target);
    }

    /// @notice Settle the oldest unsettled commit. Callable by anyone once its target block is mined.
    function revealRedeem(uint256 commitId) external nonReentrant {
        Commit memory c = commits[commitId];
        if (c.amount == 0) revert UnknownCommit();
        if (commitId != nextRevealId) revert NotNextCommit();
        if (block.number <= c.targetBlock) revert TooEarly();
        bytes32 seed = _blockHash(c.targetBlock);
        if (seed == bytes32(0)) {
            uint256 target = block.number + 1;
            commits[commitId].targetBlock = uint64(target);
            emit RedeemRearmed(commitId, target);
            return;
        }
        delete commits[commitId];
        nextRevealId = commitId + 1;
        pendingUnits -= c.amount;

        uint256[] memory picked = new uint256[](c.amount);
        uint256 head = _queueHead;
        for (uint256 i; i < c.amount; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, address(this), commitId, i)));
            uint256 pos = head + r % (c.queueEnd - head);
            uint256 id = _queue[pos];
            if (pos != head) {
                uint256 headId = _queue[head];
                _queue[pos] = headId;
                _positionOf[headId] = pos + 1;
            }
            delete _queue[head];
            delete _positionOf[id];
            ++head;
            _ids.remove(id);
            picked[i] = id;
        }
        _queueHead = head;
        for (uint256 i; i < picked.length; ++i) {
            // Capped so a recipient the collection calls can't burn the gas the rest of the reveal needs. The check
            // stops a revealer sending too little gas to force an id into escrow.
            if (gasleft() < REVEAL_TRANSFER_GAS + REVEAL_TRANSFER_GAS / 32) revert RevealGasTooLow();
            try IERC721Pool(collection).transferFrom{ gas: REVEAL_TRANSFER_GAS }(
                address(this), c.recipient, picked[i]
            ) { }
            catch {
                escrowedTo[picked[i]] = c.recipient;
                emit RedeemEscrowed(commitId, c.recipient, picked[i]);
            }
        }
        emit RedeemRevealed(commitId, picked);
    }

    /// @notice Take an id the collection refused to send to the caller at reveal, to any address.
    function claimEscrowed(uint256 id, address to) external nonReentrant {
        if (escrowedTo[id] != msg.sender) revert NotEscrowed();
        if (to == address(this)) revert InvalidRecipient();
        delete escrowedTo[id];
        IERC721Pool(collection).transferFrom(address(this), to, id);
        emit EscrowClaimed(msg.sender, to, id);
    }

    // ┌─────────────────────────┐
    // │      Premium lots       │
    // └─────────────────────────┘

    /// @notice Buy one whole pool token from the premium reserve at `lotPrice()`, paid in ETH that goes straight to
    ///         the alignment vault as a contribution for `benefactor` (the vault's shares in it are theirs). Send at
    ///         least the price you saw: the price only falls, and anything above the price at inclusion is refunded.
    function buyLot(address to, address benefactor) external payable nonReentrant returns (uint256 price) {
        if (to == address(0) || to == address(this) || benefactor == address(0)) revert InvalidRecipient();
        if (premiumReserve < LOT) revert NoLot();
        price = lotPrice();
        if (msg.value < price) revert PriceNotMet(price);
        premiumReserve -= LOT;
        uint256 next = price * 2;
        lotStartPrice = uint128(next > type(uint128).max ? type(uint128).max : next);
        lotStartTime = uint64(block.timestamp);
        _mint(to, LOT);
        IVaultContribution(vault).receiveContribution{ value: price }(address(0), price, benefactor);
        emit LotSold(msg.sender, to, benefactor, price);
        if (msg.value > price) SafeTransferLib.safeTransferETH(msg.sender, msg.value - price);
    }

    // ┌─────────────────────────┐
    // │        Internals        │
    // └─────────────────────────┘

    /// @dev Burns UNIT + the premium per unit from the caller; the premium joins the reserve.
    function _payTargeted(uint256 units) internal {
        uint256 premium = units * premiumPerUnit();
        _burn(msg.sender, units * UNIT + premium);
        if (premium == 0) return;
        uint256 before = premiumReserve;
        premiumReserve = before + premium;
        // A lot goes on sale (its price starts falling) only once a whole token has built up.
        if (before < LOT && before + premium >= LOT) lotStartTime = uint64(block.timestamp);
        emit PremiumPaid(msg.sender, premium);
    }

    /// @dev Positions [0, end) are locked: the newest pending commit's range (each older one's is a prefix of it).
    function _lockedEnd() internal view returns (uint256) {
        uint256 next = nextCommitId;
        return nextRevealId == next ? 0 : commits[next - 1].queueEnd;
    }

    /// @dev Takes a targeted id out of the queue by swapping it with the tail. Both are past `locked`, so no pending
    ///      commit's range changes.
    function _dequeue(uint256 id, uint256 locked) internal {
        uint256 pos = _positionOf[id] - 1;
        if (pos < locked) revert LockedForRandomRedeem(id);
        uint256 last = _queueTail - 1;
        if (pos != last) {
            uint256 moved = _queue[last];
            _queue[pos] = moved;
            _positionOf[moved] = pos + 1;
        }
        delete _queue[last];
        delete _positionOf[id];
        _queueTail = last;
    }

    function _receive1155(address from, uint256[] memory ids, uint256[] memory amounts, bytes calldata data) internal {
        if (msg.sender != collection || kind != Kind.ERC1155) revert NotCollection();
        if (ids.length != amounts.length) revert LengthMismatch();
        uint256 total;
        for (uint256 i; i < ids.length; ++i) {
            if (amounts[i] == 0) continue;
            unitsOf[ids[i]] += amounts[i];
            _ids.add(ids[i]);
            total += amounts[i];
        }
        _units1155 += total;
        address to = _recipient(from, data);
        if (total != 0) _mint(to, UNIT * total);
        emit Deposited(from, to, ids, amounts);
    }

    function _recipient(address from, bytes calldata data) internal view returns (address to) {
        if (data.length == 32) to = abi.decode(data, (address));
        if (to == address(0)) to = from;
        // address(0): a safe mint straight into the pool. address(this): a transfer from the pool to itself.
        if (to == address(0) || to == address(this)) revert InvalidRecipient();
    }

    function _floorPrice(uint256 p) internal pure returns (uint256) {
        return p < MIN_LOT_PRICE ? MIN_LOT_PRICE : p;
    }

    function _blockHash(uint256 n) internal view returns (bytes32 h) {
        if (block.number - n <= 256) return blockhash(n);
        if (block.number - n > HISTORY_WINDOW || HISTORY.code.length == 0) return bytes32(0);
        (bool ok, bytes memory ret) = HISTORY.staticcall(abi.encode(n));
        if (ok && ret.length == 32) h = abi.decode(ret, (bytes32));
    }

    function _collectionString(bytes4 selector, string memory fallback_) internal view returns (string memory) {
        (bool ok, bytes memory ret) = collection.staticcall(abi.encodeWithSelector(selector));
        if (!ok || ret.length < 64) return fallback_;
        return abi.decode(ret, (string));
    }
}
