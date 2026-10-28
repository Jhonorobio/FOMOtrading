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
  const qs = mints.map((m) => `mint=${encodeURIComponent(m)}`).join('&');
  const url = `${TELEMETRY_BASE}?${qs}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) invalidateAccessToken();
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
    change24hPct: null,
    source: 'telemetry',
    fetchedAt: new Date().toISOString(),
  };
}

/* ---------------------------------------------------------------- */
/* Public API                                                       */
/* ---------------------------------------------------------------- */

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
      if (q) return q;
      throw new Error('ASSET_NOT_FOUND');
    } catch (err) {
      lastErr = err;
      if (err.message === 'ASSET_NOT_FOUND') throw err;
      if (err.message.includes('TELEMETRY_ERROR:401') || err.message.includes('TELEMETRY_ERROR:403')) {
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
      if (err.message.includes('TELEMETRY_ERROR:401') || err.message.includes('TELEMETRY_ERROR:403')) {
        invalidateAccessToken();
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('TELEMETRY_ERROR:unknown');
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
        invalidateAccessToken();
        continue;
      }
      return null;
    }
  }
  return null;
}

export { telemetryAuthStatus, invalidateAccessToken };
