/**
 * Photon Graduados — live feeder of Photon memescope's Graduated column (col3).
 *
 * Ported (trimmed) from `paper/server/src/track.js` + `photon.js`: the tracker's
 * transport and query-building are byte-compatible (same CycleTLS Chrome
 * fingerprint, same `_photon_ta` cookie, same `<param>_from/_to` filters), but
 * the scope is "solo feed": poll the column, track which tokens are in it, and
 * announce the ones that ENTER by Telegram. No per-minute snapshots, no
 * secondary sources, no wallet PnL sweep — the clients poll GET /api/photon-grads.
 *
 * Gate is FLEXIBLE (unlike paper's track.js): if no proxy is configured the
 * poller egresses direct, and it starts even with zero filters (full column).
 * When a proxy exists (own config > the shared proxy from /api/proxy) the
 * poller prefers it and fails over to direct — same alternation the legacy
 * memescope poller used (dead proxy → direct, 429 direct → proxy).
 */
import initCycleTLS from 'cycletls';
import { JsonStore } from './json-store.js';
import { getActiveProxyUrl, proxyStatus } from './http-client.js';
import { sendTelegramMessage, graduateMessage } from './telegram.js';

const SEARCH_URL = process.env.PHOTON_SEARCH_URL || 'https://photon-sol.tinyastro.io/api/memescope/search';
const DEFAULT_TA =
  '%2BGwOfWeQXAdpObsrbWbYS4vdSrTe5DyYZYGZyWWrgjc3wnJs1sBXV54nyBjf8moVolF87pu3FuBkpi6THzirx5zJ5ycXBFGwanMgB%2BnWxySZ3kQkUpBIHGLWcskMvI8%2FyhcTneZcavfpOHocyeASyqWR%2Fxjrj5Wdtg1gYi%2BUGZrW6LrUFO6CausIAiuUmll74MNPL4ke9q8dqdHwOXKacAz2Go8PHNkysFui8nf0lVsuOarFTSN2pAON103FitzKXH2Od6BhuOeFQtvbuHq8%2FN9QW9T12cH3pZ4LsKbIeARo0BqEpwiM7weVCieEPimC7fj3MwDfOQ%2Fl7Kl864A7ZArqBV3N%2FZuaF%2FCeFBJchYndc7XmcgXfwXEmHBEJ0572%2BIu%2FxLFYxxyPe4G2jSsy6lKj2ePgYSvpTm%2BycWirh2GglInPezLLtXephFUXOU%2FmiOLJ%2FtXC2K4%2FezjU0hCYicG1bwyJEKPdnkgjhcEByIkvO8%2BikldoLN4IqHnj7yfriRlntQ%3D%3D--cYKmQ7Xoco6etjgy--LWP33asZkd3yg8juNGqXDA%3D%3D';

const TICK_MS = 1300;          // fastest sustainable cadence (429 → 45s backoff)
const RATE_LIMIT_BACKOFF_MS = 45_000;
const ERROR_BACKOFF_MS = 15_000;
const FETCH_TIMEOUT_MS = 10_000;
const COLUMN = 'col3';         // Graduated
const TOKENS_MAX = 500;        // tracked-token cap (evict by firstSeenAt)
const MISS_GRACE = 2;          // consecutive pulls absent → visible = false
const NOTIFY_TTL_MS = 168 * 3600000; // 7 days of "already notified" memory
const MAX_NOTIFY_ATTEMPTS = 3;

export const COMMON_FILTERS =
  'dexes=pump%2Craydium_launchpad%2Cmoonshot%2Cboop%2Cmeteora_virtual_curve%2Corca_wavebreak%2Craydium_clmm%2Craydium_cpmm' +
  '&platform=bonk%2Cbelieve%2Cmoonshotdbc%2Cjupiter%2Cbags%2Cwendev%2Cmayhem%2Cbonker%2Cprintr%2Cstonk' +
  '&pump_rewards_enabled=true&quote_token=wsol%2Cusdc%2Cusd1%2Ccustom';

