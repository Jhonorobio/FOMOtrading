/**
 * Market data client for the paper server.
 * Primary and only source: telemetry.io (live prices, batch-capable, requires Bearer token).
 * Access token is set via TELEMETRY_ACCESS_TOKEN env var or POST /api/market/telemetry/token.
 * When it expires (401), set a new one via the API endpoint — no server restart needed.
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
  const qs = `mint=${encodeURIComponent(mints.join(','))}`;
  const url = `${TELEMETRY_BASE}?${qs}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) invalidateAccessToken();
    if (res.status === 429) {
      console.warn('[market-data] telemetry.io returned 429 (rate limited)');
      throw new Error('TELEMETRY_ERROR:429');
    }
    throw new Error(`TELEMETRY_ERROR:${res.status}`);
  }
  return await res.json();
}

/** Normalise a telemetry.io response item into the Quote shape the extension expects. */
function normalizeTelemetryItem(item, address) {
  if (!item) return null;
  const priceUsd = Number(item.price_usd ?? item.priceUsd ?? 0);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;

  const symbol = item.symbol || address.slice(0, 6).toUpperCase();

  // Creation timestamp (nanoseconds -> ISO string)
  // Primary: created (token creation), Fallback: has_graduated_timestamp
  let createdAt = null;
  const createdTs = item.created || item.has_graduated_timestamp;
  if (createdTs) {
    const ms = Number(createdTs) > 1e15 ? Math.floor(Number(createdTs) / 1e6) : Number(createdTs);
    if (Number.isFinite(ms) && ms > 0) createdAt = new Date(ms).toISOString();
  }

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
    volume24hUsd: Number(item.volume_24h_usd ?? 0) || null,
    change24hPct: null,
    createdAt,
    hasGraduated: item.has_graduated ?? null,
    source: 'telemetry',
    fetchedAt: new Date().toISOString(),
  };
}

/* ---------------------------------------------------------------- */
/* Public API                                                       */
/* ---------------------------------------------------------------- */

// In-memory cache of last known quotes (address -> quote) for stale fallback on 429
const quoteCache = new Map();

export async function fetchQuote(chainId, address) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const batch = await fetchTelemetryBatch([address]);
      const items = Array.isArray(batch) ? batch : batch.data ?? batch.items ?? {};
      const item = Array.isArray(items)
        ? items.find((i) => String(i.mint ?? i.address ?? '').toLowerCase() === address.toLowerCase())
        : items;
      const q = normalizeTelemetryItem(item, address);
      if (q) {
        quoteCache.set(address, q);
        return q;
      }
      throw new Error('ASSET_NOT_FOUND');
    } catch (err) {
      lastErr = err;
      if (err.message === 'ASSET_NOT_FOUND') throw err;
      if (err.message.includes('TELEMETRY_ERROR:429') || err.message.includes('TELEMETRY refresh failed: HTTP 429') || err.message.includes('rate limited')) {
        // Rate limited: return stale cached quote if available
        const cached = quoteCache.get(address);
        if (cached) {
          console.warn('[market-data] returning stale cached quote for', address, 'due to 429');
          return { ...cached, stale: true };
        }
        throw new Error('MARKET_DATA_RATE_LIMITED');
      }
      if (err.message.includes('TELEMETRY_ERROR:401') || err.message.includes('TELEMETRY_ERROR:403')) {
        // Check if it's a refresh token issue (not a data access token issue)
        if (err.message.includes('TELEMETRY refresh failed') || err.message === 'TELEMETRY_ERROR:401') {
          // Refresh/access token is invalid or expired - don't retry, throw clear error
          console.error('[market-data] Access token expired or invalid. Get a new token from app.telemetry.io and set via POST /api/market/telemetry/token or TELEMETRY_ACCESS_TOKEN env var.');
          throw new Error('TELEMETRY_AUTH_INVALID');
        }
        invalidateAccessToken();
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('TELEMETRY_ERROR:unknown');
}

export async function fetchQuotesBatch(addresses) {
  if (!addresses.length) return {};

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
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
      lastErr = err;
      if (err.message.includes('TELEMETRY_ERROR:429') || err.message.includes('TELEMETRY refresh failed: HTTP 429') || err.message.includes('rate limited')) {
        console.warn('[market-data] fetchQuotesBatch rate limited (429)');
        return {};
      }
      if (err.message.includes('TELEMETRY_ERROR:401') || err.message.includes('TELEMETRY_ERROR:403')) {
        if (err.message.includes('TELEMETRY refresh failed') || err.message === 'TELEMETRY_ERROR:401') {
          console.error('[market-data] Access token expired or invalid. Get a new token from app.telemetry.io.');
          return {};
        }
        invalidateAccessToken();
        continue;
      }
      // No hay credenciales de telemetry o error no recuperable: devolver vacío
      // para que /api/tokens no falle y la extensión muestre lista vacía en lugar de error.
      console.error('[market-data] fetchQuotesBatch failed:', err.message);
      return {};
    }
  }
  return {};
}

export async function fetchTokenLogo(address) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
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
    } catch (err) {
      lastErr = err;
      if (err.message.includes('TELEMETRY_ERROR:401') || err.message.includes('TELEMETRY_ERROR:403')) {
        if (err.message.includes('TELEMETRY refresh failed') || err.message === 'TELEMETRY_ERROR:401') {
          console.error('[market-data] Access token expired or invalid. Get a new token from app.telemetry.io.');
          return {};
        }
        invalidateAccessToken();
        continue;
      }
      return null;
    }
  }
  return null;
}

export { telemetryAuthStatus, invalidateAccessToken };
