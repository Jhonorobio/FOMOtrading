const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉';

export function formatUsd(value, { sign = false, decimals = 2 } = {}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  const abs = Math.abs(value);
  const body = abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const prefix = value < 0 && Math.round(abs * 10 ** decimals) !== 0 ? '-' : sign && value > 0 ? '+' : '';
  return `${prefix}$${body}`;
}

export function formatCompactUsd(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return '$' + Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

/** Token prices: $1.23, $0.0421, $0.0₄1366 (subscript = number of zeros). */
export function formatPrice(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  if (value <= 0) return '$0';
  if (value >= 1) return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: value >= 1000 ? 2 : 4 });
  if (value >= 0.001) return '$' + value.toPrecision(4).replace(/0+$/, '').replace(/\.$/, '');
  const exp = Math.floor(Math.log10(value));
  const zeros = -exp - 1;
  const digits = Math.round(value * 10 ** (-exp + 3))
    .toString()
    .slice(0, 4)
    .replace(/0+$/, '');
  const sub = String(zeros)
    .split('')
    .map((d) => SUBSCRIPT[d])
    .join('');
  return `$0.0${sub}${digits || '0'}`;
}

export function formatQty(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  if (abs >= 1e9) return (value / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (value / 1e6).toFixed(2) + 'M';
  if (abs >= 1) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return value.toPrecision(4);
}

/** Token amounts like FOMO shows them: 53.5K, 29.6K, 1.2M. */
export function formatCompactQty(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  if (Math.abs(value) < 1000) return formatQty(value);
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function formatPct(value, { sign = true } = {}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  const s = Math.abs(value) >= 1000 ? value.toFixed(0) : value.toFixed(2);
  return `${sign && value > 0 ? '+' : ''}${s}%`;
}

export function formatDuration(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '-';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function timeAgo(iso) {
  if (!iso) return '-';
  const diff = Date.now() - Date.parse(iso);
  if (diff < 45000) return 'just now';
  return `${formatDuration(diff).split(' ')[0]} ago`;
}

export function formatDateTime(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const pnlClass = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