// App-side field name → Photon query parameter (each a {min?,max?} pair sent as
// `<param>_from` / `<param>_to`). mktCap is typed in THOUSANDS by the editors —
// ×1000 converts to Photon's whole dollars. top_holders_perc clamps 0-100.
const FILTER_FIELDS = {
  age: 'age',
  holders: 'holders_count',
  tpHolders: 'tp_holders_count',
  mktCap: 'mkt_cap',
  buys: 'buys',
  freshPct: 'fresh_holding_perc',
  bundleHolders: 'bundle_holders_count',
  bundlePct: 'bundle_holding_perc',
  topHolders: 'top_holders_perc',
};
const FIELD_MULT = { mktCap: 1000 };

export const FIELD_LABELS = {
  age: 'Edad (min)',
  holders: 'Holders',
  tpHolders: 'TP holders',
  mktCap: 'Market cap (miles $)',
  buys: 'Compras',
  freshPct: 'Fresh %',
  bundleHolders: 'Bundle holders',
  bundlePct: 'Bundle %',
  topHolders: 'Top holders %',
};

const configStore = new JsonStore('photon_grads_config');
const notifiedStore = new JsonStore('photon_grads_notified');

/* ---------------- filters (sanitize + build query) ---------------- *//** Only the known fields, only digit-strings (min/max) with at least one side. */
export function sanitizeColumnFilters(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const field of Object.keys(FILTER_FIELDS)) {
    const v = raw[field];
    if (!v || typeof v !== 'object') continue;
    const pair = {};
    for (const side of ['min', 'max']) {
      const val = v[side];
      if (typeof val === 'string' && /^\d+(\.\d+)?$/.test(val)) pair[side] = val;
    }
    if (pair.min || pair.max) out[field] = pair;
  }
  return out;
}

/** Empty stored filters → the env fallback (PHOTON_GRADS_FILTERS = same JSON shape). */
function envFilters() {
  try {
    return sanitizeColumnFilters(JSON.parse(process.env.PHOTON_GRADS_FILTERS || '{}'));
  } catch {
    return {};
  }
}

export function buildQuery(filters) {
  const f = filters ?? {};
  const parts = [COMMON_FILTERS];
  for (const [field, param] of Object.entries(FILTER_FIELDS)) {
    const v = f[field];
    const mult = FIELD_MULT[field] ?? 1;
    if (v?.min) parts.push(`${param}_from=${Math.round(Number(v.min) * mult)}`);
    if (v?.max) parts.push(`${param}_to=${Math.round(Number(v.max) * mult)}`);
  }
  parts.push(`col=${COLUMN}`);
  return parts.join('&');
}

/** Value of the `_photon_ta` cookie to sign memescope requests: runtime config
 * (the editor's field) → env PHOTON_TA → the embedded fallback. The embedded
 * cookie expires when its account rotates it — the editor field is the fix. */
function taCookie() {
  const stored = configStore.get('global');
  return String(stored?.ta ?? '') || process.env.PHOTON_TA || DEFAULT_TA;
}

export const HEADERS = {
  accept: '*/*',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  referer: 'https://photon-sol.tinyastro.io/en/memescope',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  get cookie() {
    return `_photon_ta=${taCookie()}`;
  },
};

/* ---------------- config (enabled / proxy / filters) ---------------- */

const DEFAULT_PROXY = process.env.PHOTON_GRADS_PROXY || '';

function normalizeProxy(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return raw;
  } catch {
    return '';
  }
}

/** Effective poller config: stored-over-env, sanitized; filterless → env fallback. */
export function getPhotonGradsConfig() {
  const stored = configStore.get('global') ?? {};
  const clean = filtersOf(stored.filters);
  return {
    enabled: stored.enabled !== false,
    proxy: typeof stored.proxy === 'string' ? stored.proxy : DEFAULT_PROXY,
    ta: typeof stored.ta === 'string' ? stored.ta : '',
    filters: { [COLUMN]: Object.keys(clean).length ? clean : envFilters() },
    updated_at: stored.updated_at ?? null,
  };
}

function filtersOf(raw) {
  return sanitizeColumnFilters(raw?.[COLUMN] ?? raw?.graduated ?? raw);
}

