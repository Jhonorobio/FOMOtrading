/**
 * Market data client for the paper server.
 * Primary source: telemetry.io (live prices, batch-capable, requires Bearer token).
 * Fallback: DexScreener public API (no key required, slower updates).
 * No connection to FOMO's private trading endpoints.
 */
const DEXSCREENER_BASE = 'https://api.dexscreener.com/latest/dex';
const TELEMETRY_BASE = 'https://app.telemetry.io/data/market_data_batch';
export const TELEMETRY_TOKEN = process.env.TELEMETRY_BEARER_TOKEN || '';

/* ---------------------------------------------------------------- */
/* Telemetry.io                                                     */
/* ---------------------------------------------------------------- */

/** Fetch quotes for one or more mints from telemetry.io in a single batch request. */
async function fetchTelemetryBatch(mints) {
  if (!TELEMETRY_TOKEN || !mints.length) return {};
  const qs = mints.map((m) => `mint=${encodeURIComponent(m)}`).join('&');
  const url = `${TELEMETRY_BASE}?${qs}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${TELEMETRY_TOKEN}`,
    },
  });
  if (!res.ok) throw new Error(`TELEMETRY_ERROR:${res.status}`);
  return await res.json();
}

/** Normalise a telemetry.io response item into the Quote shape the extension expects. */
function normalizeTelemetryItem(item, address) {
  if (!item) return null;
  // telemetry.io response shape is not fixed; read common candidates defensively.
  const priceUsd =
    Number(item.priceUsd ?? item.price ?? item.lastPrice ?? item.marketPrice ?? 0);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;

  const symbol =
    item.symbol || item.baseToken?.symbol || item.mint || address.slice(0, 6).toUpperCase();

  return {
    assetId: item.pairAddress || item.assetId || `solana:${address}`,
    chainId: item.chainId || item.chain || 'solana',
    address,
    symbol,
    name: item.name || item.baseToken?.name || symbol,
    imageUrl: item.imageUrl || item.baseToken?.imageUrl || null,
    priceUsd,
    liquidityUsd: item.liquidity?.usd ?? item.liquidityUsd ?? null,
    marketCapUsd: item.marketCap ?? item.marketCapUsd ?? null,
    change24hPct: item.priceChange?.h24 ?? item.change24hPct ?? null,
    source: 'telemetry',
    fetchedAt: new Date().toISOString(),
  };
}

/* ---------------------------------------------------------------- */
/* DexScreener (fallback)                                           */
/* ---------------------------------------------------------------- */

export async function fetchDexScreenerQuote(chainId, address) {
  const url = `${DEXSCREENER_BASE}/tokens/${encodeURIComponent(chainId)}/${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    if (res.status === 429) throw new Error('MARKET_DATA_RATE_LIMITED');
    throw new Error(`MARKET_DATA_ERROR:${res.status}`);
  }
  const data = await res.json();
  const pairs = data.pairs || [];
  if (!pairs.length) throw new Error('ASSET_NOT_FOUND');

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

export async function fetchPriceHistory(chainId, address, from, to) {
  return { points: [], from: from || new Date().toISOString(), to: to || new Date().toISOString() };
}

/* ---------------------------------------------------------------- */
/* Public API                                                       */
/* ---------------------------------------------------------------- */

/**
 * Fetch a quote for a token. Tries telemetry.io first (if configured),
 * falls back to DexScreener.
 */
export async function fetchQuote(chainId, address) {
  // Try telemetry.io batch with a single mint.
  if (TELEMETRY_TOKEN) {
    try {
      const batch = await fetchTelemetryBatch([address]);
      const items = Array.isArray(batch) ? batch : batch.data ?? batch.items ?? batch[address] ?? {};
      const item = Array.isArray(items) ? items.find((i) => String(i.address ?? i.mint ?? '').toLowerCase() === address.toLowerCase()) : items;
      const q = normalizeTelemetryItem(item, address);
      if (q) return q;
      throw new Error('TELEMETRY_EMPTY');
    } catch (err) {
      console.warn('[market-data] telemetry failed for', address, '- falling back to dexscreener', err.message);
    }
  }
  return fetchDexScreenerQuote(chainId, address);
}

/**
 * Fetch quotes for multiple mints in one batch request (telemetry.io).
 * Returns a map of address -> Quote. Falls back to DexScreener per-mint on failure.
 */
export async function fetchQuotesBatch(addresses) {
  if (!addresses.length) return {};

  if (TELEMETRY_TOKEN) {
    try {
      const batch = await fetchTelemetryBatch(addresses);
      const items = Array.isArray(batch) ? batch : batch.data ?? batch.items ?? {};
      const map = {};
      for (const item of items) {
        const addr = String(item.address ?? item.mint ?? '');
        const q = normalizeTelemetryItem(item, addr);
        if (q) map[addr] = q;
      }
      // Fill missing addresses with DexScreener fallback.
      const missing = addresses.filter((a) => !map[a]);
      for (const addr of missing) {
        try {
          map[addr] = await fetchDexScreenerQuote('solana', addr);
        } catch {
          // leave missing
        }
      }
      return map;
    } catch (err) {
      console.warn('[market-data] telemetry batch failed, falling back per-mint to dexscreener', err.message);
    }
  }

  const map = {};
  for (const addr of addresses) {
    try {
      map[addr] = await fetchDexScreenerQuote('solana', addr);
    } catch {
      // leave missing
    }
  }
  return map;
}
