// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {Ownable} from "solady/auth/Ownable.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "v4-core/types/BalanceDelta.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {CurrencySettler} from "../../libraries/v4/CurrencySettler.sol";
import {LiquidityAmounts} from "../../libraries/v4/LiquidityAmounts.sol";
import {IAlignmentVault, ClaimMode} from "../../interfaces/IAlignmentVault.sol";
import {IMiyaRegistry} from "../../registry/interfaces/IMiyaRegistry.sol";
import {IVaultRoutes, IzRouter, RouteHop, HOP_V3, HOP_V4} from "./IVaultRoutes.sol";

/**
 * @title UniAlignmentVault (v2: multi-token, aligned to the INFER/IMD pool)
 * @notice Collections send their vault share in the token paid (ETH or a registry-allowlisted ERC-20). The keeper converts
 *         each batch: every token to IMD along the owner-set route (zRouter, v3/v4 hookless hops), the balanced part of the
 *         IMD to INFER in the hooked INFER/IMD pool (vault-side, through PoolManager.unlock), then INFER + IMD as one
 *         full-range position. Shares (= liquidity units) go to each benefactor in proportion to the IMD value its
 *         contribution realized in that batch. The position's INFER and IMD fees (1% to the protocol) are paid to shares,
 *         as tokens, as ETH, or reinvested. Shares are never redeemable for liquidity. Spec: docs/IMD-INFER-VAULT.md.
 * @dev Clone (EIP-1167), initialized once by the factory, which owns it. Keeps v1's hardening:
 *      - batches close in O(tokens) whatever the number of contributors; each benefactor collects its shares lazily;
 *      - per-share fee indexes with checkpoints (each payout rounds down once), fees booked before every share change;
 *      - conversions are keeper-only (registry.conversionKeeper) with the keeper's floors as the price protection;
 *      - the keeper reward comes out of the batch's ETH only (0.0012 ETH, capped at 1% of it);
 *      - receive() ignores ETH the vault pulls in itself (transient flag), everything nonReentrant;
 *      - nothing owed is ever spent: conversions work only from balances beyond what is owed, checked at the end.
 */