/** Field-by-field PUT: omitted keys keep their value. Invalid proxy → 400. */
export function setPhotonGradsConfig(raw) {
  const stored = { ...(configStore.get('global') ?? {}) };
  if (raw && typeof raw === 'object') {
    if (raw.proxy !== undefined) {
      const normalized = normalizeProxy(raw.proxy);
      if (normalized !== String(raw.proxy ?? '').trim()) {
        throw Object.assign(new Error('PROXY_INVALID: only http:// and https:// URLs are supported'), { code: 'PROXY_INVALID' });
      }
      stored.proxy = normalized;
    }
    if (raw.filters !== undefined) stored.filters = { [COLUMN]: filtersOf(raw.filters) };
    if (raw.ta !== undefined) stored.ta = String(raw.ta ?? '');
    if (raw.enabled != null) stored.enabled = raw.enabled !== false;
  }
  stored.updated_at = new Date().toISOString();
  configStore.set('global', stored);
  return getPhotonGradsConfig();
}

/** Proxy chain for egress: own config → the shared proxy from /api/proxy → none (direct). */
function egressProxy(config) {
  return normalizeProxy(config.proxy) || getActiveProxyUrl() || '';
}

/* ---------------- tracked tokens (in-memory, feed scope) ---------------- */

const tracked = new Map(); // address → { address, chainId, symbol, name, logo, marketCap, holders, buys, sells, volume, topHoldersPct, snipersPct, bundlePct, tpHolders, firstSeenAt, lastSeenAt, visible }

const numOrNull = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function trackEntryFrom(a) {
  const nowIso = new Date().toISOString();
  return {
    address: a.tokenAddress || a.address,
    chainId: 'solana',
    symbol: a.symbol || null,
    name: a.name || null,
    logo: a.imgUrl || null,
    marketCap: numOrNull(a.fdv),
    holders: numOrNull(a.holders_count),
    buys: numOrNull(a.buys_count),
    sells: numOrNull(a.sells_count),
    volume: numOrNull(a.volume),
    topHoldersPct: numOrNull(a.audit?.top_holders_perc),
    snipersPct: numOrNull(a.snipers_holding_perc),
    bundlePct: numOrNull(a.bundle_holding_perc),
    tpHoldersPct: numOrNull(a.tp_holders_count),
    firstSeenAt: nowIso,
    lastSeenAt: nowIso,
    visible: true,
  };
}

/** What the clients see. `visible:false` marks a row that just left the column. */
function publicToken(t) {
  return {
    address: t.address,
    chainId: t.chainId,
    symbol: t.symbol,
    name: t.name,
    logo: t.logo,
    marketCap: t.marketCap,
    holders: t.holders,
    buys: t.buys,
    sells: t.sells,
    volume: t.volume,
    createdAt: t.firstSeenAt,
    firstSeenAt: t.firstSeenAt,
    lastSeenAt: t.lastSeenAt,
    visible: t.visible,
    source: 'photon',
  };
}

/** Newest graduates first; within the list, fresh ones before paused ones. */
export function listPhotonGradsTokens() {
  const all = [...tracked.values()].map(publicToken);
  all.sort((x, y) => {
    if (x.visible !== y.visible) return x.visible ? -1 : 1;
    return new Date(y.firstSeenAt) - new Date(x.firstSeenAt);
  });
  return all;
}

function evictOverCap() {
  if (tracked.size <= TOKENS_MAX) return;
  const entries = [...tracked.entries()].sort((a, b) => new Date(a[1].firstSeenAt) - new Date(b[1].firstSeenAt));
  for (const [addr] of entries.slice(0, tracked.size - TOKENS_MAX)) tracked.delete(addr);
}

/* ---------------- notified registry (mark-before-send + retries) ---------------- */

const notifiedRetries = new Map(); // address → { token, attempts }

function wasNotified(address) {
  return Boolean(notifiedStore.get(address));
}

function markNotified(token) {
  notifiedStore.set(token.address, { at: Date.now(), symbol: token.symbol ?? null });
}

function clearOldNotified() {
  const now = Date.now();
  let cleaned = 0;
  for (const [address, entry] of Object.entries(notifiedStore.getAll())) {
    if (entry?.at && now - entry.at > NOTIFY_TTL_MS) {
      notifiedStore.delete(address);
      cleaned += 1;
    }
  }
  return cleaned;
}

