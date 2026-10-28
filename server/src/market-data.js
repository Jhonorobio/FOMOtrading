/**
 * Market data client for the paper server.
 * Primary and only source: telemetry.io (live prices, batch-capable, requires Bearer token).
 * Access token is auto-refreshed from a long-lived refresh token.
 * No DexScreener, no connection to FOMO's private trading endpoints.
 */
const TELEMETRY_BASE = 'https://app.telemetry.io/data/market_data_batch';

import { getAccessToken, invalidateAccessToken, telemetryAuthStatus } from './services/telemetry-auth.js';

/** In-memory cache of token logos as data: URLs (chain:address -> dataUrl). */
const logoCache = new Map();

/* ---------------------------------------------------------------- */
/* Telemetry.io                                                     */
/* ---------------------------------------------------------------- */

/** Fetch quotes for one or more mints from telemetry.io in a single batch request. */
async function fetchTelemetryBatch(mints) {
  const token = await getAccessToken();
  if (!mints.length) return {};
  const qs = mints.map((m) => `mint=${encodeURIComponent(m)}`).join('&');
  const url = `${TELEMETRY_BASE}?${qs}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    // If the access token was rejected, invalidate so the next call knows it's expired.
    if (res.status === 401 || res.status === 403) invalidateAccessToken();
    throw new Error(`TELEMETRY_ERROR:${res.status}`);
  }
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
/* Public API                                                       */
/* ---------------------------------------------------------------- */

/**
 * Fetch a quote for a token. Only uses telemetry.io.
 * Throws ASSET_NOT_FOUND if the token has no price on telemetry.io.
 * On 401/403 invalidates the cached access token so the next call re-freshes.
 */
export async function fetchQuote(chainId, address) {
  try {
    const batch = await fetchTelemetryBatch([address]);
    const items = Array.isArray(batch) ? batch : batch.data ?? batch.items ?? {};
    const item = Array.isArray(items)
      ? items.find((i) => String(i.mint ?? i.address ?? '').toLowerCase() === address.toLowerCase())
      : items;
    const q = normalizeTelemetryItem(item, address);
    if (q) return q;
    throw new Error('ASSET_NOT_FOUND');
  } catch (err) {
    if (err.message === 'ASSET_NOT_FOUND') throw err;
    throw new Error(`MARKET_DATA_ERROR:${err.message}`);
  }
}

/**
 * Fetch quotes for multiple mints in one batch request (telemetry.io).
 * Returns a map of address -> Quote.
 */
export async function fetchQuotesBatch(addresses) {
  if (!addresses.length) return {};

  try {
    const batch = await fetchTelemetryBatch(addresses);
    const items = Array.isArray(batch) ? batch : batch.data ?? batch.items ?? {};
    const map = {};
    for (const item of items) {
      const addr = String(item.mint ?? item.address ?? '');
      const q = normalizeTelemetryItem(item, addr);
      if (q) map[addr] = q;
    }
    return map;
  } catch (err) {
    throw new Error(`MARKET_DATA_ERROR:${err.message}`);
  }
}

/**
 * Fetch a token logo from telemetry.io and return it as a data: URL.
 * The extension runs on fomo.family whose CSP blocks external images but
 * allows data: images, so we download and re-encode the logo server-side.
 * @param {string} address  token mint address
 * @returns {Promise<string|null>} data: URL or null
 */
export async function fetchTokenLogo(address) {
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

    logoCache.set(address, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

/** Expose auth status for diagnostics. */
export { telemetryAuthStatus, invalidateAccessToken };
