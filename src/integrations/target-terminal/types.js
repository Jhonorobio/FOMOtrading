/**
 * @typedef {Object} TargetAsset
 * @property {string} chain     Chain slug from the terminal URL (solana, base, bsc, ...).
 * @property {string} address   Token address from the terminal URL.
 * @property {string|null} symbol  Ticker read from the page ("Buy GCAT"), used only to cross-check market data.
 * @property {'url'|'manual'} source
 */

/**
 * @typedef {Object} Quote
 * @property {string} assetId
 * @property {string} chainId
 * @property {string} address
 * @property {string} symbol
 * @property {string} name
 * @property {string|null} imageUrl
 * @property {number} priceUsd
 * @property {number|null} liquidityUsd
 * @property {number|null} marketCapUsd
 * @property {number|null} change24hPct
 * @property {string} source
 * @property {string} fetchedAt
 */

/**
 * @typedef {Object} TargetTerminalAdapter
 * @property {() => TargetAsset|null} getCurrentAsset
 * @property {() => string|null} getSymbol
 * @property {() => Element|null} findTradePanel
 * @property {(asset: TargetAsset) => Promise<Quote>} getCurrentPrice
 * @property {(asset: TargetAsset) => Promise<Quote>} getMarketData
 */

export {};
