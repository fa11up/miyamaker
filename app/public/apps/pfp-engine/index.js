"use strict";

const fs = require("fs");
const path = require("path");

const root = __dirname;
const buildDir = path.join(root, "build");
const configPath = path.join(root, "src", "config.js");

function main() {
  fs.mkdirSync(path.join(buildDir, "images"), { recursive: true });
  fs.mkdirSync(path.join(buildDir, "json"), { recursive: true });

  if (!fs.existsSync(configPath)) {
    console.error("Missing src/config.js. Save a configuration from the GUI first.");
    process.exitCode = 1;
    return;
  }

  const config = require(configPath);
  const total = (config.layerConfigurations || []).reduce((sum, scenario) => {
    return sum + Number(scenario.editionCount || scenario.growEditionSizeTo || 0);
  }, 0);

  console.log("Engine entrypoint is installed.");
  console.log("This project uses the GUI compositor for image rendering so it can run without native canvas dependencies.");
  console.log(`Configured target editions: ${total || config.uniqueDnaTorrance || 0}`);
  console.log("Open http://localhost:3000 and use Generate to compose, save, analyze, and edit the collection.");
}

main();
