"use strict";

const basePath = process.cwd();
const { MODE } = require(`${basePath}/constants/blend_mode.js`);
const { NETWORK } = require(`${basePath}/constants/network.js`);

const network = NETWORK.eth;

const namePrefix = "Miladykaki";
const description = "Miladykakis is a collection of generative pfpNFTs in a silly chibi aesthetic inspired by street style tribes, lainpilled internet dreams, and artisanal AI synthesis. Each piece is created from Milady inputs reimagined through an Oekaki-inspired checkpoint model, generating new Milady-adjacent AI outputs refined through a selective curatorial process. Some metadata traits may not be visibly present in the final artwork, but they remain tied to the original Milady input used for that specific piece, functioning as provenance memory rather than simple surface description. Miladykakis is a chibi-conscious experiment in memetic economics, digital identity, and network cohesion: a playful onchain tribe where cute chaos, AI hallucination, human curation, street-style culture, and post-internet spirituality converge into one tiny infinite aesthetic ritual.";
const baseUri = "ipfs://bafybeic5yxtsyokpmlkzqyxx7rtyvm7apmkm52byjh6fqu5wm45kpvelem";

const solanaMetadata = {
  symbol: "MNFT",
  seller_fee_basis_points: 0,
  external_url: "https://www.oekakimaker.net/",
  creators: [{ address: "YOUR_SOLANA_WALLET_HERE", share: 100 }],
};

const layerConfigurations = [
  {
    name: "Default",
    editionCount: 1000,
    growEditionSizeTo: 1000,
    layersOrder: [
      { name: "Background", options: { bypassDNA: true } },
      { name: "Skin" },
      { name: "Brows" },
      { name: "Eyes" },
      { name: "Face" },
      { name: "Mouth" },
      { name: "Face Decoration" },
      { name: "Glasses" },
      { name: "Hair" },
      { name: "Hat" },
      { name: "custom 4 Charli" },
      { name: "Earrings" },
      { name: "Neck" },
      { name: "Necklaces" },
      { name: "Shirt" },
      { name: "Overlay" }
    ]
  }
];

const shuffleLayerConfigurations = false;
const debugLogging = false;

const preview = {
  thumbPerRow: 5,
  thumbWidth: 50,
  imageRatio: 1.0000,
  imageName: "preview.gif",
};

const preview_gif = {
  numberOfImages: 5,
  order: "ASC",
  repeat: 0,
  quality: 100,
  delay: 500,
  imageName: "preview.gif",
};

const format = { width: 512, height: 512, smoothing: true };
const outputJPEG = false;

const background = {
  generate: true,
  brightness: "80%",
  static: false,
  default: "#000000",
};

const extraAttributes = () => ([

]);

const extraMetadata = {};

const incompatible = {

};

const forcedCombinations = {

};

const requiresRules = {

};

const traitValueOverrides = {

};

const hashImages = true;
const emptyLayerName = "NONE";
const startEditionFrom = 1;
const uniqueDnaTorrance = 1000;
const useRootTraitType = true;

module.exports = {
  format, baseUri, description, background, uniqueDnaTorrance,
  layerConfigurations, shuffleLayerConfigurations, debugLogging,
  extraAttributes, extraMetadata, incompatible, forcedCombinations, requiresRules,
  traitValueOverrides, emptyLayerName, startEditionFrom,
  preview, preview_gif, hashImages, useRootTraitType,
  outputJPEG, network, solanaMetadata, namePrefix,
};
