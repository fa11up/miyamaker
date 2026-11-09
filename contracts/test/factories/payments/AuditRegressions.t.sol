// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { DynamicPricingModule } from "../../../src/factories/erc1155/DynamicPricingModule.sol";
import { ERC1155Factory } from "../../../src/factories/erc1155/ERC1155Factory.sol";
import { ERC1155Instance, NoDynamicPricingModule } from "../../../src/factories/erc1155/ERC1155Instance.sol";
import { ERC721DropInstance } from "../../../src/factories/erc721drop/ERC721DropInstance.sol";
import { ERC721DropFactory } from "../../../src/factories/erc721drop/ERC721DropFactory.sol";
import { ERC721AuctionFactory } from "../../../src/factories/erc721/ERC721AuctionFactory.sol";
import { ERC721AuctionInstance } from "../../../src/factories/erc721/ERC721AuctionInstance.sol";
import { IMiyaRegistry } from "../../../src/registry/interfaces/IMiyaRegistry.sol";
import { PaymentLib } from "../../../src/libraries/PaymentLib.sol";
import { TokenPrice } from "../../../src/factories/interfaces/TokenPrice.sol";
import { FreeMintParams } from "../../../src/interfaces/IFactoryTypes.sol";
import { GatingScope } from "../../../src/gating/IGatingModule.sol";
import { PaymentTestBase } from "./PaymentMocks.sol";

/// @notice Audit c89f023c finding 1: the quoted next price equals what a one-piece mint charges.
contract DynamicPriceViewVsChargeTest is Test {
    DynamicPricingModule module;

    function setUp() public {
        module = new DynamicPricingModule();
    }

    function test_viewEqualsChargeForOne() public view {
        assertEq(module.calculatePrice(1e6, 100, 7), module.calculateBatchCost(1e6, 100, 7, 1));
        assertEq(module.calculatePrice(3, 1, 1), module.calculateBatchCost(3, 1, 1, 1));
        assertEq(module.calculatePrice(1e6, 100, 7), 1_072_136, "basePrice * 1.01^7, rounded up");
    }

    function test_viewEqualsCharge_first200() public view {
        for (uint256 m; m < 200; ++m) {
            assertEq(module.calculatePrice(1e6, 100, m), module.calculateBatchCost(1e6, 100, m, 1));
        }
    }

    function testFuzz_viewEqualsChargeForOne(uint256 base, uint256 rate, uint256 minted) public view {
        base = bound(base, 1, 1e30);
        rate = bound(rate, 1, 1000);
        minted = bound(minted, 0, 200);
        uint256 shown = module.calculatePrice(base, rate, minted);
        assertEq(shown, module.calculateBatchCost(base, rate, minted, 1));
        assertGe(shown, base, "never under basePrice");
    }

    function test_firstPieceIsBasePrice() public view {
        assertEq(module.calculatePrice(1e6, 100, 0), 1e6);
        assertEq(module.calculateBatchCost(1e6, 100, 0, 1), 1e6);
        assertEq(module.calculateBatchCost(1e15 + 1, 250, 0, 1), 1e15 + 1);
    }
}

