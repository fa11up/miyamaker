/** The GraphQL indexer is optional. When unset, indexer-backed sections show an empty state instead of erroring. */
export const GRAPHQL_URL: string | undefined = import.meta.env.VITE_GRAPHQL_URL || undefined
export const INDEXER_ENABLED = !!GRAPHQL_URL
/** The chain the indexer's collections live on (Ethereum unless set). */
export const INDEXER_CHAIN_ID: number = Number(import.meta.env.VITE_GRAPHQL_CHAIN_ID) || 1
