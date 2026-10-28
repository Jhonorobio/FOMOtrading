/**
 * Market data client for the paper server.
 * Uses the public DexScreener API (no key required) so the extension gets live
 * prices without talking to FOMO's private trading endpoints.
 */
const DEXSCREENER_BASE = 'https://api.dexscreener.com/latest/dex';

/**
 * Fetch a quote for a token on a chain.
 * @param {string} chainId  e.g. 'solana', 'base', 'bsc', 'ethereum'
 * @param {string} address  token mint / contract address
 * @returns {Promise<import('../src/integrations/target-terminal/types').Quote>}
 */
export async function fetchQuote(chainId, address) {
  const url = `${DEXSCREENER_BASE}/tokens/${encodeURIComponent(chainId)}/${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    if (res.status === 429) throw new Error('MARKET_DATA_RATE_LIMITED');
    throw new Error(`MARKET_DATA_ERROR:${res.status}`);
  }
  const data = await res.json();
  const pairs = data.pairs || [];
  if (!pairs.length) throw new Error('ASSET_NOT_FOUND');

  // Prefer the pair with the highest liquidity (most representative price).
  const pair = pairs.reduce(
    (best, p) => (p.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0) ? p : best,
    pairs[0]
  );

  const priceUsd = Number(pair.priceUsd);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) throw new Error('ASSET_NOT_FOUND');

  return {
    assetId: pair.pairAddress || `${chainId}:${address}`,
    chainId,
    address,
    symbol: pair.baseToken?.symbol || address.slice(0, 6).toUpperCase(),
    name: pair.baseToken?.name || pair.baseToken?.symbol || pair.baseToken?.symbol,
    imageUrl: pair.baseToken?.imageUrl || null,
    priceUsd,
    liquidityUsd: pair.liquidity?.usd ?? null,
    marketCapUsd: pair.marketCap ?? null,
    change24hPct: pair.priceChange?.h24 ?? null,
    source: 'dexscreener',
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Price history for a token. DexScreener's free public API doesn't serve
 * historical candles without a paid plan, so we return an empty series.
 * The extension renders a placeholder chart when history is null/empty.
 */
export async function fetchPriceHistory(chainId, address, from, to) {
  // Intentional stub: no historical market data from the free provider.
  return { points: [], from: from || new Date().toISOString(), to: to || new Date().toISOString() };
}