async function notifyGraduatesToken(token, prevAttempts = 0) {
  try {
    markNotified(token); // mark BEFORE sending: overlapping ticks can't duplicate it
    const ok = await sendTelegramMessage(graduateMessage(token, 'Nuevo token en Photon Graduados'));
    if (ok) {
      console.log('[photon-grads] telegram: notified', token.symbol ?? token.address);
      return true;
    }
    const attempts = prevAttempts + 1;
    if (attempts >= MAX_NOTIFY_ATTEMPTS) {
      notifiedRetries.delete(token.address);
      // Queda marcada en el registro (estado terminal): evita un bucle infinito
      // de reintentos si Telegram queda caído por horas. El dedupe pierde ese
      // aviso a cambio de no spamear — mismo compromiso que el feed de Mobula.
      console.error('[photon-grads] telegram: gave up notifying', token.symbol ?? token.address, 'after', attempts, 'attempts');
    } else {
      notifiedRetries.set(token.address, { token, attempts });
      console.warn('[photon-grads] telegram: send failed for', token.symbol ?? token.address, '- will retry (attempt', attempts, '/', MAX_NOTIFY_ATTEMPTS, ')');
    }
    return false;
  } catch (err) {
    console.error('[photon-grads] telegram: notify error for', token?.address, err?.message ?? err);
    return false;
  }
}

/* ---------------- transport (CycleTLS + flexible proxy failover) ---------------- */

let cycleTLS = null;
let poller = null;
let inflight = null;
let backoffUntil = 0;
let preferProxy = true;      // flip-flops between proxy/direct on failures
let transport = 'direct';    // transport of the last attempt
let unauthorized = false;    // the current (or last used) _photon_ta was rejected
let fetchCount = 0;
let errorCount = 0;
let lastError = null;
let lastFetchAt = 0;
let firstFetchDone = false;  // the first pull feeds the registry silently (no storm)

async function getCycleTLS() {
  if (!cycleTLS) cycleTLS = await initCycleTLS();
  return cycleTLS;
}

export async function closePhotonGrads() {
  if (poller) clearInterval(poller);
  poller = null;
  if (cycleTLS) {
    const c = cycleTLS;
    cycleTLS = null;
    try {
      await c.exit();
    } catch {}
  }
}

/** CycleTLS hands the body over parsed (object) or as raw bytes — accept both. */
function toItems(resp, column) {
  const raw = resp?.data;
  let json;
  if (raw != null && typeof raw === 'object' && !Buffer.isBuffer(raw)) {
    json = raw;
  } else {
    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw ?? '');
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('BAD_BODY');
    }
  }
  if (json.error) throw new Error(String(json.error));
  const slice = json.columns?.[column] ?? { data: [] };
  const items = Array.isArray(slice.data) ? slice.data : [];
  return items.map((it) => it?.attributes).filter(Boolean);
}

/** One real column fetch with the config's filters handed to Photon as query params.
 * Shared by the tick and the proxy-test; the caller owns backoff/transport state. */
async function requestColumn(config, timeoutMs) {
  const client = await getCycleTLS();
  const proxyUrl = egressProxy(config);
  const useProxy = Boolean(proxyUrl) && preferProxy;
  transport = useProxy ? 'proxy' : 'direct';
  const request = client(
    `${SEARCH_URL}?${buildQuery(config.filters[COLUMN])}`,
    { client: 'chrome131', headers: HEADERS, ...(useProxy ? { proxy: proxyUrl } : {}) },
    'GET',
  );
  let timer;
  let resp;
  try {
    resp = await Promise.race([
      request,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`TIMEOUT_${timeoutMs}MS`)), timeoutMs);
      }),
    ]);
  } catch (err) {
    // Never reached the origin: flip the transport for the next tick —
    // dead proxy → direct, dead direct → the proxy (when there is one).
    if (proxyUrl) preferProxy = !preferProxy;
    throw err;
  } finally {
    clearTimeout(timer);
    request.catch(() => {});
  }

  const status = Number(resp?.status) || 0;
  if (status === 429) {
    if (!useProxy && proxyUrl) preferProxy = true; // this IP is rate-limited: prefer the proxy next
    throw Object.assign(new Error('RATE_LIMITED'), { rateLimited: true, status });
  }
  if (status !== 200) {
    // Report a broken proxy as such; anything else says HTTP_<status>.
    if (proxyUrl) preferProxy = !useProxy;
    throw Object.assign(
      new Error(useProxy && status === 401 ? 'PROXY_401 (el proxy no respondió o rechazó)' : `HTTP_${status}`),
      { status },
    );
  }

  return { status, items: toItems(resp, COLUMN) };
}

