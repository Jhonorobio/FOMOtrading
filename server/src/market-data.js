/**
 * Market data client for the paper server.
 * Primary source: telemetry.io (live prices, batch-capable, requires Bearer token).
 * Fallback: DexScreener public API (no key required, slower updates).
 * No connection to FOMO's private trading endpoints.
 */
const DEXSCREENER_BASE = 'https://api.dexscreener.com/latest/dex';
const TELEMETRY_BASE = 'https://app.telemetry.io/data/market_data_batch';
export const TELEMETRY_TOKEN = process.env.TELEMETRY_BEARER_TOKEN || '';

/** In-memory cache of token logos as data: URLs (chain:address -> dataUrl). */
const logoCache = new Map();

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
  // telemetry.io response fields (verified against live API):
  // mint, symbol, name, price_usd, market_cap_usd, liquidity_usd, image, decimals, ...
  const priceUsd = Number(item.price_usd ?? item.priceUsd ?? 0);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;

  const symbol = item.symbol || address.slice(0, 6).toUpperCase();

  return {
    assetId: item.mint || `solana:${address}`,
    chainId: 'solana',
    address: item.mint || address,
    symbol,
    name: item.name || symbol,
    imageUrl: item.image || null,
    priceUsd,
    liquidityUsd: Number(item.liquidity_usd ?? 0) || null,
    marketCapUsd: Number(item.market_cap_usd ?? 0) || null,
    change24hPct: null, // telemetry batch endpoint doesn't include 24h change directly
    source: 'telemetry',
    fetchedAt: new Date().toISOString(),
  };
}

/* ---------------------------------------------------------------- */
/* DexScreener (fallback)                                           */
/* ---------------------------------------------------------------- */

const DEX_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PaperTerminal/1.0',
};

export async function fetchDexScreenerQuote(chainId, address) {
  // DexScreener's current endpoint takes token address(es) without chainId in the URL.
  const url = `${DEXSCREENER_BASE}/tokens/${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: DEX_HEADERS });
  if (!res.ok) {
    if (res.status === 429) throw new Error('MARKET_DATA_RATE_LIMITED');
    throw new Error(`MARKET_DATA_ERROR:${res.status}`);
  }
  const data = await res.json();
  const pairs = data.pairs || [];
  // Filter to the requested chain if possible, otherwise take the first.
  const chainPairs = pairs.filter((p) => p.chainId === chainId);
  const usable = chainPairs.length ? chainPairs : pairs;
  if (!usable.length) throw new Error('ASSET_NOT_FOUND');

  const pair = usable.reduce(
    (best, p) => (p.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0) ? p : best,
    usable[0]
  );

  const priceUsd = Number(pair.priceUsd);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) throw new Error('ASSET_NOT_FOUND');

  return {
    assetId: pair.pairAddress || `${chainId}:${address}`,
    chainId: pair.chainId || chainId,
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

/**
 * Fetch a token logo from telemetry.io and return it as a data: URL.
 * The extension runs on fomo.family whose CSP blocks external images but
 * allows data: images, so we download and re-encode the logo server-side.
 * @param {string} address  token mint address
 * @returns {Promise<string|null>} data: URL or null
 */
export async function fetchTokenLogo(address) {
  if (!TELEMETRY_TOKEN) return null;
  const key = address;
  if (logoCache.has(key)) return logoCache.get(key);

  try {
    const batch = await fetchTelemetryBatch([address]);
    const items = Array.isArray(batch) ? batch : batch.data ?? batch.items ?? {};
    const item = Array.isArray(items)
      ? items.find((i) => String(i.mint ?? i.address ?? '').toLowerCase() === address.toLowerCase())
      : items;
    const imageUrl = item?.image || item?.imageUrl;
    if (!imageUrl) return null;

    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'image/png';
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${contentType};base64,${base64}`;

    logoCache.set(key, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}
