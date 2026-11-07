/**
 * A failed chunk import stays rejected inside React.lazy, so only a page reload gets past it. Each browser words it
 * differently: Chrome and Firefox name the dynamic import, Safari says "Importing a module script failed".
 */
export const isChunkLoadError = (message: string) =>
  /dynamically imported module|importing a module script failed|loading chunk|unable to preload css/i.test(message)
