import { fetchQuote } from './market-data.js';
import { findTradePanel, LEGACY_TOKEN_PATH, readSymbol, TOKEN_PATH } from './selectors.js';

// FOMO's numeric network ids (used by legacy ?chainId= links).
const NETWORK_SLUGS = { 1399811149: 'solana', 8453: 'base', 56: 'bsc', 1: 'ethereum', 143: 'monad', 5042: 'arc', 4663: 'robinhood' };

/** Pure URL parser so it can be reused by the side panel for the active tab. */
export function parseAssetFromUrl(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.hostname !== 'fomo.family' && !url.hostname.endsWith('.fomo.family')) return null;

  const match = TOKEN_PATH.exec(url.pathname);
  if (match) return { chain: match[1].toLowerCase(), address: match[2], symbol: null, source: 'url' };

  if (LEGACY_TOKEN_PATH.test(url.pathname)) {
    const address = url.searchParams.get('address') || url.searchParams.get('tokenAddress');
    const chain = NETWORK_SLUGS[url.searchParams.get('chainId')] || url.searchParams.get('chain');
    if (address && chain) return { chain, address, symbol: null, source: 'url' };
  }
  return null;
}

/**
 * Accepts a FOMO token URL, a DexScreener URL, or "chain:address".
 * Used by the manual "Enter asset" fallback.
 */
export function parseManualAsset(input) {
  const value = String(input || '').trim();
  const fromFomo = parseAssetFromUrl(value);
  if (fromFomo) return { ...fromFomo, source: 'manual' };
  const dex = /dexscreener\.com\/([a-z0-9-]+)\/([A-Za-z0-9]{20,66})/i.exec(value);
  if (dex) return { chain: dex[1].toLowerCase(), address: dex[2], symbol: null, source: 'manual' };
  const pair = /^([a-z0-9-]+):([A-Za-z0-9]{20,66})$/i.exec(value);
  if (pair) return { chain: pair[1].toLowerCase(), address: pair[2], symbol: null, source: 'manual' };
  return null;
}

/** @returns {import('./types.js').TargetTerminalAdapter & { ignore: (el: Element) => void }} */
export function createTargetTerminalAdapter() {
  let ignored = null;
  return {
    /** Our own overlay must never be mistaken for FOMO's panel. */
    ignore(el) {
      ignored = el;
    },
    getCurrentAsset() {
      const asset = parseAssetFromUrl(location.href);
      if (!asset) return null;
      return { ...asset, symbol: readSymbol(findTradePanel(ignored)) };
    },
    getSymbol() {
      return readSymbol(findTradePanel(ignored));
    },
    findTradePanel() {
      return findTradePanel(ignored);
    },
    getCurrentPrice: fetchQuote,
    getMarketData: fetchQuote,
  };
}
