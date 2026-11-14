// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC1155 } from "solady/tokens/ERC1155.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";
import { PaymentLib } from "../../libraries/PaymentLib.sol";
import { ClaimMode } from "../../interfaces/IAlignmentVault.sol";
import { IInstanceLifecycle, STATE_MINTING } from "../../interfaces/IInstanceLifecycle.sol";
import { IMiyaRegistry } from "../../registry/interfaces/IMiyaRegistry.sol";
import { CurveMath } from "./CurveMath.sol";

/// @dev The factory's per-currency price ceiling (CurveEditionFactory.priceCap).
interface ICurvePriceCaps {
    function priceCap(address token) external view returns (uint256);
}

bytes32 constant TYPE_ERC1155_CURVE = keccak256("erc1155-curve");

/**
 * @title CurveEdition
 * @notice A collection of curve editions (docs/CURVE-EDITIONS.md). Each edition's next copy costs more as its supply
 *         grows, and any copy can be burned back to the edition's reserve at any time for its burn value.
 *
 *         Token ids: copies of edition `e` are id `e << 1`; its master (supply exactly 1, minted to the owner when the
 *         edition is added) is id `(e << 1) | 1`. Whoever holds the master earns the master share and the royalty.
 *
 *         Each copy's price splits into:
 *         - the reserve:  price minus the spread; paid back by burning that copy, never anywhere else
 *         - the spread:   spreadBps of the price, split into
 *           - protocol:   protocolBps of the price (snapshotted from the registry at launch), to the treasury
 *           - vault:      30% of the spread, to the alignment vault as this collection's contribution
 *           - master:     the rest of the spread, credited to the master holder at the moment of the mint (pull)
 *         At a 10% spread and a 1% protocol fee: 90% reserve, 6% master, 3% vault, 1% protocol.
 *
 *         Solvency: an edition's reserve always equals the sum of its copies' burn values (CurveMath), so every copy
 *         can be burned back, down to zero supply. Reserves, master earnings and parked cuts are tracked per token and
 *         nothing but `burn` and the claims pays out of them.
 */
