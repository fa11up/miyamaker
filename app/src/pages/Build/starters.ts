/**
 * The three ideas miyanet offers under the swarm search. Each opens the Build window with a starter the person
 * finishes: the blanks are the facts INFER BOX would ask for anyway.
 */
export const STARTERS = [
  {
    label: 'launch a token',
    type: 'launch',
    idea: 'Launch a token on Ethereum. Name: ___. Ticker: ___. Fixed supply of ___, all minted to my wallet, with no owner controls after launch.',
  },
  {
    label: 'build a mint site',
    type: 'build',
    idea: 'Build a mint site for my NFT collection on Ethereum: ___ pieces at ___ ETH each, artwork at ___. One page with a connect button, the price and a mint button.',
  },
  {
    label: 'audit my contract',
    type: 'build',
    idea: 'Audit my smart contract at ___ (a GitHub link or a verified Ethereum address). Report anything that could lose funds or lock users out, with how to fix it.',
  },
] as const

export type BuildType = '' | 'question' | 'build' | 'launch'

/** Build lives inside the miyanet window, at /about/build. */
export const BUILD_PATH = '/about/build'
export const buildPath = (idea: string, type: BuildType = '') =>
  `${BUILD_PATH}?${new URLSearchParams({ idea, ...(type ? { type } : {}) }).toString()}`
