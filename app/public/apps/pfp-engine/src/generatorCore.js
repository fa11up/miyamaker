"use strict";

function cleanTraitName(name) {
  return String(name || "")
    .replace(/\.(png|jpg|jpeg|gif|webp)$/i, "")
    .replace(/#.*$/, "");
}

function extractWeight(name) {
  const m = String(name || "").match(/#(\d+(?:\.\d+)?)/);
  const weight = m ? Number(m[1]) : 1;
  return Number.isFinite(weight) && weight > 0 ? weight : 1;
}

function createRng(seed) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < String(seed).length; i++) {
    h ^= String(seed).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return function rng() {
    h += 0x6D2B79F5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedPick(items, rng = Math.random) {
  const total = items.reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
  if (!items.length || total <= 0) return null;
  let roll = rng() * total;
  for (const item of items) {
    roll -= Number(item.weight) || 0;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

function traitKey(layer, trait) {
  return `${layer}::${trait}`;
}

function dnaFromTraits(traits) {
  return traits
    .filter(t => !t.bypassDNA)
    .map(t => traitKey(t.traitType, t.traitValue))
    .sort()
    .join("|");
}

function normalizeRuleMap(map) {
  const out = {};
  Object.entries(map || {}).forEach(([key, values]) => {
    out[key] = Array.isArray(values) ? values.map(String) : [];
  });
  return out;
}

function isIncompatible(selected, candidate, incompatible) {
  const map = normalizeRuleMap(incompatible);
  const names = selected.map(t => t.traitValue);
  return names.some(name => {
    const blocked = map[name] || [];
    return blocked.includes(candidate.traitValue) || blocked.includes(`${name}:${candidate.traitValue}`);
  });
}

function getForcedTargets(selected, forcedCombinations) {
  const map = normalizeRuleMap(forcedCombinations);
  const names = new Set(selected.map(t => t.traitValue));
  const forced = new Set();
  names.forEach(name => (map[name] || []).forEach(v => forced.add(String(v).split(":").pop())));
  return forced;
}

function resolveLayerChoice(layer, candidates, selected, rules, rng = Math.random) {
  const forcedTargets = getForcedTargets(selected, rules.forcedCombinations);
  const forced = candidates.find(c => forcedTargets.has(c.traitValue));
  if (forced) return forced;

  const compatible = candidates.filter(c => !isIncompatible(selected, c, rules.incompatible));
  return weightedPick(compatible.length ? compatible : candidates, rng);
}

module.exports = {
  cleanTraitName,
  createRng,
  dnaFromTraits,
  extractWeight,
  resolveLayerChoice,
  traitKey,
  weightedPick,
};