async function fetchGradsColumn() {
  const config = getPhotonGradsConfig();
  fetchCount += 1;
  try {
    const { items } = await requestColumn(config, FETCH_TIMEOUT_MS);
    return items;
  } catch (err) {
    if (err?.rateLimited) {
      backoffUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
    }
    if (/unauthorized/i.test(String(err?.message))) unauthorized = true;
    else unauthorized = false;
    throw err;
  }
}

/* ---------------- the tick ---------------- */

function tickStartFlush() {
  const entries = [...notifiedRetries.entries()];
  return Promise.all(entries.map(([addr, entry]) => {
    notifiedRetries.delete(addr);
    return notifyGraduatesToken(entry.token, entry.attempts);
  }));
}

async function gradsTick() {
  const flushP = tickStartFlush();
  const config = getPhotonGradsConfig();
  try {
    if (Date.now() < backoffUntil) return;
    if (config.enabled === false) return;
    const items = await fetchGradsColumn();
    lastError = null;
    lastFetchAt = Date.now();
    const now = Date.now();

    const seen = new Set();
    for (const a of items) {
      const address = a.tokenAddress || a.address;
      if (!address) continue;
      seen.add(address);
      let t = tracked.get(address);
      if (!t) {
        t = trackEntryFrom(a);
        tracked.set(address, t);
        evictOverCap();
        if (!firstFetchDone) {
          markNotified(t); // seed: everything already in the column on boot is "not notified" — no storm
        } else if (config.enabled !== false && !wasNotified(address)) {
          await notifyGraduatesToken(t);
        }
      } else {
        // identity backfill + live metrics refresh (cheap, in memory only)
        if (!t.symbol && a.symbol) t.symbol = a.symbol;
        if (!t.name && a.name) t.name = a.name;
        if (!t.logo && a.imgUrl) t.logo = a.imgUrl;
        t.marketCap = numOrNull(a.fdv);
        t.holders = numOrNull(a.holders_count);
        t.buys = numOrNull(a.buys_count);
        t.sells = numOrNull(a.sells_count);
        t.volume = numOrNull(a.volume);
        t.lastSeenAt = new Date(now).toISOString();
        if (!t.visible) t.visible = true;
        delete t.misses; // reappearance resets the miss counter
      }
    }

    // Exit rule: 2 consecutive pulls absent → visible = false (paused). Here the
    // paused rows keep existing for the client until eviction frees the slot,
    // and there is no re-entry notify: the registry marks a graduate ONCE.
    for (const [address, t] of tracked.entries()) {
      if (seen.has(address)) continue;
      if (!t.visible) continue;
      t.misses = (t.misses ?? 0) + 1;
      if (t.misses >= MISS_GRACE) {
        t.visible = false;
        t.pausedAt = Date.now();
        delete t.misses;
      }
    }
    // Feed hygiene: paused rows older than 15 min leave the list (and the map).
    const PAUSE_FREE_MS = 15 * 60_000;
    for (const [address, t] of tracked.entries()) {
      if (!t.visible && t.pausedAt && now - t.pausedAt > PAUSE_FREE_MS) tracked.delete(address);
    }
    evictOverCap();

    if (!firstFetchDone) {
      firstFetchDone = true;
      console.log('[photon-grads] first pull done:', tracked.size, 'tokens seeded');
    }
    const cleaned = clearOldNotified();
    if (cleaned) console.log('[photon-grads] telegram: expired', cleaned, 'notified token(s)');
  } catch (err) {
    errorCount += 1;
    lastError = { message: String(err?.message || err), at: Date.now() };
    if (!err?.rateLimited) backoffUntil = Date.now() + ERROR_BACKOFF_MS;
  } finally {
    await flushP.catch(() => {});
  }
}

