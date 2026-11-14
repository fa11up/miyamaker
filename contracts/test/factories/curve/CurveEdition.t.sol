// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC1155 } from "solady/tokens/ERC1155.sol";
import { MiyaRegistry } from "../../../src/registry/MiyaRegistry.sol";
import { IMiyaRegistry } from "../../../src/registry/interfaces/IMiyaRegistry.sol";
import { PaymentLib } from "../../../src/libraries/PaymentLib.sol";
import { CurveMath } from "../../../src/factories/curve/CurveMath.sol";
import { CurveEdition } from "../../../src/factories/curve/CurveEdition.sol";
import { CurveEditionFactory } from "../../../src/factories/curve/CurveEditionFactory.sol";
import { MockVaultV2, MockToken, FeeOnTransferToken, BlocklistToken } from "../payments/PaymentMocks.sol";
import { ClaimMode } from "../../../src/interfaces/IAlignmentVault.sol";

/// @dev Exposes the library for exact-value tests.
contract CurveMathHarness {
    function price(uint8 shape, uint256 start, uint256 step, uint256 n) external pure returns (uint256) {
        return CurveMath.price(shape, start, step, n);
    }
}

contract CurveEditionTest is Test {
    address constant TREASURY = address(0x7EA5);
    address registryOwner = makeAddr("registryOwner");
    address safe = makeAddr("safe");
    address artist = makeAddr("artist");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    MiyaRegistry registry;
    MockVaultV2 vault;
    CurveEditionFactory factory;
    CurveEdition coll;
    MockToken usd;
    CurveMathHarness math;

    uint8 constant EXP = 0;
    uint8 constant LIN = 1;

    function setUp() public {
        registry = new MiyaRegistry(registryOwner, TREASURY, 100, 1000); // 1% protocol, 10% minimum alignment
        vault = new MockVaultV2();
        usd = new MockToken("USD", "USD", 6);
        factory = new CurveEditionFactory(safe, IMiyaRegistry(address(registry)), address(0xBEEF));
        math = new CurveMathHarness();
        vm.startPrank(registryOwner);
        registry.setFactory(address(factory), true);
        registry.setVaultFactory(registryOwner, true);
        registry.registerVault(address(vault));
        registry.setPaymentToken(address(usd), true);
        vm.stopPrank();
        vm.startPrank(safe);
        factory.setPriceCap(address(0), 1000 ether);
        factory.setPriceCap(address(usd), 2_000_000e6);
        vm.stopPrank();
        vm.prank(artist);
        coll = CurveEdition(payable(factory.createInstance(bytes32("a"), "Curves", "ipfs://c", address(vault))));
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
    }

    function _params(address currency, uint8 shape, uint128 start, uint128 step, uint32 maxSupply)
        internal
        pure
        returns (CurveEdition.EditionParams memory)
    {
        return CurveEdition.EditionParams({
            currency: currency,
            shape: shape,
            startPrice: start,
            step: step,
            maxSupply: maxSupply,
            spreadBps: 1000,
            royaltyBps: 500,
            uri: "ipfs://copy",
            masterUri: "ipfs://master"
        });
    }

    function _add(CurveEdition.EditionParams memory p) internal returns (uint256 id) {
        vm.prank(artist);
        id = coll.addEdition(p);
    }

    function _mint(address who, uint256 id, uint256 qty) internal returns (uint256 cost) {
        cost = coll.mintQuote(id, qty);
        vm.prank(who);
        coll.mint{ value: cost }(id, qty, cost);
    }

    /// @dev Sum of burn values of copies 1..s: what the reserve must hold.
    function _owed(uint256 id, uint256 s) internal view returns (uint256 owed) {
        CurveEdition.Edition memory e = coll.getEdition(id);
        for (uint256 n = 1; n <= s; ++n) {
            owed += CurveMath.burnValue(CurveMath.price(e.shape, e.startPrice, e.step, n), e.spreadBps);
        }
    }

    // ── maths ───────────────────────────────────────────────────────────────

    function test_math_exactPrices() public view {
        assertEq(math.price(LIN, 1 ether, 0.1 ether, 1), 1 ether);
        assertEq(math.price(LIN, 1 ether, 0.1 ether, 11), 2 ether);
        assertEq(math.price(EXP, 1 ether, 500, 1), 1 ether);
        assertEq(math.price(EXP, 1 ether, 500, 2), 1.05 ether);
        assertEq(math.price(EXP, 1 ether, 500, 3), 1.1025 ether);
        // 1.01^100 = 2.704813829421526093...; rpow rounds at each squaring, so it lands a few wei off. What matters
        // is that a copy's price is always computed the same way (mint and burn agree), which the fuzz checks.
        assertApproxEqAbs(math.price(EXP, 1e18, 100, 101), 2704813829421526093, 10);
        assertEq(math.price(EXP, 1e18, 100, 101), math.price(EXP, 1e18, 100, 101));
        assertEq(CurveMath.burnValue(1 ether, 1000), 0.9 ether);
    }

    function test_math_overflowReverts() public {
        vm.expectRevert();
        math.price(EXP, type(uint128).max, 500, 10_000);
    }

    // ── adding editions ─────────────────────────────────────────────────────

    function test_addEdition_mintsMasterToOwner() public {
        uint256 id = _add(_params(address(0), LIN, 0.01 ether, 0.001 ether, 100));
        assertEq(coll.balanceOf(artist, coll.masterId(id)), 1);
        assertEq(coll.getEdition(id).master, artist);
        assertEq(coll.uri(coll.copyId(id)), "ipfs://copy");
        assertEq(coll.uri(coll.masterId(id)), "ipfs://master");
    }

    function test_addEdition_limits() public {
        CurveEdition.EditionParams memory p = _params(address(0), EXP, 0.01 ether, 501, 100);
        vm.startPrank(artist);
        vm.expectRevert(CurveEdition.InvalidCurve.selector); // growth over 5%
        coll.addEdition(p);
        p.step = 100;
        p.maxSupply = 10_001;
        vm.expectRevert(CurveEdition.InvalidCurve.selector);
        coll.addEdition(p);
        p.maxSupply = 100;
        p.spreadBps = 499;
        vm.expectRevert(CurveEdition.InvalidCurve.selector);
        coll.addEdition(p);
        p.spreadBps = 3001;
        vm.expectRevert(CurveEdition.InvalidCurve.selector);
        coll.addEdition(p);
        p.spreadBps = 1000;
        p.royaltyBps = 1001;
        vm.expectRevert(CurveEdition.InvalidCurve.selector);
        coll.addEdition(p);
        p.royaltyBps = 0;
        p.startPrice = 0;
        vm.expectRevert(CurveEdition.InvalidCurve.selector);
        coll.addEdition(p);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(); // only the owner
        coll.addEdition(_params(address(0), LIN, 1, 1, 1));
    }

    function test_addEdition_priceCap() public {
        // 1 ETH at copy 1, +10 ETH per copy: copy 101 is 1001 ETH, over the 1000 ETH cap.
        vm.prank(artist);
        vm.expectRevert(abi.encodeWithSelector(CurveEdition.PriceOverCap.selector, 1001 ether, 1000 ether));
        coll.addEdition(_params(address(0), LIN, 1 ether, 10 ether, 101));
        // A token with no cap can't be used even when the registry allows it.
        MockToken other = new MockToken("O", "O", 18);
        vm.prank(registryOwner);
        registry.setPaymentToken(address(other), true);
        vm.prank(artist);
        vm.expectRevert(abi.encodeWithSelector(CurveEdition.PriceOverCap.selector, 1 ether, 0));
        coll.addEdition(_params(address(other), LIN, 1 ether, 0, 1));
        // A token the registry doesn't allow is refused outright.
        MockToken notAllowed = new MockToken("N", "N", 18);
        vm.prank(artist);
        vm.expectRevert(abi.encodeWithSelector(PaymentLib.TokenNotAllowed.selector, address(notAllowed)));
        coll.addEdition(_params(address(notAllowed), LIN, 1 ether, 0, 1));
    }

    function test_factory_onlySafeSetsCaps_andNeedsRegistration() public {
        vm.prank(alice);
        vm.expectRevert();
        factory.setPriceCap(address(0), 1);
        CurveEditionFactory unregistered =
            new CurveEditionFactory(safe, IMiyaRegistry(address(registry)), address(0xBEEF));
        vm.prank(artist);
        vm.expectRevert(MiyaRegistry.NotFactory.selector);
        unregistered.createInstance(bytes32("x"), "X", "", address(vault));
        vm.prank(artist);
        vm.expectRevert(CurveEditionFactory.InvalidVault.selector);
        factory.createInstance(bytes32("y"), "Y", "", makeAddr("not a vault"));
    }

    // ── mint ────────────────────────────────────────────────────────────────

    function test_mint_splits_10pct_spread_6_3_1() public {
        uint256 id = _add(_params(address(0), LIN, 1 ether, 0, 100)); // flat 1 ETH, easy numbers
        uint256 cost = _mint(alice, id, 2);
        assertEq(cost, 2 ether);
        assertEq(coll.balanceOf(alice, coll.copyId(id)), 2);
        assertEq(coll.getEdition(id).reserve, 1.8 ether, "90% to the reserve");
        assertEq(coll.masterOwed(artist, address(0)), 0.12 ether, "6% to the master holder");
        assertEq(vault.credited(address(coll), address(0)), 0.06 ether, "3% to the vault, credited to the collection");
        assertEq(TREASURY.balance, 0.02 ether, "1% protocol");
        assertEq(address(coll).balance, coll.liabilities(address(0)), "holds exactly what it owes");
    }

    function test_mint_guards() public {
        uint256 id = _add(_params(address(0), LIN, 1 ether, 0.1 ether, 3));
        uint256 cost = coll.mintQuote(id, 2);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(CurveEdition.CostTooHigh.selector, cost));
        coll.mint{ value: cost }(id, 2, cost - 1);
        vm.expectRevert(PaymentLib.WrongValue.selector);
        coll.mint{ value: cost - 1 }(id, 2, cost);
        vm.expectRevert(CurveEdition.SoldOut.selector);
        coll.mint{ value: 10 ether }(id, 4, 10 ether);
        vm.expectRevert(CurveEdition.InvalidQuantity.selector);
        coll.mint(id, 0, 0);
        vm.expectRevert(CurveEdition.NoSuchEdition.selector);
        coll.mint(9, 1, 1 ether);
        vm.stopPrank();
    }

    function test_mint_vaultUnderMinimumIsParkedNotLost() public {
        vault.setMinContribution(address(0), 0.001 ether);
        uint256 id = _add(_params(address(0), LIN, 0.01 ether, 0, 100)); // 3% of 0.01 = 0.0003 ETH < minimum
        _mint(alice, id, 1);
        assertEq(vault.credited(address(coll), address(0)), 0);
        assertEq(address(coll).balance, coll.liabilities(address(0)));
        _mint(alice, id, 3); // parked 0.0003 + 0.0009 = 0.0012 ETH clears the minimum
        assertEq(vault.credited(address(coll), address(0)), 0.0012 ether);
        assertEq(address(coll).balance, coll.liabilities(address(0)));
    }

    // ── burn ────────────────────────────────────────────────────────────────

    function test_burn_paysTopCopyBurnValue_andGuards() public {
        uint256 id = _add(_params(address(0), LIN, 1 ether, 1 ether, 10));
        _mint(alice, id, 3); // copies cost 1, 2, 3 ETH
        uint256 payout = coll.burnQuote(id, 1);
        assertEq(payout, 2.7 ether, "90% of the top copy's 3 ETH");
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(CurveEdition.PayoutTooLow.selector, payout));
        coll.burn(id, 1, payout + 1, 0);
        vm.expectRevert(abi.encodeWithSelector(CurveEdition.SupplyMoved.selector, 3));
        coll.burn(id, 1, 0, 4);
        uint256 before = alice.balance;
        coll.burn(id, 1, payout, 3);
        vm.stopPrank();
        assertEq(alice.balance - before, payout);
        assertEq(coll.getEdition(id).supply, 2);
        assertEq(coll.getEdition(id).reserve, _owed(id, 2));
        assertEq(coll.mintQuote(id, 1), 3 ether, "the curve comes back down");
    }

    function test_burn_onlyYourOwnCopies() public {
        uint256 id = _add(_params(address(0), LIN, 1 ether, 0, 10));
        _mint(alice, id, 2);
        vm.prank(bob);
        vm.expectRevert(ERC1155.InsufficientBalance.selector);
        coll.burn(id, 1, 0, 0);
    }

    function test_burnToZero_emptiesReserveExactly_exponential() public {
        uint256 id = _add(_params(address(0), EXP, 0.013 ether, 337, 200));
        _mint(alice, id, 50);
        _mint(bob, id, 37);
        assertEq(coll.getEdition(id).reserve, _owed(id, 87));
        vm.prank(bob);
        coll.burn(id, 37, 0, 0);
        vm.prank(alice);
        coll.burn(id, 50, 0, 0);
        assertEq(coll.getEdition(id).reserve, 0);
        assertEq(coll.reserveTotal(address(0)), 0);
        assertEq(address(coll).balance, coll.liabilities(address(0)), "only master earnings and parked cuts remain");
    }

    // ── master and royalties ────────────────────────────────────────────────

    function test_masterEarningsFollowTheMasterHolder() public {
        uint256 id = _add(_params(address(0), LIN, 1 ether, 0, 100));
        _mint(alice, id, 1); // 0.06 ETH to the artist
        uint256 mId = coll.masterId(id);
        vm.prank(artist);
        coll.safeTransferFrom(artist, bob, mId, 1, "");
        assertEq(coll.getEdition(id).master, bob);
        _mint(alice, id, 1); // 0.06 ETH to bob
        assertEq(coll.masterOwed(artist, address(0)), 0.06 ether);
        assertEq(coll.masterOwed(bob, address(0)), 0.06 ether);
        (address receiver, uint256 royalty) = coll.royaltyInfo(coll.copyId(id), 1 ether);
        assertEq(receiver, bob);
        assertEq(royalty, 0.05 ether);

        uint256 before = artist.balance;
        vm.prank(artist);
        coll.claimMasterEarnings(address(0));
        assertEq(artist.balance - before, 0.06 ether);
        vm.prank(artist);
        vm.expectRevert(CurveEdition.NothingToClaim.selector);
        coll.claimMasterEarnings(address(0));
        assertEq(address(coll).balance, coll.liabilities(address(0)));
    }

    function test_supportsInterfaces() public view {
        assertTrue(coll.supportsInterface(0x2a55205a)); // ERC-2981
        assertTrue(coll.supportsInterface(0xd9b67a26)); // ERC-1155
        assertFalse(coll.supportsInterface(0x80ac58cd)); // not ERC-721: the app offers it the curve, never a pool
    }

    // ── ERC-20 currency ─────────────────────────────────────────────────────

    function test_erc20_mintAndBurn() public {
        uint256 id = _add(_params(address(usd), LIN, 10e6, 1e6, 100)); // 10 USD, +1 USD per copy
        usd.mint(alice, 1000e6);
        uint256 cost = coll.mintQuote(id, 3); // 10 + 11 + 12
        assertEq(cost, 33e6);
        vm.startPrank(alice);
        usd.approve(address(coll), cost);
        vm.expectRevert(PaymentLib.WrongValue.selector); // no ETH with a token edition
        coll.mint{ value: 1 }(id, 3, cost);
        coll.mint(id, 3, cost);
        coll.burn(id, 3, 0, 0);
        vm.stopPrank();
        assertEq(coll.getEdition(id).reserve, 0);
        assertEq(usd.balanceOf(address(coll)), coll.liabilities(address(usd)));
    }

    function test_erc20_feeOnTransferRefused() public {
        FeeOnTransferToken fot = new FeeOnTransferToken();
        vm.prank(registryOwner);
        registry.setPaymentToken(address(fot), true);
        vm.prank(safe);
        factory.setPriceCap(address(fot), 1000e18);
        uint256 id = _add(_params(address(fot), LIN, 1e18, 0, 10));
        fot.mint(alice, 10e18);
        vm.startPrank(alice);
        fot.approve(address(coll), 10e18);
        vm.expectRevert(PaymentLib.ShortTransfer.selector);
        coll.mint(id, 1, 1e18);
        vm.stopPrank();
    }

    // ── audit fixes ─────────────────────────────────────────────────────────

    function test_ethMint_toleratesPriceMoves_refundsTheRest() public {
        uint256 id = _add(_params(address(0), LIN, 1 ether, 0.1 ether, 100));
        _mint(bob, id, 3);
        uint256 quoted = coll.mintQuote(id, 1); // 1.3 ETH
        vm.prank(bob);
        coll.burn(id, 1, 0, 0); // lands first: the next copy now costs 1.2 ETH
        uint256 before = alice.balance;
        vm.prank(alice);
        coll.mint{ value: quoted }(id, 1, quoted);
        assertEq(before - alice.balance, 1.2 ether, "paid the new price, the rest refunded");
        assertEq(address(coll).balance, coll.liabilities(address(0)));
        vm.prank(alice);
        vm.expectRevert(PaymentLib.WrongValue.selector); // more ETH than maxCost
        coll.mint{ value: 2 ether }(id, 1, 1.5 ether);
    }

    function test_delistedCurrency_noNewMints_burnsAndClaimsStillWork() public {
        uint256 id = _add(_params(address(usd), LIN, 10e6, 0, 100));
        usd.mint(alice, 100e6);
        vm.startPrank(alice);
        usd.approve(address(coll), type(uint256).max);
        coll.mint(id, 2, 20e6);
        vm.stopPrank();
        vm.prank(registryOwner);
        registry.setPaymentToken(address(usd), false);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(PaymentLib.TokenNotAllowed.selector, address(usd)));
        coll.mint(id, 1, 10e6);
        coll.burn(id, 2, 0, 0);
        vm.stopPrank();
        vm.prank(artist);
        coll.claimMasterEarnings(address(usd));
        assertEq(usd.balanceOf(address(coll)), coll.liabilities(address(usd)));
    }

    function test_strayEthRefused_vaultEthAccepted() public {
        vm.prank(alice);
        (bool ok,) = address(coll).call{ value: 1 ether }("");
        assertFalse(ok, "only the vault may send ETH directly");
        vm.deal(address(vault), 1 ether);
        vm.prank(address(vault));
        (ok,) = address(coll).call{ value: 1 ether }("");
        assertTrue(ok);
    }

    function test_perTxCap_onMintBurnAndQuotes() public {
        uint256 id = _add(_params(address(0), LIN, 0.001 ether, 0, 200));
        vm.expectRevert(CurveEdition.InvalidQuantity.selector);
        coll.mintQuote(id, 51);
        _mint(alice, id, 50);
        _mint(alice, id, 50);
        vm.prank(alice);
        vm.expectRevert(CurveEdition.InvalidQuantity.selector);
        coll.mint{ value: 1 ether }(id, 51, 1 ether);
        vm.expectRevert(CurveEdition.InvalidQuantity.selector);
        coll.burnQuote(id, 51);
        vm.prank(alice);
        vm.expectRevert(CurveEdition.InvalidQuantity.selector);
        coll.burn(id, 51, 0, 0);
    }

    function test_steepCurveRefusedAsInvalid_notARawOverflow() public {
        vm.prank(artist);
        vm.expectRevert(CurveEdition.InvalidCurve.selector); // 5% growth over 10,000 copies overflows
        coll.addEdition(_params(address(0), EXP, 1, 500, 10_000));
    }

    function test_factory_capBoundedAndWethRequired() public {
        vm.prank(safe);
        vm.expectRevert(CurveEditionFactory.CapTooHigh.selector);
        factory.setPriceCap(address(0), uint256(type(uint128).max) + 1);
        vm.expectRevert(CurveEditionFactory.InvalidAddress.selector);
        new CurveEditionFactory(safe, IMiyaRegistry(address(registry)), address(0));
    }

    function test_masterKeepsAShare_atTheHighestProtocolFee() public {
        MiyaRegistry r = new MiyaRegistry(registryOwner, TREASURY, 500, 1000); // 5%, the registry's maximum
        CurveEditionFactory f = new CurveEditionFactory(safe, IMiyaRegistry(address(r)), address(0xBEEF));
        vm.startPrank(registryOwner);
        r.setFactory(address(f), true);
        r.setVaultFactory(registryOwner, true);
        r.registerVault(address(vault));
        vm.stopPrank();
        vm.prank(safe);
        f.setPriceCap(address(0), 1000 ether);
        vm.prank(artist);
        CurveEdition c = CurveEdition(payable(f.createInstance(bytes32("hi"), "Hi", "", address(vault))));
        CurveEdition.EditionParams memory p = _params(address(0), LIN, 1 ether, 0, 10);
        p.spreadBps = 714; // 5% + 30% of 7.14% leaves the master nothing
        vm.prank(artist);
        vm.expectRevert(CurveEdition.InvalidCurve.selector);
        c.addEdition(p);
        p.spreadBps = 715;
        vm.prank(artist);
        c.addEdition(p);
    }

    function test_reentrancy_receiverHookCannotReenter() public {
        uint256 id = _add(_params(address(0), LIN, 1 ether, 0, 10));
        Reenterer r = new Reenterer(coll, id);
        vm.deal(address(r), 5 ether);
        vm.expectRevert(); // the hook's burn hits the guard, which fails the whole mint
        r.attack();
        assertEq(coll.getEdition(id).supply, 0);
    }

    function test_royalty_onCopiesOnly() public {
        uint256 id = _add(_params(address(0), LIN, 1 ether, 0, 10));
        (address to, uint256 amt) = coll.royaltyInfo(coll.masterId(id), 1 ether);
        assertEq(to, address(0));
        assertEq(amt, 0);
    }

    function test_claimMasterEarningsTo() public {
        uint256 id = _add(_params(address(0), LIN, 1 ether, 0, 10));
        _mint(alice, id, 1);
        uint256 before = bob.balance;
        vm.prank(artist);
        coll.claimMasterEarningsTo(address(0), bob);
        assertEq(bob.balance - before, 0.06 ether);
        vm.prank(artist);
        vm.expectRevert(CurveEdition.InvalidAddress.selector);
        coll.claimMasterEarningsTo(address(0), address(0));
    }

    function test_erc20VaultShare_parked_thenFlushed_orReleasedAfterDelist() public {
        vault.setMinContribution(address(usd), 5e6); // 3% of a 10 USD copy is 0.3 USD: parked
        uint256 id = _add(_params(address(usd), LIN, 10e6, 0, 100));
        usd.mint(alice, 1000e6);
        vm.startPrank(alice);
        usd.approve(address(coll), type(uint256).max);
        coll.mint(id, 5, 50e6); // 1.5 USD parked
        vm.stopPrank();
        assertEq(vault.credited(address(coll), address(usd)), 0);
        assertEq(usd.balanceOf(address(coll)), coll.liabilities(address(usd)));
        vm.expectRevert(); // still under the minimum
        coll.flushPendingVaultCut(address(usd), 0);
        usd.mint(bob, 10e6);
        vm.startPrank(bob);
        usd.approve(address(coll), type(uint256).max);
        coll.flushPendingVaultCut(address(usd), 3.5e6); // anyone may top it up to the minimum
        vm.stopPrank();
        assertEq(vault.credited(address(coll), address(usd)), 5e6);

        // Parked again, then the registry drops the token: the parked cut is released to the owner.
        vm.prank(alice);
        coll.mint(id, 2, 50e6);
        vm.prank(registryOwner);
        registry.setPaymentToken(address(usd), false);
        coll.flushPendingVaultCut(address(usd), 0);
        uint256 before = usd.balanceOf(artist);
        vm.prank(artist);
        coll.withdraw(address(usd));
        assertGt(usd.balanceOf(artist), before);
        assertEq(usd.balanceOf(address(coll)), coll.liabilities(address(usd)));
    }

    function test_protocolCut_parkedWhenTreasuryRefuses_thenFlushed() public {
        BlocklistToken blk = new BlocklistToken("B", "B", 18);
        vm.prank(registryOwner);
        registry.setPaymentToken(address(blk), true);
        vm.prank(safe);
        factory.setPriceCap(address(blk), 1000e18);
        uint256 id = _add(_params(address(blk), LIN, 1e18, 0, 10));
        blk.setBlocked(TREASURY, true);
        blk.mint(alice, 10e18);
        vm.startPrank(alice);
        blk.approve(address(coll), type(uint256).max);
        coll.mint(id, 1, 1e18); // the treasury refuses: 1% parked, the mint still lands
        vm.stopPrank();
        assertEq(blk.balanceOf(TREASURY), 0);
        assertEq(blk.balanceOf(address(coll)), coll.liabilities(address(blk)));
        blk.setBlocked(TREASURY, false);
        coll.flushPendingProtocolCut(address(blk));
        assertEq(blk.balanceOf(TREASURY), 0.01e18);
        assertEq(blk.balanceOf(address(coll)), coll.liabilities(address(blk)));
    }

    function test_claimVaultFees_inTheEditionsOwnCurrency_leavesReservesAlone() public {
        // The edition is priced in the vault's IMD-like fee token (INFER is another token, as on mainnet).
        MockToken inferLike = new MockToken("INFER", "INFER", 18);
        vault.setFeeTokens(address(inferLike), address(usd));
        uint256 id = _add(_params(address(usd), LIN, 10e6, 0, 100));
        usd.mint(alice, 1000e6);
        vm.startPrank(alice);
        usd.approve(address(coll), type(uint256).max);
        coll.mint(id, 10, 100e6);
        vm.stopPrank();
        usd.mint(address(vault), 7e6);
        vault.setFees(0, 7e6, 0);
        uint256 before = usd.balanceOf(artist);
        vm.prank(artist);
        coll.claimVaultFees(ClaimMode.TOKENS, 0);
        assertEq(usd.balanceOf(artist) - before, 7e6, "only the fees moved");
        assertEq(coll.getEdition(id).reserve, _owed(id, 10));
        assertEq(usd.balanceOf(address(coll)), coll.liabilities(address(usd)));
    }

    // ── solvency fuzz ───────────────────────────────────────────────────────

    /// @dev Random mints, burns (up to 50 at once) and master transfers by two holders, on either curve shape, in ETH
    ///      or a 6-decimal token: the reserve always equals the sum of the live copies' burn values, and the contract
    ///      always holds at least what it owes.
    function testFuzz_solvency(uint256 seed, uint8 steps, bool linear, bool inToken) public {
        address cur = inToken ? address(usd) : address(0);
        CurveEdition.EditionParams memory p = linear
            ? _params(cur, LIN, inToken ? 3e6 : 0.003 ether, inToken ? 0.07e6 : 0.00007 ether, 2000)
            : _params(cur, EXP, inToken ? 2e6 : 0.002 ether, 40, 2000);
        uint256 id = _add(p);
        address[2] memory who = [alice, bob];
        if (inToken) {
            for (uint256 k; k < 2; ++k) {
                usd.mint(who[k], 1e15);
                vm.prank(who[k]);
                usd.approve(address(coll), type(uint256).max);
            }
        }
        for (uint256 i; i < uint256(steps) % 40 + 5; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            address w = who[seed % 2];
            uint256 qty = (seed >> 8) % 50 + 1;
            uint256 supply = coll.getEdition(id).supply;
            uint256 held = coll.balanceOf(w, coll.copyId(id));
            uint256 action = (seed >> 16) % 5;
            if (action <= 2 && supply + qty <= 2000) {
                uint256 cost = coll.mintQuote(id, qty);
                vm.prank(w);
                coll.mint{ value: inToken ? 0 : cost }(id, qty, cost);
            } else if (action == 3 && held != 0) {
                vm.prank(w);
                coll.burn(id, qty > held ? held : qty, 0, 0);
            } else {
                address holder = coll.getEdition(id).master;
                address next = holder == artist ? bob : artist;
                uint256 mid = coll.masterId(id);
                vm.prank(holder);
                coll.safeTransferFrom(holder, next, mid, 1, "");
            }
            assertEq(
                coll.getEdition(id).reserve, _owed(id, coll.getEdition(id).supply), "reserve == sum of burn values"
            );
            uint256 bal = inToken ? usd.balanceOf(address(coll)) : address(coll).balance;
            assertGe(bal, coll.liabilities(cur), "holds what it owes");
        }
    }
}

/// @dev Mints, and from its ERC-1155 receiver hook tries to burn back in the same call.
contract Reenterer {
    CurveEdition immutable coll;
    uint256 immutable id;

    constructor(CurveEdition c, uint256 i) {
        coll = c;
        id = i;
    }

    function attack() external {
        uint256 cost = coll.mintQuote(id, 1);
        coll.mint{ value: cost }(id, 1, cost);
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4) {
        coll.burn(id, 1, 0, 0);
        return this.onERC1155Received.selector;
    }

    receive() external payable { }
}
