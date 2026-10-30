/**
 * Mobula API HTTP client (server side).
 *
 * Calls POST https://mobula-api.fomo.family/api/2/pulse to get the bonded-token
 * discovery list. No WebSocket needed. The extension consumes these via
 * GET /api/tokens — it never touches Mobula directly.
 *
 * Auth: obtains a fresh Mobula JWT via Privy session refresh endpoint
 * (https://privy.fomo.family/api/v1/sessions) using the refresh token stored
 * in server/data/telemetry-auth.json or MOBULA_REFRESH_TOKEN env var.
 */
const MOBULA_PULSE_URL = 'https://mobula-api.fomo.family/api/2/pulse';
const PRIVY_SESSIONS_URL = 'https://privy.fomo.family/api/v1/sessions';
const PRIVY_APP_ID = 'cm6h485o300n3zj9yl6vpedq7';
const PRIVY_CLIENT_ID = 'client-WY5gFSayQjxnQhG4rP6SnwPAyPZWZpNRhJ6b9rzMnYwqH';

let cachedMobulaToken = null;
let cachedMobulaTokenExp = 0;

/** In-memory logo URL cache: address -> logoUrl from Mobula. */
const logoUrlCache = new Map();

/** In-memory logo data URL cache: logoUrl -> dataUrl. */
const logoDataCache = new Map();

/** Lee el refresh token desde .env o telemetry-auth.json. */
async function getRefreshToken() {
  const env = process.env.MOBULA_REFRESH_TOKEN;
  if (env) return env;
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const authPath = path.join(process.cwd(), 'data', 'telemetry-auth.json');
    const data = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    return data.refresh_token || null;
  } catch {
    return null;
  }
}

/** Obtiene un token Mobula fresco via Privy refresh endpoint. */
async function getMobulaAuthToken() {
  if (cachedMobulaToken && Date.now() < cachedMobulaTokenExp - 300000) {
    return cachedMobulaToken;
  }

  const refreshToken = await getRefreshToken();
  if (!refreshToken) {
    console.error('[mobula-http] No refresh token available. Set MOBULA_REFRESH_TOKEN in .env or server/data/telemetry-auth.json');
    return null;
  }

  try {
    const res = await fetch(PRIVY_SESSIONS_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'privy-app-id': PRIVY_APP_ID,
        'privy-client-id': PRIVY_CLIENT_ID,
        'Origin': 'https://fomo.family',
        'Referer': 'https://fomo.family/',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[mobula-http] Privy refresh failed:', res.status, text.slice(0, 200));
      return null;
    }

    const data = await res.json();
    const newToken = data.token;
    if (!newToken) {
      console.error('[mobula-http] Privy refresh returned no token:', JSON.stringify(data).slice(0, 200));
      return null;
    }

    try {
      const payloadPart = newToken.split('.')[1];
      const payload = JSON.parse(Buffer.from(payloadPart, 'base64').toString('utf8'));
      cachedMobulaTokenExp = (payload.exp || 0) * 1000;
    } catch {
      cachedMobulaTokenExp = Date.now() + 3600000;
    }

    cachedMobulaToken = newToken;
    console.log('[mobula-http] Mobula token refreshed via Privy, expires at', new Date(cachedMobulaTokenExp).toISOString());
    return newToken;
  } catch (err) {
    console.error('[mobula-http] Privy refresh error:', err.message);
    return null;
  }
}

/** Descarga una imagen y la convierte a data: URL (con caché). */
async function fetchLogoAsDataUrl(logoUrl) {
  if (!logoUrl) return null;
  if (logoDataCache.has(logoUrl)) return logoDataCache.get(logoUrl);

  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'image/png';
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${contentType};base64,${base64}`;
    logoDataCache.set(logoUrl, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

/**
 * Fetch discovered tokens from Mobula via HTTP POST pulse endpoint.
 * Returns an array of token objects. Logos are NOT downloaded here (kept fast).
 * Logo URLs are cached in logoUrlCache for use by /api/token-logo.
 */
export async function fetchMobulaTokens() {
  const token = await getMobulaAuthToken();
  if (!token) {
    throw new Error('MOBULA_AUTH_FAILED: could not obtain Mobula access token via Privy refresh.');
  }

  const body = {
    assetMode: true,
    views: [
      {
        model: 'filtered-bonded',
        chainId: ['solana:solana'],
        sortBy: 'created_at',
        sortOrder: 'desc',
        limit: 100,
        filters: {
          market_cap_diluted: { gte: 50000 },
          created_at_offset: { lte: 604800 },
        },
        includeThesis: true,
        name: 'discover-paper-terminal',
      },
    ],
  };

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  const res = await fetch(MOBULA_PULSE_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`MOBULA_ERROR:${res.status}${text ? ' ' + text.slice(0, 200) : ''}`);
  }

  const data = await res.json();
  const rawTokens = extractTokens(data);

  // Cachear logo URLs por address para uso posterior en /api/token-logo
  for (const t of rawTokens) {
    if (t.logo) {
      logoUrlCache.set(t.address, t.logo);
    }
  }

  const tokens = rawTokens.map((t) => normalizeMobulaToken(t));
  return tokens;
}

/** Extrae el array de tokens de la respuesta de Mobula. */
function extractTokens(data) {
  if (!data) return [];

  if (data.payload) {
    for (const key of Object.keys(data.payload)) {
      const view = data.payload[key];
      if (view && Array.isArray(view.data)) {
        return view.data;
      }
    }
  }

  for (const key of Object.keys(data)) {
    const view = data[key];
    if (view && typeof view === 'object' && Array.isArray(view.data)) {
      return view.data;
    }
  }

  if (Array.isArray(data.data)) {
    return data.data;
  }

  if (Array.isArray(data)) {
    return data;
  }

  return [];
}

/** Normaliza un token de Mobula al formato que espera la extensión. */
export function normalizeMobulaToken(t) {
  const marketCap = Number(t.marketCap ?? t.market_cap ?? t.latest_market_cap ?? 0);
  const securityScore = Number(t.securityScore ?? 0);
  const createdAt = t.createdAt ?? t.created_at ?? null;

  return {
    address: t.address,
    chainId: t.chainId || 'solana',
    symbol: t.symbol || t.address.slice(0, 6).toUpperCase(),
    name: t.name || t.symbol || t.address.slice(0, 6).toUpperCase(),
    price: null,
    marketCap: marketCap > 0 ? marketCap : null,
    liquidity: Number(t.liquidity ?? t.liquidityUsd ?? 0) || null,
    holders: Number(t.holdersCount ?? t.holders ?? 0) || null,
    securityScore: securityScore > 0 ? securityScore : null,
    createdAt,
    source: 'mobula',
    logo: null, // Logo se obtiene vía /api/token-logo
    poolAddress: t.poolAddress ?? null,
  };
}

/** Devuelve el logo URL de Mobula para una dirección (para /api/token-logo). */
export function getLogoUrl(address) {
  return logoUrlCache.get(address) || null;
}

/** Descarga y devuelve un logo como data: URL (para /api/token-logo). */
export async function getLogoDataUrl(address) {
  const logoUrl = logoUrlCache.get(address);
  if (!logoUrl) return null;
  return fetchLogoAsDataUrl(logoUrl);
}