function pollTick() {
  try {
    if (inflight) return;
    inflight = gradsTick()
      .catch((err) => {
        console.error('[photon-grads] tick error:', err?.message ?? err);
      })
      .finally(() => {
        inflight = null;
      });
  } catch {
    /* the timer must never crash */
  }
}

export function startPhotonGradsPoller() {
  if (poller) return;
  poller = setInterval(pollTick, TICK_MS);
  void gradsTick();
  console.log('[photon-grads] poller started (col3 Graduated, 1.3s tick, flexible gate)');
}

/* ---------------- diagnostics + proxy test ---------------- */

export function getPhotonGradsStatus() {
  const config = getPhotonGradsConfig();
  const proxyOwn = normalizeProxy(config.proxy);
  const shared = getActiveProxyUrl();
  return {
    running: Boolean(poller),
    enabled: config.enabled,
    tickMs: TICK_MS,
    tokens: tracked.size,
    visibleTokens: [...tracked.values()].filter((t) => t.visible).length,
    fetchCount,
    errorCount,
    lastError,
    lastFetchAt: lastFetchAt || null,
    listAgeMs: lastFetchAt ? Date.now() - lastFetchAt : null,
    backoffRemainingMs: Math.max(0, backoffUntil - Date.now()),
    transport,
    preferProxy: proxyOwn || shared ? preferProxy : false,
    unauthorized,
    taOverride: Boolean(String(config.ta ?? '')) || Boolean(process.env.PHOTON_TA),
    proxy: {
      source: proxyOwn ? 'own' : shared ? 'shared' : 'none',
      ...proxyStatus(),
      ownUrl: proxyOwn ? proxyStatus().url : null,
    },
    filterCount: Object.keys(config.filters[COLUMN] ?? {}).length,
  };
}

/** GET /api/photon-grads payload. */
export function getPhotonGradsPayload() {
  const tokens = listPhotonGradsTokens();
  return {
    tokens,
    count: tokens.length,
    enabled: getPhotonGradsConfig().enabled,
    status: getPhotonGradsStatus(),
  };
}

/** Real column fetch with a draft proxy/filters pair — the same request the
 * poller would send. Cheap "does my proxy work with these filters" check.
 * Never throws; verdict lands as `{ ok: boolean, ... }`. */
export async function testPhotonGradsProxy(rawConfig = {}) {
  const draftProxy = normalizeProxy(rawConfig.proxy);
  const draftFilters = { [COLUMN]: filtersOf(rawConfig) };
  const started = Date.now();
  const config = { proxy: draftProxy, filters: draftFilters };
  try {
    const client = await getCycleTLS();
    const draftTa = String(rawConfig.ta ?? '').trim();
    const headers = draftTa ? { ...HEADERS, cookie: `_photon_ta=${draftTa}` } : HEADERS;
    const useProxy = Boolean(draftProxy);
    const request = client(
      `${SEARCH_URL}?${buildQuery(draftFilters[COLUMN])}`,
      { client: 'chrome131', headers, ...(useProxy ? { proxy: draftProxy } : {}) },
      'GET',
    );
    let timer;
    let resp;
    try {
      resp = await Promise.race([
        request,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`TIMEOUT_${FETCH_TIMEOUT_MS}MS`)), FETCH_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      request.catch(() => {});
    }
    const status = Number(resp?.status) || 0;
    const ms = Date.now() - started;
    if (status !== 200) {
      return { ok: false, proxy: proxyStatus(), status, ms, error: useProxy && status === 401 ? 'PROXY_401 (el proxy no respondió o rechazó)' : `HTTP_${status}` };
    }
    const items = toItems(resp, COLUMN);
    return { ok: true, proxy: proxyStatus(), status, ms, tokens: items.length, filters: draftFilters };
  } catch (err) {
    return { ok: false, proxy: proxyStatus(), status: null, ms: Date.now() - started, error: String(err?.message || err) };
  }
}