contract UniAlignmentVault is ReentrancyGuard, Ownable, IUnlockCallback, IAlignmentVault {
    using CurrencyLibrary for Currency;
    using BalanceDeltaLibrary for BalanceDelta;
    using CurrencySettler for Currency;
    using PoolIdLibrary for PoolKey;

    // ========== Errors ==========

    error InvalidAddress();
    error TargetNotActive();
    error TokenNotInTarget();
    error InvalidPoolKey();
    error AmountMustBePositive();
    error AmountMismatch();
    error ContributionBelowMinimum();
    error TokenNotAllowed(address token);
    error NoRoute(address token);
    error BadRoute(address token);
    error TooManyTokens();
    error ReceivedLess();
    error NothingPending();
    error BadParams();
    error Expired();
    error InsufficientOutput();
    error InsufficientLiquidity();
    error PoolNotInitialized();
    error NoShares();
    error NoFeesToClaim();
    error ZeroFloor();
    error NotBenefactor();
    error NotDelegate();
    error TreasuryNotSet();
    error TransferFailed();
    error NotKeeper();
    error Insolvent(address token);
    error UnknownFeeToken();

    // ========== Constants ==========

    address internal constant ETH = address(0);
    /// @notice Least ETH a contribution can carry (ERC-20 contributions only need to be non-zero).
    uint256 public constant MIN_CONTRIBUTION = 0.001 ether;
    /// @notice Most distinct tokens one batch (and one benefactor's pending batch) can hold.
    uint256 public constant MAX_BATCH_TOKENS = 16;
    uint256 public constant MAX_ROUTE_HOPS = 4;
    /// @notice Flat keeper reward, paid from the batch's pending ETH only, capped at MAX_CONVERSION_REWARD_BPS of it.
    uint256 public constant CONVERSION_REWARD = 0.0012 ether;
    uint256 public constant MAX_CONVERSION_REWARD_BPS = 100;
    uint256 public constant PROTOCOL_YIELD_CUT_BPS = 100;
    uint256 public constant FEE_COLLECTION_INTERVAL = 1 days;

    uint256 internal constant ACC_PRECISION = 1e36;
    uint256 private constant Q96 = 1 << 96;
    uint256 private constant MAX_LP_PASSES = 3;
    uint256 private constant LP_PASS_MIN_DIVISOR = 200; // a later pass needs 0.5% of the starting excess to swap

    /// @dev Fee token slots: the position earns INFER and IMD; ETH is dust (rejected rewards, router refunds, strays).
    uint256 internal constant I_INFER = 0;
    uint256 internal constant I_IMD = 1;
    uint256 internal constant I_ETH = 2;

    uint8 private constant ACTION_MODIFY = 1;
    uint8 private constant ACTION_SWAP = 2;

    /// @dev Set while the vault pulls ETH in itself (zRouter outputs and refunds), so receive() does not book it as a
    ///      contribution. = keccak256("miyamaker.UniAlignmentVault.collecting")
    uint256 private constant _COLLECTING_SLOT = 0x9fffd68a8e82dadd8810fe84758545b0fb4c40f84b514ef129e417c2e244d1a1;

    // ========== Config (set once at initialize) ==========

    IPoolManager public poolManager;
    address public zRouter;
    IMiyaRegistry public registry;
    IVaultRoutes public routes;
    address public infer;
    address public imd;
    uint256 public alignmentTargetId;
    PoolKey internal _poolKey;
    bool internal _inferIsCurrency0;
    int24 public tickLower;
    int24 public tickUpper;
    bool private _initialized;

    // ========== Shares and fees ==========

    uint256 public totalShares;
    uint256 public totalLPUnits;
    uint256 public totalUniqueBenefactors;
    uint256 public lastFeeCollectionTime;

    /// @dev Per fee token (I_INFER, I_IMD, I_ETH). A benefactor is owed, per token,
    ///      settled + shares * (accPerShare - checkpoint) / ACC_PRECISION; held owed = distributed - claimed + protocol.
    uint256[3] internal _accPerShare;
    uint256[3] internal _distributed;
    uint256[3] internal _claimed;
    uint256[3] internal _protocolFees;

    mapping(address => uint256) internal _shares;
    mapping(address => uint256[3]) internal _checkpoint;
    mapping(address => uint256[3]) internal _settled;
    mapping(address => address) public benefactorDelegate;
    mapping(address => bool) public isBenefactor;
    /// @notice Lifetime contributions per benefactor per token (bragging rights; never decreases).
    mapping(address => mapping(address => uint256)) public contributionOf;

    // ========== Batches ==========
    // The open batch is closedBatches + 1. Closing one records, per token, the shares per unit contributed and the fee
    // indexes the new shares earn from; each benefactor collects its shares the next time it is touched.

    uint256 public closedBatches;
    mapping(uint256 batchId => mapping(address token => uint256)) public batchSharesPerUnit; // ACC_PRECISION scale
    mapping(uint256 batchId => uint256[3]) internal _batchAcc;
    address[] internal _openTokens;
    /// @notice Contributions per token in the open batch.
    mapping(address => uint256) public pendingByToken;
    mapping(address => uint256) internal _pendingBatch;
    mapping(address => address[]) internal _benefactorTokens;
    mapping(address => mapping(address => uint256)) internal _pending;

    // ========== Keeper call ==========

    /// @param tokens Exactly openBatchTokens(), in that order.
    /// @param minOuts Per token, one floor per route hop (the last is the IMD out); empty for IMD and INFER.
    /// @param minSplitOut Floor on the INFER/IMD balancing swap's total output (non-zero if a swap happens).
    /// @param deadline Last timestamp the call may land.
    struct ConvertParams {
        address[] tokens;
        uint256[][] minOuts;
        uint256 minSplitOut;
        uint256 deadline;
    }

    // ========== Events ==========

    event BatchConverted(
        uint256 indexed batchId, uint256 sharesIssued, uint256 inferAdded, uint256 imdAdded, uint256 callerReward
    );
    event TokenConverted(uint256 indexed batchId, address indexed token, uint256 amountIn, uint256 imdValue);
    event SplitSwap(bool inferToImd, uint256 amountIn, uint256 amountOut);
    event Reinvested(address indexed benefactor, uint256 inferIn, uint256 imdIn, uint256 sharesIssued);
    event ConversionRewardPaid(address indexed caller, uint256 reward);
    event ConversionRewardRejected(address indexed caller, uint256 rewardAmount);
    event ProtocolYieldCollected(address indexed token, uint256 amount);
    event ProtocolFeesWithdrawn(address indexed token, uint256 amount);
    event BenefactorDelegateSet(address indexed benefactor, address indexed delegate);

    modifier onlyKeeper() {
        if (msg.sender != registry.conversionKeeper()) revert NotKeeper();
        _;
    }

    // ========== Initialize ==========

    /// @notice Spends this contract's one initialization, so the implementation behind the clones can't be claimed.
    function disableInitializer() external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
    }

    /// @param key_ The INFER/IMD pool. Its hook may only have initialize permissions (no swap, liquidity or delta
    ///        hooks), and its fee must be static.
    function initialize(
        address owner_,
        IPoolManager poolManager_,
        address zRouter_,
        IMiyaRegistry registry_,
        IVaultRoutes routes_,
        address infer_,
        address imd_,
        PoolKey calldata key_,
        uint256 alignmentTargetId_
    ) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        _initializeOwner(owner_);

        if (
            address(poolManager_) == address(0) || zRouter_ == address(0) || address(registry_) == address(0)
                || address(routes_) == address(0) || infer_ == address(0) || imd_ == address(0) || infer_ == imd_
        ) revert InvalidAddress();
        if (!registry_.isAlignmentTargetActive(alignmentTargetId_)) revert TargetNotActive();
        if (!registry_.isTokenInTarget(alignmentTargetId_, infer_)) revert TokenNotInTarget();
        _validatePoolKey(key_, infer_, imd_);

        poolManager = poolManager_;
        zRouter = zRouter_;
        registry = registry_;
        routes = routes_;
        infer = infer_;
        imd = imd_;
        alignmentTargetId = alignmentTargetId_;
        _poolKey = key_;
        _inferIsCurrency0 = Currency.unwrap(key_.currency0) == infer_;
        tickLower = TickMath.minUsableTick(key_.tickSpacing);
        tickUpper = TickMath.maxUsableTick(key_.tickSpacing);
    }

    function _validatePoolKey(PoolKey calldata key, address infer_, address imd_) internal pure {
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        bool pair = (c0 == infer_ && c1 == imd_) || (c0 == imd_ && c1 == infer_);
        if (!pair || c0 >= c1) revert InvalidPoolKey();
        if (key.fee >= 1_000_000 || key.tickSpacing <= 0) revert InvalidPoolKey(); // static fee only
        // A hook that can act on swaps or liquidity could reprice, block or take a cut of every vault operation.
        uint160 perms = uint160(address(key.hooks)) & Hooks.ALL_HOOK_MASK;
        if (perms & ~(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG) != 0) revert InvalidPoolKey();
    }

    // ========== Contributions ==========

    receive() external payable override {
        if (_isCollecting()) return;
        _receiveDirect();
    }

    function _receiveDirect() private nonReentrant {
        if (msg.value == 0) revert AmountMustBePositive();
        _book(msg.sender, ETH, msg.value);
    }

    /// @inheritdoc IAlignmentVault
    function receiveContribution(Currency currency, uint256 amount, address benefactor)
        external
        payable
        override
        nonReentrant
    {
        if (amount == 0) revert AmountMustBePositive();
        if (benefactor == address(0)) revert InvalidAddress();
        address token = Currency.unwrap(currency);
        if (token == ETH) {
            if (msg.value != amount) revert AmountMismatch();
        } else {
            if (msg.value != 0) revert AmountMismatch();
            if (!registry.isPaymentToken(token)) revert TokenNotAllowed(token);
            if (token != imd && token != infer && !routes.hasRoute(token)) revert NoRoute(token);
            uint256 before = SafeTransferLib.balanceOf(token, address(this));
            SafeTransferLib.safeTransferFrom(token, msg.sender, address(this), amount);
            if (SafeTransferLib.balanceOf(token, address(this)) - before != amount) revert ReceivedLess();
        }
        _book(benefactor, token, amount);
    }

    function _book(address benefactor, address token, uint256 amount) internal {
        if (token == ETH && amount < MIN_CONTRIBUTION) revert ContributionBelowMinimum();
        _settle(benefactor); // collects a converted batch of theirs first, so they are only ever in one
        _pendingBatch[benefactor] = closedBatches + 1;
        if (_pending[benefactor][token] == 0) {
            if (_benefactorTokens[benefactor].length >= MAX_BATCH_TOKENS) revert TooManyTokens();
            _benefactorTokens[benefactor].push(token);
        }
        _pending[benefactor][token] += amount;
        if (pendingByToken[token] == 0) {
            if (_openTokens.length >= MAX_BATCH_TOKENS) revert TooManyTokens();
            _openTokens.push(token);
        }
        pendingByToken[token] += amount;
        if (!isBenefactor[benefactor]) {
            isBenefactor[benefactor] = true;
            ++totalUniqueBenefactors;
        }
        contributionOf[benefactor][token] += amount;
        emit ContributionReceived(benefactor, token, amount);
    }

    // ========== Conversion ==========

    /// @notice Convert the open batch into INFER/IMD liquidity and issue its shares. Keeper only.
    /// @dev The keeper quotes every hop, simulates, and sends through a private mempool: its floors are the only price
    ///      protection (no on-chain reference exists for these pools).
    // slither-disable-next-line reentrancy-benign,reentrancy-eth
    function convertAndAddLiquidity(ConvertParams calldata p)
        external
        nonReentrant
        onlyKeeper
        returns (uint256 sharesIssued)
    {
        if (block.timestamp > p.deadline) revert Expired();
        uint256 n = _openTokens.length;
        if (n == 0) revert NothingPending();
        if (p.tokens.length != n || p.minOuts.length != n) revert BadParams();

        // Yield earned so far belongs to current holders: book it before any share change.
        _collectFees();

        uint256 reward = _conversionReward(pendingByToken[ETH]);
        uint256[] memory amounts = new uint256[](n);
        uint256[] memory values = new uint256[](n);
        uint256 inferSlot = type(uint256).max;
        for (uint256 i; i < n; ++i) {
            address t = _openTokens[i];
            if (p.tokens[i] != t) revert BadParams();
            uint256 amt = pendingByToken[t];
            amounts[i] = amt;
            if (t == imd) {
                values[i] = amt;
            } else if (t == infer) {
                inferSlot = i;
            } else {
                values[i] = _route(t, t == ETH ? amt - reward : amt, p.minOuts[i], false);
            }
        }

        (uint256 liquidity, uint256 inferAdded, uint256 imdAdded, uint256 rateImd, uint256 rateInfer) =
            _balanceAndAdd(p.minSplitOut);
        if (liquidity == 0) revert InsufficientLiquidity();
        if (inferSlot != type(uint256).max) {
            values[inferSlot] = FixedPointMathLib.fullMulDiv(amounts[inferSlot], rateImd, rateInfer);
        }

        // ETH beyond what is owed (router refunds, strays) is dust for current holders, before the new shares.
        uint256 ethHeld = address(this).balance;
        uint256 ethOwed = _feeOwed(I_ETH) + reward;
        if (ethHeld > ethOwed) _distribute(I_ETH, ethHeld - ethOwed);

        _closeBatch(liquidity, amounts, values);
        sharesIssued = liquidity;
        emit BatchConverted(closedBatches, liquidity, inferAdded, imdAdded, reward);
        _payCallerReward(reward);
        _checkSolvent();
    }

    /// @dev Caller reward for a batch holding `ethPending` wei.
    function _conversionReward(uint256 ethPending) internal pure returns (uint256) {
        uint256 cap = (ethPending * MAX_CONVERSION_REWARD_BPS) / 10000; // round down: favors benefactors
        return cap < CONVERSION_REWARD ? cap : CONVERSION_REWARD;
    }

    /// @dev Run `token`'s route (or its reverse) through zRouter; returns the final output. A hop that receives nothing
    ///      (dust) ends the route at 0.
    function _route(address token, uint256 amountIn, uint256[] memory minOuts, bool reverse)
        internal
        returns (uint256 amount)
    {
        RouteHop[] memory hops = routes.getRoute(token);
        uint256 h = hops.length;
        if (h == 0) revert NoRoute(token);
        if (h > MAX_ROUTE_HOPS) revert BadRoute(token);
        if (!reverse && minOuts.length != h) revert BadParams();
        // Re-checked here so a bad table can never send the vault's tokens anywhere but to IMD (or back to ETH).
        address first = reverse ? hops[h - 1].tokenOut : hops[0].tokenIn;
        address last = reverse ? hops[0].tokenIn : hops[h - 1].tokenOut;
        if (first != (reverse ? imd : token) || last != (reverse ? token : imd)) revert BadRoute(token);

        amount = amountIn;
        for (uint256 k; k < h; ++k) {
            if (amount == 0) return 0;
            RouteHop memory hop = hops[reverse ? h - 1 - k : k];
            if (reverse) (hop.tokenIn, hop.tokenOut) = (hop.tokenOut, hop.tokenIn);
            amount = _swapHop(hop, amount, reverse ? 0 : minOuts[k]);
        }
    }

    // slither-disable-next-line arbitrary-send-eth,unused-return
    function _swapHop(RouteHop memory hop, uint256 amountIn, uint256 minOut) internal returns (uint256 amountOut) {
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

    /// @dev Balance the free INFER and IMD (everything held beyond fees owed: this batch's IMD and INFER plus earlier
    ///      leftovers) with vault-side swaps in the alignment pool, and add them full range. Swap, add, measure what is
    ///      left and go again, up to MAX_LP_PASSES, always in the first pass's direction. Returns the liquidity added and
    ///      the realized IMD-per-INFER rate as (rateImd / rateInfer): the balancing swap's, else the pool price.
    function _balanceAndAdd(uint256 minSplitOut)
        internal
        returns (uint256 liquidity, uint256 inferAdded, uint256 imdAdded, uint256 rateImd, uint256 rateInfer)
    {
        (uint160 sqrtP, uint128 poolL) = _poolState();
        if (sqrtP == 0) revert PoolNotInitialized();
        uint160 sqrtP0 = sqrtP;

        uint256 swapIn;
        uint256 swapOut;
        uint256 startExcess;
        bool dirSet;
        bool inferToImd;
        for (uint256 pass; pass < MAX_LP_PASSES; ++pass) {
            (uint256 freeInfer, uint256 freeImd) = _freeAlignmentBalances();
            (bool z, uint256 s, uint256 excess) = _splitAmount(freeInfer, freeImd, sqrtP, poolL);
            if (pass == 0) startExcess = excess;
            if (pass != 0 && (s == 0 || z != inferToImd || s < startExcess / LP_PASS_MIN_DIVISOR)) break;
            if (s != 0) {
                if (!dirSet) (dirSet, inferToImd) = (true, z);
                uint256 out = _alignSwap(z, s);
                swapIn += s;
                swapOut += out;
                (freeInfer, freeImd) = _freeAlignmentBalances();
            }
            (uint256 l, uint256 u0, uint256 u1) = _addLiquidity(freeInfer, freeImd);
            if (l == 0) break;
            liquidity += l;
            inferAdded += u0;
            imdAdded += u1;
            (sqrtP, poolL) = _poolState();
        }
        if (swapIn != 0) {
            if (minSplitOut == 0) revert ZeroFloor();
            if (swapOut < minSplitOut) revert InsufficientOutput();
            emit SplitSwap(inferToImd, swapIn, swapOut);
        }
        if (swapIn != 0 && swapOut != 0) {
            (rateImd, rateInfer) = inferToImd ? (swapOut, swapIn) : (swapIn, swapOut);
        } else {
            // No balancing swap: value INFER at the pool price at the start of the conversion (IMD per INFER).
            (rateImd, rateInfer) = _inferIsCurrency0
                ? (FixedPointMathLib.fullMulDiv(sqrtP0, sqrtP0, Q96), Q96)
                : (Q96, FixedPointMathLib.fullMulDiv(sqrtP0, sqrtP0, Q96));
            if (rateImd == 0 || rateInfer == 0) revert PoolNotInitialized();
        }
    }

    /// @dev INFER and IMD held beyond fees owed (and beyond pending contributions of the open batch when not converting:
    ///      callers only use this inside a conversion or a reinvest, where those are spent or accounted for).
    function _freeAlignmentBalances() internal view returns (uint256 freeInfer, uint256 freeImd) {
        freeInfer = _free(infer, I_INFER);
        freeImd = _free(imd, I_IMD);
    }

    function _free(address token, uint256 i) private view returns (uint256) {
        uint256 bal = SafeTransferLib.balanceOf(token, address(this));
        uint256 owed = _feeOwed(i);
        return bal > owed ? bal - owed : 0;
    }

    /// @dev How much of the side in excess to swap so what is left pairs at the pool's ratio after the swap has moved
    ///      its price: the single-sided add formula on the excess against the pool's virtual reserve of that token.
    ///      Returns the direction (true = INFER -> IMD), the amount, and the excess.
    function _splitAmount(uint256 amtInfer, uint256 amtImd, uint160 sqrtP, uint128 poolL)
        internal
        view
        returns (bool inferToImd, uint256 swapAmount, uint256 excess)
    {
        (uint256 a0, uint256 a1) = _inferIsCurrency0 ? (amtInfer, amtImd) : (amtImd, amtInfer);
        // Value of a0 in token1 units: a0 * P, P = (sqrtP / 2^96)^2.
        uint256 a0In1 = FixedPointMathLib.fullMulDiv(FixedPointMathLib.fullMulDiv(a0, sqrtP, Q96), sqrtP, Q96);
        bool zeroForOne;
        uint256 reserve;
        if (a1 > a0In1) {
            excess = a1 - a0In1; // token1 in excess: swap token1 -> token0
            reserve = FixedPointMathLib.fullMulDiv(poolL, sqrtP, Q96);
            zeroForOne = false;
        } else {
            uint256 a1In0 = FixedPointMathLib.fullMulDiv(FixedPointMathLib.fullMulDiv(a1, Q96, sqrtP), Q96, sqrtP);
            excess = a0 > a1In0 ? a0 - a1In0 : 0;
            reserve = FixedPointMathLib.fullMulDiv(poolL, Q96, sqrtP);
            zeroForOne = true;
        }
        swapAmount = _balancedSwap(excess, reserve, _poolKey.fee);
        inferToImd = zeroForOne == _inferIsCurrency0;
    }

    /// @dev Bounded by the no-price-impact answer, amount / (2 - fee), which also covers depth too large to compute.
    function _balancedSwap(uint256 amount, uint256 reserve, uint24 fee) internal pure returns (uint256) {
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

    /// @dev Swap exactly `amountIn` of INFER (inferToImd) or IMD in the alignment pool; returns the output.
    function _alignSwap(bool inferToImd, uint256 amountIn) internal returns (uint256) {
        return _poolSwap(inferToImd == _inferIsCurrency0, amountIn);
    }

    /// @dev Add `amtInfer` / `amtImd` full range (what fits); returns liquidity and what it used of each.
    function _addLiquidity(uint256 amtInfer, uint256 amtImd)
        internal
        returns (uint256 liquidity, uint256 usedInfer, uint256 usedImd)
    {
        if (amtInfer == 0 || amtImd == 0) return (0, 0, 0);
        (uint160 sqrtP,) = _poolState();
        (uint256 a0, uint256 a1) = _inferIsCurrency0 ? (amtInfer, amtImd) : (amtImd, amtInfer);
        uint128 l = LiquidityAmounts.getLiquidityForAmounts(
            sqrtP, TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), a0, a1
        );
        if (l == 0) return (0, 0, 0);
        (uint256 used0, uint256 used1) = _modifyPosition(int256(uint256(l)));
        totalLPUnits += l;
        liquidity = l;
        (usedInfer, usedImd) = _inferIsCurrency0 ? (used0, used1) : (used1, used0);
    }

    /// @dev Modify the vault's single full-range position and book the fees it accrued (always to current holders:
    ///      every caller changes shares only after this). Returns the principal paid in per currency.
    function _modifyPosition(int256 liquidityDelta) internal returns (uint256 used0, uint256 used1) {
        uint256 fees0;
        uint256 fees1;
        (used0, used1, fees0, fees1) = _poolModify(liquidityDelta);
        (uint256 fInfer, uint256 fImd) = _inferIsCurrency0 ? (fees0, fees1) : (fees1, fees0);
        _creditYield(I_INFER, fInfer);
        _creditYield(I_IMD, fImd);
    }

    function _closeBatch(uint256 liquidity, uint256[] memory amounts, uint256[] memory values) private {
        uint256 batchId = closedBatches + 1;
        uint256 totalValue;
        uint256 n = amounts.length;
        for (uint256 i; i < n; ++i) totalValue += values[i];
        if (totalValue == 0) revert InsufficientOutput();
        for (uint256 i; i < n; ++i) {
            address t = _openTokens[i];
            uint256 tokenShares = FixedPointMathLib.fullMulDiv(liquidity, values[i], totalValue); // round down
            batchSharesPerUnit[batchId][t] = FixedPointMathLib.fullMulDiv(tokenShares, ACC_PRECISION, amounts[i]);
            emit TokenConverted(batchId, t, amounts[i], values[i]);
            pendingByToken[t] = 0;
        }
        delete _openTokens;
        _batchAcc[batchId] = _accPerShare; // new shares earn from here
        closedBatches = batchId;
        totalShares += liquidity;
    }

    // slither-disable-next-line arbitrary-send-eth
    function _payCallerReward(uint256 reward) private {
        if (reward == 0) return;
        (bool ok,) = payable(msg.sender).call{value: reward}("");
        if (ok) {
            emit ConversionRewardPaid(msg.sender, reward);
        } else {
            _distribute(I_ETH, reward);
            emit ConversionRewardRejected(msg.sender, reward);
        }
    }

    // ========== Fee accounting ==========

    /// @notice Collect the position's fees now (no swap; anyone).
    function collectFees() external nonReentrant {
        _collectFees();
    }

    function _collectFees() internal {
        if (totalLPUnits == 0) return;
        _modifyPosition(0);
        lastFeeCollectionTime = block.timestamp;
    }

    // slither-disable-next-line timestamp
    function _maybeCollectFees() internal {
        if (block.timestamp >= lastFeeCollectionTime + FEE_COLLECTION_INTERVAL) _collectFees();
    }

    /// @dev Protocol cut, the rest pro rata to current shareholders.
    function _creditYield(uint256 i, uint256 amount) internal {
        if (amount == 0) return;
        uint256 cut = (amount * PROTOCOL_YIELD_CUT_BPS) / 10000; // round down: favors benefactors
        if (cut != 0) {
            _protocolFees[i] += cut;
            emit ProtocolYieldCollected(_feeToken(i), cut);
        }
        _distribute(i, amount - cut);
    }

    function _distribute(uint256 i, uint256 amount) internal {
        if (amount == 0) return;
        if (totalShares == 0) {
            // Nobody to credit (only before the first conversion closes): keep it accounted.
            _protocolFees[i] += amount;
            emit ProtocolYieldCollected(_feeToken(i), amount);
            return;
        }
        _accPerShare[i] += FixedPointMathLib.fullMulDiv(amount, ACC_PRECISION, totalShares); // round down
        _distributed[i] += amount;
        emit FeesAccumulated(_feeToken(i), amount);
    }

    function _feeOwed(uint256 i) internal view returns (uint256) {
        return _distributed[i] - _claimed[i] + _protocolFees[i];
    }

    function _feeToken(uint256 i) internal view returns (address) {
        return i == I_INFER ? infer : i == I_IMD ? imd : ETH;
    }

    function _feeIndex(address token) internal view returns (uint256) {
        if (token == infer) return I_INFER;
        if (token == imd) return I_IMD;
        if (token == ETH) return I_ETH;
        revert UnknownFeeToken();
    }

    /// @dev A benefactor's state as if a converted batch of theirs were collected: shares, the indexes they earn from,
    ///      and the fees their earlier shares earned up to that batch.
    function _collected(address b)
        internal
        view
        returns (uint256 shares, uint256[3] memory checkpoint, uint256[3] memory earlier)
    {
        shares = _shares[b];
        checkpoint = _checkpoint[b];
        uint256 batchId = _pendingBatch[b];
        if (batchId == 0 || batchId > closedBatches) return (shares, checkpoint, earlier);
        uint256[3] memory acc = _batchAcc[batchId];
        for (uint256 i; i < 3; ++i) {
            earlier[i] = FixedPointMathLib.fullMulDiv(shares, acc[i] - checkpoint[i], ACC_PRECISION);
        }
        address[] storage toks = _benefactorTokens[b];
        for (uint256 k; k < toks.length; ++k) {
            shares += FixedPointMathLib.fullMulDiv(
                _pending[b][toks[k]], batchSharesPerUnit[batchId][toks[k]], ACC_PRECISION
            ); // round down
        }
        checkpoint = acc;
    }

    function _owedSinceCheckpoint(address b) internal view returns (uint256 shares, uint256[3] memory owed) {
        uint256[3] memory checkpoint;
        (shares, checkpoint, owed) = _collected(b);
        for (uint256 i; i < 3; ++i) {
            owed[i] += FixedPointMathLib.fullMulDiv(shares, _accPerShare[i] - checkpoint[i], ACC_PRECISION);
        }
    }

    /// @dev Collect a converted batch and move fees earned so far into settled.
    function _settle(address b) internal {
        (uint256 shares, uint256[3] memory owed) = _owedSinceCheckpoint(b);
        uint256 batchId = _pendingBatch[b];
        if (batchId != 0 && batchId <= closedBatches) {
            _shares[b] = shares;
            address[] storage toks = _benefactorTokens[b];
            for (uint256 k; k < toks.length; ++k) delete _pending[b][toks[k]];
            delete _benefactorTokens[b];
            delete _pendingBatch[b];
        }
        for (uint256 i; i < 3; ++i) {
            if (owed[i] != 0) _settled[b][i] += owed[i];
            _checkpoint[b][i] = _accPerShare[i];
        }
    }

    function _harvest(address b) internal returns (uint256[3] memory amounts) {
        _settle(b);
        for (uint256 i; i < 3; ++i) {
            uint256 a = _settled[b][i];
            if (a != 0) {
                _settled[b][i] = 0;
                _claimed[i] += a;
                amounts[i] = a;
            }
        }
    }

    /// @dev Credit back what a reinvest could not use. Up to what was harvested in that token it un-claims; beyond that
    ///      (the balancing swap's output in the other token) it is held and newly owed, so it counts as distributed.
    function _unharvest(address b, uint256 i, uint256 amount, uint256 harvested) internal {
        if (amount == 0) return;
        _settled[b][i] += amount;
        uint256 back = amount < harvested ? amount : harvested;
        _claimed[i] -= back;
        _distributed[i] += amount - back;
    }

    // ========== Claims ==========

    /// @inheritdoc IAlignmentVault
    // slither-disable-next-line reentrancy-benign
    function claimFees(ClaimMode mode, uint256 minEthOut)
        external
        override
        nonReentrant
        returns (uint256 inferOut, uint256 imdOut, uint256 ethOut)
    {
        address b = msg.sender;
        if (benefactorShares(b) == 0) revert NoShares();
        if (mode == ClaimMode.REINVEST) return _reinvest(b, minEthOut);
        _maybeCollectFees();
        uint256[3] memory a = _harvest(b);
        if (a[0] == 0 && a[1] == 0 && a[2] == 0) revert NoFeesToClaim();
        address to = benefactorDelegate[b];
        if (to == address(0)) to = b;
        (inferOut, imdOut, ethOut) = _payout(to, a, mode, minEthOut);
        emit FeesClaimed(b, mode, inferOut, imdOut, ethOut);
        _checkSolvent();
    }

    /// @inheritdoc IAlignmentVault
    // slither-disable-next-line reentrancy-benign
    function claimFeesAsDelegate(address[] calldata benefactors, ClaimMode mode, uint256 minEthOut)
        external
        override
        nonReentrant
        returns (uint256 inferOut, uint256 imdOut, uint256 ethOut)
    {
        if (mode == ClaimMode.REINVEST) revert BadParams();
        _maybeCollectFees();
        uint256[3] memory total;
        for (uint256 k; k < benefactors.length; ++k) {
            address b = benefactors[k];
            if (benefactorDelegate[b] != msg.sender) revert NotDelegate();
            if (benefactorShares(b) == 0) revert NoShares();
            uint256[3] memory a = _harvest(b);
            emit FeesClaimed(b, mode, a[0], a[1], a[2]);
            for (uint256 i; i < 3; ++i) total[i] += a[i];
        }
        if (total[0] == 0 && total[1] == 0 && total[2] == 0) revert NoFeesToClaim();
        (inferOut, imdOut, ethOut) = _payout(msg.sender, total, mode, minEthOut);
        _checkSolvent();
    }

    // slither-disable-next-line arbitrary-send-eth
    function _payout(address to, uint256[3] memory a, ClaimMode mode, uint256 minEthOut)
        internal
        returns (uint256 inferOut, uint256 imdOut, uint256 ethOut)
    {
        if (mode == ClaimMode.TOKENS) {
            (inferOut, imdOut, ethOut) = (a[0], a[1], a[2]);
            if (inferOut != 0) SafeTransferLib.safeTransfer(infer, to, inferOut);
            if (imdOut != 0) SafeTransferLib.safeTransfer(imd, to, imdOut);
        } else {
            // ETH: INFER -> IMD in the alignment pool (vault-side), IMD -> ETH along the reverse of the ETH route.
            if (minEthOut == 0) revert ZeroFloor();
            uint256 imdTotal = a[1];
            if (a[0] != 0) imdTotal += _alignSwap(true, a[0]);
            ethOut = a[2];
            if (imdTotal != 0) ethOut += _route(ETH, imdTotal, new uint256[](0), true);
            if (ethOut < minEthOut) revert InsufficientOutput();
        }
        if (ethOut != 0) {
            (bool ok,) = payable(to).call{value: ethOut}("");
            if (!ok) revert TransferFailed();
        }
    }

    /// @dev Put the caller's INFER + IMD fees back into the position as new shares (1 share = 1 liquidity unit, the
    ///      price every share was issued at). Balances the two first with a vault-side swap. What the add can't use, and
    ///      any ETH dust, stays claimable.
    function _reinvest(address b, uint256 minShares)
        internal
        returns (uint256 inferIn, uint256 imdIn, uint256 ethOut)
    {
        _collectFees(); // a share change: book the yield first
        uint256[3] memory a = _harvest(b);
        if (a[0] == 0 && a[1] == 0) revert NoFeesToClaim();
        _unharvest(b, I_ETH, a[2], a[2]);

        (uint256 amtInfer, uint256 amtImd) = (a[0], a[1]);
        (uint160 sqrtP, uint128 poolL) = _poolState();
        if (sqrtP == 0) revert PoolNotInitialized();
        (bool inferToImd, uint256 s,) = _splitAmount(amtInfer, amtImd, sqrtP, poolL);
        if (s != 0) {
            uint256 out = _alignSwap(inferToImd, s);
            emit SplitSwap(inferToImd, s, out);
            (amtInfer, amtImd) = inferToImd ? (amtInfer - s, amtImd + out) : (amtInfer + out, amtImd - s);
        }
        (uint256 l, uint256 usedInfer, uint256 usedImd) = _addLiquidity(amtInfer, amtImd);
        if (l == 0) revert InsufficientLiquidity();
        if (l < minShares) revert InsufficientOutput();
        // The add booked the position's fees to current holders, b's existing shares included: settle before minting.
        _settle(b);
        _unharvest(b, I_INFER, amtInfer - usedInfer, a[0]);
        _unharvest(b, I_IMD, amtImd - usedImd, a[1]);
        _shares[b] += l;
        totalShares += l;
        emit Reinvested(b, usedInfer, usedImd, l);
        emit FeesClaimed(b, ClaimMode.REINVEST, usedInfer, usedImd, 0);
        _checkSolvent();
        return (usedInfer, usedImd, 0);
    }

    // ========== Protocol cut ==========

    /// @notice Send the protocol's accumulated cut in `token` (INFER, IMD or address(0) for ETH) to the registry treasury.
    // slither-disable-next-line arbitrary-send-eth,reentrancy-events
    function withdrawProtocolFees(address token) external nonReentrant {
        uint256 i = _feeIndex(token);
        address treasury = registry.treasury();
        if (treasury == address(0)) revert TreasuryNotSet();
        uint256 amount = _protocolFees[i];
        if (amount == 0) revert NoFeesToClaim();
        _protocolFees[i] = 0;
        if (token == ETH) {
            (bool ok,) = payable(treasury).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            SafeTransferLib.safeTransfer(token, treasury, amount);
        }
        emit ProtocolFeesWithdrawn(token, amount);
    }

    // ========== Solvency ==========

    /// @dev Everything owed in INFER, IMD and ETH (fees, protocol cut, pending contributions) is held.
    function _checkSolvent() internal view {
        for (uint256 i; i < 3; ++i) {
            address t = _feeToken(i);
            if (_balanceOf(t) < _feeOwed(i) + pendingByToken[t]) revert Insolvent(t);
        }
    }

    function _balanceOf(address token) internal view returns (uint256) {
        return token == ETH ? address(this).balance : SafeTransferLib.balanceOf(token, address(this));
    }

    // ========== Pool access (virtual for unit tests) ==========

    function _poolState() internal view virtual returns (uint160 sqrtPriceX96, uint128 liquidity) {
        PoolId id = _poolKey.toId();
        (sqrtPriceX96,,,) = StateLibrary.getSlot0(poolManager, id);
        liquidity = StateLibrary.getLiquidity(poolManager, id);
    }

    function _poolSwap(bool zeroForOne, uint256 amountIn) internal virtual returns (uint256 amountOut) {
        if (amountIn == 0) return 0;
        bytes memory res = poolManager.unlock(abi.encode(ACTION_SWAP, abi.encode(zeroForOne, amountIn)));
        amountOut = abi.decode(res, (uint256));
    }

    function _poolModify(int256 liquidityDelta)
        internal
        virtual
        returns (uint256 used0, uint256 used1, uint256 fees0, uint256 fees1)
    {
        bytes memory res = poolManager.unlock(abi.encode(ACTION_MODIFY, abi.encode(liquidityDelta)));
        (BalanceDelta callerDelta, BalanceDelta feesAccrued) = abi.decode(res, (BalanceDelta, BalanceDelta));
        fees0 = _pos(feesAccrued.amount0());
        fees1 = _pos(feesAccrued.amount1());
        // callerDelta = principal + fees; principal is what the add paid in (negative).
        int256 p0 = int256(callerDelta.amount0()) - int256(feesAccrued.amount0());
        int256 p1 = int256(callerDelta.amount1()) - int256(feesAccrued.amount1());
        used0 = p0 < 0 ? uint256(-p0) : 0;
        used1 = p1 < 0 ? uint256(-p1) : 0;
    }

    function _pos(int128 x) private pure returns (uint256) {
        return x > 0 ? uint256(uint128(x)) : 0;
    }

    /// @notice PoolManager unlock callback: the vault's own swaps and position changes in the alignment pool.
    // slither-disable-next-line unused-return
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert Unauthorized();
        (uint8 action, bytes memory inner) = abi.decode(data, (uint8, bytes));
        PoolKey memory key = _poolKey;
        if (action == ACTION_MODIFY) {
            int256 liquidityDelta = abi.decode(inner, (int256));
            (BalanceDelta callerDelta, BalanceDelta feesAccrued) = poolManager.modifyLiquidity(
                key,
                IPoolManager.ModifyLiquidityParams({
                    tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: liquidityDelta, salt: 0
                }),
                ""
            );
            _settleDelta(key, callerDelta);
            return abi.encode(callerDelta, feesAccrued);
        }
        (bool zeroForOne, uint256 amountIn) = abi.decode(inner, (bool, uint256));
        BalanceDelta delta = poolManager.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        _settleDelta(key, delta);
        return abi.encode(_pos(zeroForOne ? delta.amount1() : delta.amount0()));
    }

    function _settleDelta(PoolKey memory key, BalanceDelta delta) private {
        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        if (d0 < 0) key.currency0.settle(poolManager, address(this), uint128(-d0), false);
        else if (d0 > 0) key.currency0.take(poolManager, address(this), uint128(d0), false);
        if (d1 < 0) key.currency1.settle(poolManager, address(this), uint128(-d1), false);
        else if (d1 > 0) key.currency1.take(poolManager, address(this), uint128(d1), false);
    }

    function _isCollecting() private view returns (bool collecting) {
        assembly ("memory-safe") {
            collecting := tload(_COLLECTING_SLOT)
        }
    }

    function _setCollecting(bool collecting) private {
        assembly ("memory-safe") {
            tstore(_COLLECTING_SLOT, collecting)
        }
    }

    // ========== Views ==========

    /// @notice Shares the benefactor holds, including any from a converted batch it has not touched since.
    function benefactorShares(address benefactor) public view returns (uint256 shares) {
        (shares,,) = _collected(benefactor);
    }

    function getBenefactorShares(address benefactor) external view override returns (uint256) {
        return benefactorShares(benefactor);
    }

    /// @inheritdoc IAlignmentVault
    function pendingOf(address benefactor, address token) external view override returns (uint256) {
        return _pendingBatch[benefactor] > closedBatches ? _pending[benefactor][token] : 0;
    }

    /// @inheritdoc IAlignmentVault
    function claimable(address benefactor) external view override returns (uint256, uint256, uint256) {
        (, uint256[3] memory owed) = _owedSinceCheckpoint(benefactor);
        uint256[3] storage s = _settled[benefactor];
        return (s[0] + owed[0], s[1] + owed[1], s[2] + owed[2]);
    }

    /// @notice The tokens in the open batch, in the order convertAndAddLiquidity expects them.
    function openBatchTokens() external view returns (address[] memory) {
        return _openTokens;
    }

    function alignmentPoolKey() external view returns (PoolKey memory) {
        return _poolKey;
    }

    /// @notice Per fee token (INFER, IMD, address(0) = ETH dust): index, lifetime distributed and claimed, protocol cut held.
    function feeStats(address token)
        external
        view
        returns (uint256 accPerShare, uint256 distributed, uint256 claimed, uint256 protocolFees)
    {
        uint256 i = _feeIndex(token);
        return (_accPerShare[i], _distributed[i], _claimed[i], _protocolFees[i]);
    }

    /// @notice Address that receives the protocol's yield cut.
    function protocolTreasury() external view returns (address) {
        return registry.treasury();
    }

    function vaultType() external pure override returns (string memory) {
        return "UniswapV4LP";
    }

    function description() external pure override returns (string memory) {
        return "Turns every contribution into full-range INFER/IMD liquidity on Uniswap v4; shares earn the position's fees";
    }

    function supportsCapability(bytes32 capability) external pure override returns (bool) {
        return capability == keccak256("YIELD_GENERATION") || capability == keccak256("BENEFACTOR_DELEGATION")
            || capability == keccak256("MULTI_ASSET");
    }

    function currentPolicy() external pure override returns (bytes memory) {
        return "";
    }

    function validateCompliance(address) external pure override returns (bool) {
        return true;
    }

    // ========== Delegation ==========

    function delegateBenefactor(address delegate) external override {
        if (!isBenefactor[msg.sender]) revert NotBenefactor();
        benefactorDelegate[msg.sender] = delegate;
        emit BenefactorDelegateSet(msg.sender, delegate);
    }

    function getBenefactorDelegate(address benefactor) external view override returns (address) {
        address delegate = benefactorDelegate[benefactor];
        return delegate == address(0) ? benefactor : delegate;
    }
}