/// @notice Audit c89f023c findings 1 and 9 at the instance and factory.
contract EditionAuditRegressionsTest is PaymentTestBase {
    ERC1155Factory factory;
    DynamicPricingModule module;
    uint256 salt;

    function setUp() public {
        _setUpPayments();
        factory = new ERC1155Factory(IMiyaRegistry(address(registry)), makeAddr("weth"));
        module = new DynamicPricingModule();
        registry.setComponent(address(module), true);
        factory.setDynamicPricingModule(address(module));
    }

    function _instance(address[] memory tokens) internal returns (ERC1155Instance inst) {
        ERC1155Factory.CreateParams memory p = ERC1155Factory.CreateParams({
            name: "Editions",
            metadataURI: "ipfs://c",
            creator: artist,
            vault: address(vault),
            alignmentBps: 1900,
            styleUri: "",
            gatingModule: address(0),
            freeMint: FreeMintParams({ allocation: 0, scope: GatingScope.BOTH }),
            acceptedTokens: tokens
        });
        vm.prank(artist);
        inst = ERC1155Instance(payable(factory.createInstance(bytes32(++salt), p)));
    }

    /// Finding 1: minting one piece at maxCost = getCurrentPrice (ERC-20) or msg.value = getCurrentPrice (ETH)
    /// succeeds at every step of the curve.
    function test_F1_mintAtQuotedPrice_usdcAndEth() public {
        ERC1155Instance inst = _instance(_list(ETH, address(usdc)));
        TokenPrice[] memory prices = new TokenPrice[](2);
        prices[0] = TokenPrice(address(usdc), 1e6);
        prices[1] = TokenPrice(ETH, 1e15 + 1);
        vm.prank(artist);
        inst.addEdition("Rising", prices, 1000, "u", ERC1155Instance.PricingModel.LIMITED_DYNAMIC, 100, 0);

        _approve(alice, address(usdc), address(inst));
        vm.prank(alice);
        inst.mint(1, 7, bytes32(0), "", address(usdc), type(uint256).max);

        uint256 quote = inst.getCurrentPrice(1, address(usdc));
        assertEq(quote, inst.calculateMintCost(1, 1, address(usdc)));
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        inst.mint(1, 1, bytes32(0), "", address(usdc), quote);
        assertEq(before - usdc.balanceOf(alice), quote, "charged exactly the quote");

        for (uint256 i; i < 40; ++i) {
            uint256 q = inst.getCurrentPrice(1, ETH);
            vm.prank(bob);
            inst.mint{ value: q }(1, 1, bytes32(0), "", ETH, 0);
            q = inst.getCurrentPrice(1, address(usdc));
            vm.prank(alice);
            inst.mint(1, 1, bytes32(0), "", address(usdc), q);
        }
    }

    /// Finding 9: a module the registry revoked after setDynamicPricingModule is not installed in new instances.
    function test_F9_revokedPricingModuleLeftOutOfNewInstances() public {
        ERC1155Instance before_ = _instance(_list(ETH));
        assertEq(address(before_.dynamicPricingModule()), address(module));
        assertEq(factory.features().length, 2);

        registry.setComponent(address(module), false);
        ERC1155Instance inst = _instance(_list(ETH));
        assertEq(address(inst.dynamicPricingModule()), address(0), "revoked module not installed");
        assertEq(factory.features().length, 1, "dynamic pricing not advertised");
        vm.prank(artist);
        vm.expectRevert(NoDynamicPricingModule.selector);
        inst.addEdition("R", _one(ETH, 1 ether), 10, "u", ERC1155Instance.PricingModel.LIMITED_DYNAMIC, 100, 0);

        // Re-approved: installed again.
        registry.setComponent(address(module), true);
        assertEq(address(_instance(_list(ETH)).dynamicPricingModule()), address(module));
    }

    /// Finding 2 on an 1155: a vault cut parked in a delisted token is released to the owner.
    function test_F2_delistedTokenVaultCutReleased_1155() public {
        ERC1155Instance inst = _instance(_list(address(usdc)));
        vm.prank(artist);
        inst.addEdition("S", _one(address(usdc), 100e6), 0, "u", ERC1155Instance.PricingModel.UNLIMITED, 0, 0);
        _approve(alice, address(usdc), address(inst));
        vm.prank(alice);
        inst.mint(1, 1, bytes32(0), "", address(usdc), 100e6);

        registry.setPaymentToken(address(usdc), false);
        vault.setRejecting(true);
        inst.distribute(address(usdc));
        assertEq(inst.pendingVaultCut(address(usdc)), 19e6);

        inst.flushPendingVaultCut(address(usdc), 0);
        assertEq(inst.pendingVaultCut(address(usdc)), 0);
        assertEq(inst.ownerBalance(address(usdc)), 99e6);
        uint256 b = usdc.balanceOf(artist);
        vm.prank(artist);
        inst.withdrawAll();
        assertEq(usdc.balanceOf(artist) - b, 99e6);
        assertEq(usdc.balanceOf(address(inst)), 0);
    }

    /// Finding 3 (same rule on every collection): ETH reaching a collection that never accepted it is sweepable.
    function test_F3_strayEthSweepable_1155WithoutEth() public {
        ERC1155Instance inst = _instance(_list(address(usdc)));
        vm.deal(alice, 2 ether);
        vm.prank(alice);
        (bool ok,) = address(inst).call{ value: 1 ether }("");
        assertTrue(ok);
        inst.sweepUntracked(ETH);
        assertEq(inst.unsplitProceeds(ETH), 1 ether);
        assertEq(inst.knownTokens().length, 2, "ETH now walked by withdrawAll");
        uint256 b = artist.balance;
        vm.prank(artist);
        inst.withdrawAll();
        assertEq(artist.balance - b, 0.8 ether);
        assertEq(vault.received(ETH), 0.19 ether);
        assertEq(treasury.balance, 0.01 ether);
    }
}

