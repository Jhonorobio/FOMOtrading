const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const num = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export function formatUsd(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return usd2.format(Number(v));
}

export function formatSignedUsd(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${usd2.format(Math.abs(Number(v)))}${v > 0 || v < 0 ? '' : ''}`;
}

export function formatCompactUsd(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return usd2.format(n);
}

export function formatCompactQty(v) {
  const n = Number(v);
  if (!n || Number.isNaN(n)) return '0';
  if (Math.abs(n) >= 1_000_000) return `${num.format(n / 1_000_000)}M`;
  if (Math.abs(n) >= 1_000) return `${num.format(n / 1_000)}K`;
  return num.format(n);
}

const SUBS = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };

// 0.0000136 -> "$0.0₄136" (subscript notation from the extension)
export function formatPrice(price) {
  const p = Number(price);
  if (!p || Number.isNaN(p)) return '—';
  if (p >= 1) return usd2.format(p);
  const s = p.toString();
  const m = /^0\.(0+)(\d{1,6})$/.exec(s);
  if (m) {
    const zeros = m[1].length;
    if (zeros >= 4) {
      const firstDigit = m[2][0];
      return `$0.0${SUBS[zeros] ?? `0×${zeros}`}${m[2].slice(0, 3).replace(/0+$/, '') || firstDigit}`;
    }
  }
  return `$${s}`;
}

export function formatPct(v, { signed = true } = {}) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  const sign = signed && n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

export function shortAddr(addr) {
  if (!addr || typeof addr !== 'string') return '';
  return addr.length > 12 ? `${addr.slice(0, 5)}…${addr.slice(-4)}` : addr;
}

export function formatDuration(ms) {
  if (ms == null || Number.isNaN(Number(ms))) return '—';
  let s = Math.round(Number(ms) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  s %= 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) return `${h}h ${mm}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function formatAge(fromMs) {
  if (!fromMs) return '';
  return `${formatDuration(Math.max(0, Date.now() - Number(fromMs)))} old`;
}

export function formatClock(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yest)) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Accepts `chain:address`, fomo.family token URLs and DexScreener links.
export function parseTokenRef(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  let m = /^([a-z0-9]+)[:|]{1,2}(0x[a-fA-F0-9]{8,64}|[1-9A-HJ-NP-Za-km-z]{24,64})$/.exec(raw);
  if (m) return { chain: m[1].toLowerCase(), address: m[2] };
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    m = /\/tokens\/([a-z0-9]+)\/(0x[a-fA-F0-9]{8,64}|[1-9A-HJ-NP-Za-km-z]{24,64})/.exec(url.pathname);
    if (m && /fomo\.family$/i.test(url.hostname)) return { chain: m[1].toLowerCase(), address: m[2] };
    m = /\/tokens\/([a-z0-9a-z]+)\/(0x[a-fA-F0-9]{8,64}|[1-9A-HJ-NP-Za-km-z]{24,64})/.exec(url.pathname);
    if (m) return { chain: m[1].toLowerCase(), address: m[2] };
  } catch {}
  return null;
}

export function makeClientRequestId() {
  return 'xxxxyxxx-xxxx-yxxx-xxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