contract CurveEdition is ERC1155, Ownable, ReentrancyGuard, IInstanceLifecycle {
    using PaymentLib for PaymentLib.Ledger;

    /// @notice The vault's share of the spread.
    uint256 public constant VAULT_SHARE_OF_SPREAD_BPS = 3000;
    /// @notice The most copies one mint or burn moves (bounds its gas).
    uint256 public constant MAX_PER_TX = 50;
    /// @notice The highest royalty an edition can ask, on secondary sales, for the master holder.
    uint256 public constant MAX_ROYALTY_BPS = 1000;

    struct EditionParams {
        address currency; // address(0) = ETH, else a registry payment token
        uint8 shape; // CurveMath.EXPONENTIAL or CurveMath.LINEAR
        uint128 startPrice; // price of copy 1, in the currency's units
        uint128 step; // EXPONENTIAL: growth in bps per copy (<= 500); LINEAR: price added per copy
        uint32 maxSupply; // 1 .. 10,000
        uint16 spreadBps; // 500 .. 3000
        uint16 royaltyBps; // 0 .. 1000, paid to the master holder by marketplaces that honour ERC-2981
        string uri; // copies' metadata
        string masterUri; // the master's metadata
    }

    struct Edition {
        address currency;
        uint8 shape;
        uint16 spreadBps;
        uint16 royaltyBps;
        uint32 maxSupply;
        uint32 supply;
        uint128 startPrice;
        uint128 step;
        address master; // current holder of the master token
        uint256 reserve;
        string uri;
        string masterUri;
    }

    error OnlyFactory();
    error InvalidAddress();
    error InvalidName();
    error InvalidCurve();
    error PriceOverCap(uint256 topPrice, uint256 cap);
    error NoSuchEdition();
    error InvalidQuantity();
    error SoldOut();
    error CostTooHigh(uint256 cost);
    error PayoutTooLow(uint256 payout);
    error SupplyMoved(uint256 supply);
    error NothingToClaim();

    event EditionAdded(
        uint256 indexed editionId,
        address indexed currency,
        uint8 shape,
        uint256 startPrice,
        uint256 step,
        uint256 maxSupply,
        uint256 spreadBps,
        uint256 royaltyBps
    );
    event CurveMinted(
        uint256 indexed editionId,
        address indexed to,
        uint256 qty,
        uint256 cost,
        uint256 toReserve,
        uint256 toMaster,
        uint256 toVault,
        uint256 toProtocol
    );
    event CurveBurned(uint256 indexed editionId, address indexed from, uint256 qty, uint256 payout);
    event MasterEarned(uint256 indexed editionId, address indexed holder, address indexed token, uint256 amount);
    event MasterClaimed(address indexed holder, address indexed token, uint256 amount);

    IMiyaRegistry public immutable registry;
    address public immutable factory;
    address public immutable vault;
    address public immutable protocolTreasury;
    uint16 public immutable protocolFeeBps;
    address public immutable weth;

    string public name;
    string public contractURI;

    Edition[] internal _editions;
    /// @notice Master earnings owed to `holder` in `token`.
    mapping(address holder => mapping(address token => uint256)) public masterOwed;
    /// @notice Sums per token of every reserve and of master earnings owed, for the liabilities check.
    mapping(address token => uint256) public reserveTotal;
    mapping(address token => uint256) public masterOwedTotal;

    /// @dev Protocol and vault cuts parked when the treasury or the vault refused (PaymentLib), plus anything the
    ///      owner is owed once a delisted token's parked vault cut is released.
    PaymentLib.Ledger internal _pay;

    constructor(
        string memory name_,
        string memory contractURI_,
        address creator,
        address vault_,
        address registry_,
        address treasury_,
        uint16 protocolFeeBps_,
        address weth_
    ) {
        if (bytes(name_).length == 0) revert InvalidName();
        if (creator == address(0) || vault_ == address(0) || registry_ == address(0) || treasury_ == address(0)) {
            revert InvalidAddress();
        }
        _initializeOwner(creator);
        factory = msg.sender;
        name = name_;
        contractURI = contractURI_;
        vault = vault_;
        registry = IMiyaRegistry(registry_);
        protocolTreasury = treasury_;
        protocolFeeBps = protocolFeeBps_;
        weth = weth_;
        emit StateChanged(STATE_MINTING);
    }

    // ┌─────────────────────────┐
    // │        Editions         │
    // └─────────────────────────┘

    /// @notice Add a curve edition. Its curve is fixed for good. The master token is minted to the owner.
    function addEdition(EditionParams calldata p) external onlyOwner returns (uint256 editionId) {
        _checkCurve(p);
        editionId = _editions.length;
        Edition storage e = _editions.push();
        e.currency = p.currency;
        e.shape = p.shape;
        e.spreadBps = p.spreadBps;
        e.royaltyBps = p.royaltyBps;
        e.maxSupply = p.maxSupply;
        e.startPrice = p.startPrice;
        e.step = p.step;
        e.uri = p.uri;
        e.masterUri = p.masterUri;
        emit EditionAdded(editionId, p.currency, p.shape, p.startPrice, p.step, p.maxSupply, p.spreadBps, p.royaltyBps);
        _mint(msg.sender, masterId(editionId), 1, ""); // sets e.master through _afterTokenTransfer
    }

    function _checkCurve(EditionParams calldata p) internal view {
        PaymentLib.checkAllowed(address(registry), p.currency);
        if (p.startPrice == 0 || p.maxSupply == 0 || p.maxSupply > CurveMath.MAX_SUPPLY) revert InvalidCurve();
        if (p.shape == CurveMath.EXPONENTIAL) {
            if (p.step == 0 || p.step > CurveMath.MAX_GROWTH_BPS) revert InvalidCurve();
        } else if (p.shape != CurveMath.LINEAR) {
            revert InvalidCurve();
        }
        if (p.spreadBps < CurveMath.MIN_SPREAD_BPS || p.spreadBps > CurveMath.MAX_SPREAD_BPS) revert InvalidCurve();
        // The protocol and vault cuts must leave the master a share of the spread.
        if (
            uint256(protocolFeeBps) * CurveMath.BPS + VAULT_SHARE_OF_SPREAD_BPS * p.spreadBps
                >= uint256(p.spreadBps) * CurveMath.BPS
        ) revert InvalidCurve();
        if (p.royaltyBps > MAX_ROYALTY_BPS) revert InvalidCurve();
        uint256 cap = ICurvePriceCaps(factory).priceCap(p.currency);
        uint256 top = CurveMath.price(p.shape, p.startPrice, p.step, p.maxSupply);
        if (cap == 0 || top > cap) revert PriceOverCap(top, cap);
    }

    // ┌─────────────────────────┐
    // │      Mint and burn      │
    // └─────────────────────────┘

    /// @notice Mint `qty` copies of `editionId` at the curve's next prices, paying at most `maxCost` (a guard against
    ///         prices moving before this lands). ETH: msg.value must equal the cost. ERC-20: pulled from an allowance.
    function mint(uint256 editionId, uint256 qty, uint256 maxCost) external payable nonReentrant {
        Edition storage e = _edition(editionId);
        if (qty == 0 || qty > MAX_PER_TX) revert InvalidQuantity();
        uint256 supply = e.supply;
        if (supply + qty > e.maxSupply) revert SoldOut();

        (uint256 cost, uint256 toReserve, uint256 toProtocol) = _quoteMint(e, supply, qty);
        if (cost > maxCost) revert CostTooHigh(cost);
        address token = e.currency;
        PaymentLib.collect(token, cost);

        uint256 spread = cost - toReserve;
        if (toProtocol > spread) toProtocol = spread;
        uint256 toVault = (spread * VAULT_SHARE_OF_SPREAD_BPS) / CurveMath.BPS;
        if (toVault > spread - toProtocol) toVault = spread - toProtocol;
        uint256 toMaster = spread - toProtocol - toVault;

        e.supply = uint32(supply + qty);
        e.reserve += toReserve;
        reserveTotal[token] += toReserve;
        address holder = e.master;
        masterOwed[holder][token] += toMaster;
        masterOwedTotal[token] += toMaster;
        emit MasterEarned(editionId, holder, token, toMaster);

        _pay.payProtocol(protocolTreasury, token, toProtocol);
        uint256 sent = _pay.sendOrPark(vault, token, toVault);
        emit CurveMinted(editionId, msg.sender, qty, cost, toReserve, toMaster, sent, toProtocol);

        _mint(msg.sender, copyId(editionId), qty, "");
    }

    /// @notice Burn `qty` of your copies of `editionId` back to its reserve, highest copies first. Reverts if the
    ///         payout is under `minPayout` or the supply has fallen under `minSupply` (guards against others burning
    ///         first).
    function burn(uint256 editionId, uint256 qty, uint256 minPayout, uint256 minSupply) external nonReentrant {
        Edition storage e = _edition(editionId);
        uint256 supply = e.supply;
        if (qty == 0 || qty > MAX_PER_TX || qty > supply) revert InvalidQuantity();
        if (supply < minSupply) revert SupplyMoved(supply);

        uint256 payout = CurveMath.burnPayout(e.shape, e.startPrice, e.step, e.spreadBps, supply, qty);
        if (payout < minPayout) revert PayoutTooLow(payout);

        e.supply = uint32(supply - qty);
        e.reserve -= payout;
        address token = e.currency;
        reserveTotal[token] -= payout;
        _burn(msg.sender, copyId(editionId), qty);
        emit CurveBurned(editionId, msg.sender, qty, payout);

        PaymentLib.payOut(token, msg.sender, payout, weth);
    }

    /// @notice Pay the caller their master earnings in `token`.
    function claimMasterEarnings(address token) external nonReentrant returns (uint256 amount) {
        amount = masterOwed[msg.sender][token];
        if (amount == 0) revert NothingToClaim();
        masterOwed[msg.sender][token] = 0;
        masterOwedTotal[token] -= amount;
        emit MasterClaimed(msg.sender, token, amount);
        PaymentLib.payOut(token, msg.sender, amount, weth);
    }

    // ┌─────────────────────────┐
    // │      Parked cuts        │
    // └─────────────────────────┘

    /// @notice Retry protocol cuts in `token` the treasury refused. Anyone can call this.
    function flushPendingProtocolCut(address token) external nonReentrant {
        PaymentLib.flushProtocol(_pay, protocolTreasury, token);
    }

    /// @notice Retry vault cuts in `token` the vault refused (e.g. under its minimum), optionally topped up by the
    ///         caller. Anyone can call this. A token the registry has dropped releases its parked cut to the owner.
    function flushPendingVaultCut(address token, uint256 topUp) external payable nonReentrant {
        PaymentLib.flushVault(_pay, address(registry), vault, token, topUp);
    }

    /// @notice Pay the owner what they are owed in `token` (only a released vault cut of a delisted token).
    function withdraw(address token) external onlyOwner nonReentrant {
        if (_pay.payOwner(token, owner(), weth) == 0) revert NothingToClaim();
    }

    /// @notice Claim this collection's vault fees in `mode` and forward them to the owner.
    function claimVaultFees(ClaimMode mode, uint256 minEthOut)
        external
        onlyOwner
        nonReentrant
        returns (uint256 inferOut, uint256 imdOut, uint256 ethOut)
    {
        return PaymentLib.claimVaultFees(vault, mode, minEthOut, owner(), weth, true);
    }

    /// @notice Accept ETH the vault pays out when fees are claimed; claimVaultFees forwards it to the owner.
    receive() external payable { }

    // ┌─────────────────────────┐
    // │          Views          │
    // └─────────────────────────┘

    function copyId(uint256 editionId) public pure returns (uint256) {
        return editionId << 1;
    }

    function masterId(uint256 editionId) public pure returns (uint256) {
        return (editionId << 1) | 1;
    }

    function editionCount() external view returns (uint256) {
        return _editions.length;
    }

    function getEdition(uint256 editionId) external view returns (Edition memory) {
        return _edition(editionId);
    }

    /// @notice Cost of minting the next `qty` copies now.
    function mintQuote(uint256 editionId, uint256 qty) external view returns (uint256 cost) {
        Edition storage e = _edition(editionId);
        if (qty == 0 || e.supply + qty > e.maxSupply) revert InvalidQuantity();
        (cost,,) = _quoteMint(e, e.supply, qty);
    }

    /// @notice What burning the top `qty` copies pays now.
    function burnQuote(uint256 editionId, uint256 qty) external view returns (uint256) {
        Edition storage e = _edition(editionId);
        if (qty == 0 || qty > e.supply) revert InvalidQuantity();
        return CurveMath.burnPayout(e.shape, e.startPrice, e.step, e.spreadBps, e.supply, qty);
    }

    /// @notice Price of copy `n` of `editionId` (1-based), for charts.
    function priceAt(uint256 editionId, uint256 n) external view returns (uint256) {
        Edition storage e = _edition(editionId);
        if (n == 0 || n > e.maxSupply) revert InvalidQuantity();
        return CurveMath.price(e.shape, e.startPrice, e.step, n);
    }

    /// @notice Everything the collection owes in `token`: reserves, master earnings and parked cuts.
    function liabilities(address token) external view returns (uint256) {
        return reserveTotal[token] + masterOwedTotal[token] + _pay.liabilities(token);
    }

    function uri(uint256 id) public view override returns (string memory) {
        Edition storage e = _edition(id >> 1);
        return id & 1 == 1 ? e.masterUri : e.uri;
    }

    /// @notice ERC-2981: royalties on a copy or the master go to the edition's current master holder.
    function royaltyInfo(uint256 id, uint256 salePrice) external view returns (address receiver, uint256 amount) {
        Edition storage e = _edition(id >> 1);
        return (e.master, (salePrice * e.royaltyBps) / CurveMath.BPS);
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == 0x2a55205a // ERC-2981
            || super.supportsInterface(interfaceId);
    }

    function instanceType() external pure override returns (bytes32) {
        return TYPE_ERC1155_CURVE;
    }

    // ┌─────────────────────────┐
    // │        Internals        │
    // └─────────────────────────┘

    function _edition(uint256 editionId) internal view returns (Edition storage) {
        if (editionId >= _editions.length) revert NoSuchEdition();
        return _editions[editionId];
    }

    /// @dev Cost, the reserve's part and the protocol cut (protocolFeeBps of each copy's price) of the next `qty`.
    function _quoteMint(Edition storage e, uint256 supply, uint256 qty)
        internal
        view
        returns (uint256 cost, uint256 toReserve, uint256 toProtocol)
    {
        (uint8 shape, uint256 start, uint256 step, uint256 spread) = (e.shape, e.startPrice, e.step, e.spreadBps);
        for (uint256 i = 1; i <= qty; ++i) {
            uint256 p = CurveMath.price(shape, start, step, supply + i);
            cost += p;
            toReserve += CurveMath.burnValue(p, spread);
            toProtocol += (p * protocolFeeBps) / CurveMath.BPS;
        }
    }

    /// @dev Keep each edition's master holder current, so earnings and royalties follow the master token.
    function _useAfterTokenTransfer() internal pure override returns (bool) {
        return true;
    }

    function _afterTokenTransfer(address, address to, uint256[] memory ids, uint256[] memory amounts, bytes memory)
        internal
        override
    {
        for (uint256 i; i < ids.length; ++i) {
            if (ids[i] & 1 == 1 && amounts[i] != 0) _editions[ids[i] >> 1].master = to;
        }
    }
}