/// @notice Audit c89f023c finding 2 on drops: a delisted token's parked vault cut has an exit, to the artist only.
contract DropAuditRegressionsTest is PaymentTestBase {
    ERC721DropFactory factory;

    function setUp() public {
        _setUpPayments();
        factory = new ERC721DropFactory(IMiyaRegistry(address(registry)), address(0));
    }

    function _drop() internal returns (ERC721DropInstance d) {
        ERC721DropInstance.Phase[] memory phases = new ERC721DropInstance.Phase[](1);
        phases[0].start = uint64(block.timestamp);
        phases[0].prices = _one(address(usdc), 100e6);
        ERC721DropInstance.InitParams memory p;
        p.name = "d";
        p.symbol = "D";
        p.maxSupply = 100;
        p.acceptedTokens = _list(address(usdc));
        p.phases = phases;
        vm.prank(artist);
        d = ERC721DropInstance(payable(factory.createDrop(p, address(vault), 1900)));
        _approve(alice, address(usdc), address(d));
        vm.prank(alice);
        d.mint(0, 1, new bytes32[](0), address(usdc), 100e6);
    }

    function test_F2_delistedTokenStrandsVaultCut_fixed() public {
        ERC721DropInstance d = _drop();
        registry.setPaymentToken(address(usdc), false);
        vault.setRejecting(true); // the real vault refuses a non-allowlisted token (TokenNotAllowed)
        d.distribute(address(usdc));
        assertEq(usdc.balanceOf(treasury), 1e6);
        assertEq(d.ownerBalance(address(usdc)), 80e6);
        assertEq(d.pendingVaultCut(address(usdc)), 19e6);

        // No top-up into a release.
        vm.expectRevert(PaymentLib.WrongValue.selector);
        d.flushPendingVaultCut(address(usdc), 1);

        vm.expectEmit(true, false, false, true, address(d));
        emit PaymentLib.VaultCutReleased(address(usdc), 19e6);
        vm.prank(makeAddr("anyone"));
        d.flushPendingVaultCut(address(usdc), 0);
        assertEq(d.pendingVaultCut(address(usdc)), 0);
        assertEq(d.ownerBalance(address(usdc)), 99e6);

        uint256 b = usdc.balanceOf(artist);
        vm.prank(artist);
        d.withdrawAll();
        assertEq(usdc.balanceOf(artist) - b, 99e6);
        assertEq(usdc.balanceOf(address(d)), 0, "nothing stranded");
    }

    /// While the token is allowed, a refused vault cut only ever goes to the vault: flushing reverts, nothing moves.
    function test_F2_allowedTokenVaultCutNeverReleased() public {
        ERC721DropInstance d = _drop();
        vault.setRejecting(true);
        d.distribute(address(usdc));
        assertEq(d.pendingVaultCut(address(usdc)), 19e6);
        vm.expectRevert();
        d.flushPendingVaultCut(address(usdc), 0);
        assertEq(d.pendingVaultCut(address(usdc)), 19e6);
        assertEq(d.ownerBalance(address(usdc)), 80e6);

        vault.setRejecting(false);
        d.flushPendingVaultCut(address(usdc), 0);
        assertEq(vault.received(address(usdc)), 19e6);
        assertEq(d.ownerBalance(address(usdc)), 80e6);
    }

    /// Re-listed before anyone flushed: the cut goes to the vault as usual.
    function test_F2_relistedBeforeFlushGoesToVault() public {
        ERC721DropInstance d = _drop();
        registry.setPaymentToken(address(usdc), false);
        vault.setRejecting(true);
        d.distribute(address(usdc));
        registry.setPaymentToken(address(usdc), true);
        vault.setRejecting(false);
        d.flushPendingVaultCut(address(usdc), 0);
        assertEq(vault.received(address(usdc)), 19e6);
        assertEq(d.ownerBalance(address(usdc)), 80e6);
    }

    /// ETH is always allowed, so a parked ETH cut is never released.
    function test_F2_ethCutNeverReleased() public {
        ERC721DropInstance.Phase[] memory phases = new ERC721DropInstance.Phase[](1);
        phases[0].start = uint64(block.timestamp);
        phases[0].prices = _one(ETH, 1 ether);
        ERC721DropInstance.InitParams memory p;
        p.name = "e";
        p.symbol = "E";
        p.maxSupply = 10;
        p.acceptedTokens = _list(ETH);
        p.phases = phases;
        vm.prank(artist);
        ERC721DropInstance d = ERC721DropInstance(payable(factory.createDrop(p, address(vault), 1900)));
        vm.prank(alice);
        d.mint{ value: 1 ether }(0, 1, new bytes32[](0), ETH, 1 ether);
        vault.setRejecting(true);
        d.distribute(ETH);
        vm.expectRevert();
        d.flushPendingVaultCut(ETH, 0);
        assertEq(d.pendingVaultCut(ETH), 0.19 ether);
    }

    /// Finding 3 (same rule on drops): stray ETH on a drop that never accepted ETH is sweepable without the owner.
    function test_F3_strayEthSweepable_dropWithoutEth() public {
        ERC721DropInstance d = _drop();
        vm.prank(alice);
        (bool ok,) = address(d).call{ value: 1 ether }("");
        assertTrue(ok);
        d.sweepUntracked(ETH);
        assertEq(d.unsplitProceeds(ETH), 1 ether);
        // Any other token the drop never accepted is still refused.
        vm.expectRevert(abi.encodeWithSelector(PaymentLib.TokenNotAccepted.selector, address(wbtc)));
        d.sweepUntracked(address(wbtc));
    }
}

