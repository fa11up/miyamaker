"use strict";

const fs = require("fs").promises;
const path = require("path");
const { generateWithMock } = require("./aiChef/providers/mockProvider.js");
const {
  generateWithDiffusionBee,
  getDiffusionBeeStatus,
  cancelDiffusionBeeGeneration,
  resetDiffusionBeeCancellation,
} = require("./aiChef/providers/diffusionbeeProvider.js");

const SUPPORTED_PROVIDERS = ["diffusionbee", "mock"];

function requestedProvider() {
  const requested = String(process.env.AI_CHEF_PROVIDER || "diffusionbee").trim().toLowerCase();
  return SUPPORTED_PROVIDERS.includes(requested) ? requested : "diffusionbee";
}

function allowMockFallback(options = {}) {
  return Boolean(options.allowMockFallback)
    || process.env.AI_CHEF_ALLOW_MOCK_FALLBACK === "1"
    || process.env.AI_CHEF_ALLOW_MOCK_FALLBACK === "true";
}

async function getProviderStatus(options = {}) {
  const requested = requestedProvider();
  const diffusionbee = await getDiffusionBeeStatus(options);

  if (requested === "mock") {
    return {
      requestedProvider: requested,
      provider: "mock",
      fallback: false,
      fallbackReason: "",
      diffusionbee,
    };
  }

  if (diffusionbee.ready) {
    return {
      requestedProvider: requested,
      provider: "diffusionbee",
      fallback: false,
      fallbackReason: "",
      diffusionbee,
    };
  }

  if (allowMockFallback(options)) {
    return {
      requestedProvider: requested,
      provider: "mock",
      fallback: true,
      fallbackReason: diffusionbee.error || "DiffusionBee provider is unavailable",
      diffusionbee,
    };
  }

  return {
    requestedProvider: requested,
    provider: "diffusionbee",
    fallback: false,
    fallbackReason: diffusionbee.error || "DiffusionBee provider is unavailable",
    diffusionbee,
  };
}

function assertSafeOutput(inputImagePath, outputPath) {
  if (!inputImagePath || !outputPath) throw new Error("inputImagePath and outputPath are required");
  const inFull = path.resolve(inputImagePath);
  const outFull = path.resolve(outputPath);
  if (inFull === outFull) throw new Error("Output path cannot overwrite the source image");
}

async function generateImageFromImage({ inputImagePath, prompt, mode, outputPath, metadata, options = {} }) {
  assertSafeOutput(inputImagePath, outputPath);
  const cleanPrompt = String(prompt || "").trim();
  if (!cleanPrompt) throw new Error("prompt is required");

  await fs.access(inputImagePath);
  const status = await getProviderStatus(options);

  if (status.provider === "mock") {
    return generateWithMock({
      inputImagePath,
      prompt: cleanPrompt,
      mode,
      outputPath,
      metadata,
      fallbackReason: status.fallbackReason,
    });
  }

  if (status.fallbackReason && !status.diffusionbee?.ready) {
    throw new Error(status.fallbackReason);
  }

  return generateWithDiffusionBee({
    inputImagePath,
    prompt: cleanPrompt,
    mode,
    outputPath,
    metadata,
    options,
  });
}

function stopAiChefGeneration(reason = "AI Chef generation cancelled") {
  return {
    diffusionbee: cancelDiffusionBeeGeneration(reason),
    mock: { activeJobsCancelled: 0, processesSignalled: 0 },
  };
}

function resetAiChefCancellation() {
  resetDiffusionBeeCancellation();
}

module.exports = {
  generateImageFromImage,
  getProviderStatus,
  stopAiChefGeneration,
  resetAiChefCancellation,
  providers: {
    diffusionbee: generateWithDiffusionBee,
    mock: generateWithMock,
  },
};
