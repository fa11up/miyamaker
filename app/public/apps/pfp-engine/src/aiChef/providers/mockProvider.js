"use strict";

const fs = require("fs").promises;

async function generateWithMock({ inputImagePath, prompt, mode, outputPath, metadata, fallbackReason }) {
  await fs.copyFile(inputImagePath, outputPath);
  return {
    provider: "mock",
    mode,
    outputPath,
    metadata: {
      ...(metadata || {}),
      aiChef: {
        provider: "mock",
        prompt,
        fallbackReason: fallbackReason || "",
      },
    },
  };
}

module.exports = { generateWithMock };