/// @notice Audit c89f023c findings 3 and 5 on auction houses.
contract AuctionAuditRegressionsTest is PaymentTestBase {
    ERC721AuctionFactory factory;
    uint256 salt;

    function setUp() public {
        _setUpPayments();
        factory = new ERC721AuctionFactory(IMiyaRegistry(address(registry)), makeAddr("weth"));
    }

    function _auction(address currency) internal returns (ERC721AuctionInstance a) {
        ERC721AuctionFactory.CreateParams memory p = ERC721AuctionFactory.CreateParams({
            name: "One of one",
            metadataURI: "ipfs://m",
            creator: artist,
            vault: address(vault),
            alignmentBps: 1900,
            symbol: "OOO",
            lines: 1,
            baseDuration: 1 hours,
            timeBuffer: 5 minutes,
            bidIncrement: 1,
            currency: currency
        });
        vm.prank(artist);
        a = ERC721AuctionInstance(payable(factory.createInstance(bytes32(++salt), p)));
    }

    /// Finding 3: ETH sent to an ERC-20 auction house is swept and split like a sale, then withdrawn.
    function test_F3_strayEthOnErc20AuctionSweptAndSplit() public {
        ERC721AuctionInstance a = _auction(address(usdc));
        vm.prank(alice);
        (bool ok,) = address(a).call{ value: 1 ether }("");
        assertTrue(ok);

        vm.prank(makeAddr("anyone"));
        a.sweepUntracked(ETH);
        assertEq(treasury.balance, 0.01 ether);
        assertEq(vault.received(ETH), 0.19 ether);
        assertEq(a.ownerBalance(ETH), 0.8 ether);
        assertEq(address(a).balance, 0.8 ether);

        uint256 b = artist.balance;
        vm.prank(artist);
        a.withdrawAll();
        assertEq(artist.balance - b, 0.8 ether);
        assertEq(address(a).balance, 0);

        vm.expectRevert(PaymentLib.NothingToWithdraw.selector);
        a.sweepUntracked(ETH);
        vm.expectRevert(abi.encodeWithSelector(PaymentLib.TokenNotAccepted.selector, address(wbtc)));
        a.sweepUntracked(address(wbtc));
    }

    /// Finding 3: withdrawAll on an ERC-20 house still pays the currency, and ETH via withdraw(address(0)).
    function test_F3_withdrawAllPaysCurrencyAndSweptEth() public {
        ERC721AuctionInstance a = _auction(address(usdc));
        vm.prank(alice);
        (bool ok,) = address(a).call{ value: 1 ether }("");
        assertTrue(ok);
        a.sweepUntracked(ETH);
        usdc.mint(address(a), 100e6);
        a.sweepUntracked(address(usdc));
        uint256 e = artist.balance;
        uint256 u = usdc.balanceOf(artist);
        vm.prank(artist);
        a.withdrawAll();
        assertEq(artist.balance - e, 0.8 ether);
        assertEq(usdc.balanceOf(artist) - u, 80e6);
    }

    /// Finding 5 (documented behaviour): an ETH auction pushes the deposit and the artist's share at settlement.
    function test_F5_ethAuctionPushesOwnerShare() public {
        ERC721AuctionInstance a = _auction(ETH);
        vm.prank(artist);
        a.queuePiece{ value: 1 ether }("ar://piece", 1 ether);
        uint24 id = a.nextTokenId() - 1;
        vm.prank(alice);
        a.createBid{ value: 2 ether }(id, 2 ether, "");
        vm.warp(block.timestamp + 2 hours);
        uint256 b = artist.balance;
        a.settleAuction(id);
        assertEq(a.ownerBalance(ETH), 0, "never credited");
        assertEq(artist.balance - b, 1 ether + 1.6 ether, "deposit and share pushed");
        assertEq(a.escrowed(ETH), 0);
    }

    /// Finding 2 on an ERC-20 auction: a vault cut parked in a delisted currency is released to the owner.
    function test_F2_delistedCurrencyVaultCutReleased_auction() public {
        ERC721AuctionInstance a = _auction(address(usdc));
        usdc.mint(address(a), 100e6);
        registry.setPaymentToken(address(usdc), false);
        vault.setRejecting(true);
        a.sweepUntracked(address(usdc));
        assertEq(a.pendingVaultCut(address(usdc)), 19e6);
        a.flushPendingVaultCut(address(usdc), 0);
        assertEq(a.ownerBalance(address(usdc)), 99e6);
        assertEq(a.pendingVaultCut(address(usdc)), 0);
    }
}
