// "Your positions" rows, shared by the FOMO-page overlay, the side panel and the popup so a
// position looks the same everywhere: logo, symbol, size, value and a green/red change.
import { api } from '../services/api.js';
import { escapeHtml, formatCompactQty, formatCompactUsd, formatDateTime, formatDuration, formatPct, formatPrice, formatUsd, timeAgo } from './format.js';
import { icons } from './icons.js';

export const DUST_USD = 3;

// ---------- token logos (data: URLs from the paper server; the FOMO page CSP blocks image CDNs) ----------
const logoCache = new Map(); // "chain:address" -> dataUrl | null
const logoRequests = new Map();

/** Token logo as a data: URL (or null). Cached across the page. */
export function tokenLogoDataUrl(chainId, address) {
  return chainId && address ? loadLogo(`${chainId}:${address}`) : Promise.resolve(null);
}

function loadLogo(key) {
  if (logoCache.has(key)) return Promise.resolve(logoCache.get(key));
  if (!logoRequests.has(key)) {
    const i = key.indexOf(':');
    logoRequests.set(
      key,
      api
        .tokenLogo(key.slice(0, i), key.slice(i + 1))
        .then((r) => r.dataUrl || null, () => null)
        .then((dataUrl) => {
          logoCache.set(key, dataUrl);
          logoRequests.delete(key);
          return dataUrl;
        }),
    );
  }
  return logoRequests.get(key);
}

export function avatar(symbol, chainId, address, size = '') {
  const letter = escapeHtml(String(symbol || '?').replace(/^\$/, '').slice(0, 1).toUpperCase());
  const key = chainId && address ? `${chainId}:${address}` : '';
  return `<span class="av letter ${size}" aria-hidden="true" data-logo="${escapeHtml(key)}">${letter}</span>`;
}

/** Swaps letter avatars for token logos once they arrive. Safe to call after every render. */
export function hydrateLogos(root) {
  for (const node of root.querySelectorAll('[data-logo]:not(.has-img)')) {
    const key = node.dataset.logo;
    if (!key) continue;
    const apply = (dataUrl) => {
      if (!dataUrl || !node.isConnected) return;
      node.style.backgroundImage = `url("${dataUrl}")`;
      node.classList.add('has-img');
    };
    if (logoCache.has(key)) apply(logoCache.get(key));
    else loadLogo(key).then(apply);
  }
}

// ---------- helpers ----------
export const tone = (v) => (v > 0 ? 'profit' : v < 0 ? 'loss' : '');
export const arrow = (v) => (v > 0 ? '▲' : v < 0 ? '▼' : '');
export const tokenHref = (chainId, address) => `https://fomo.family/tokens/${encodeURIComponent(chainId)}/${encodeURIComponent(address)}`;

/** A price level as USD per token, or as market cap when the user prefers MC (falls back to price). */
export function levelFormatter(priceDisplay) {
  const mcap = priceDisplay === 'mcap';
  return {
    level: (price, marketCap) => (mcap && marketCap > 0 ? `${formatCompactUsd(marketCap)} MC` : formatPrice(price)),
    label: (word) => (mcap ? `${word} MC` : `${word} price`),
  };
}

/** Symbols that appear on more than one chain/address, so rows can say which one they are. */
function duplicateSymbols(items) {
  const seen = new Map();
  for (const i of items) seen.set(i.symbol, (seen.get(i.symbol) || 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([sym]) => sym));
}

const chainTag = (chainId) => `<span class="chain-tag">${escapeHtml(chainId)}</span>`;

// ---------- hover card (mirrors the token card FOMO shows when you hover a position) ----------

/** Label / dashed leader / value rows, like FOMO's token card. */
const statRows = (rows) =>
  rows
    .filter(Boolean)
    .map(([label, value, cls = '']) => `<div class="hrow"><span>${label}</span><i></i><b class="num ${cls}">${value}</b></div>`)
    .join('');

function hoverCardHtml({ symbol, chainId, address, headValue, headSub, headSubClass, rows }) {
  return `
    <div class="pos-card" hidden aria-hidden="true">
      <div class="hcard-head">
        ${avatar(symbol, chainId, address)}
        <span class="pos-name"><b>${escapeHtml(symbol)}</b><small>${chainId ? chainTag(chainId) : ''}</small></span>
        <span class="pos-val num"><b>${headValue}</b><small class="${headSubClass}">${headSub}</small></span>
      </div>
      ${statRows(rows)}
    </div>`;
}

/**
 * Logo + name. On the FOMO site it is a link to the token page; in extension pages (popup,
 * side panel) it is a button that opens the token in a tab. The token already on screen toggles details.
 */
function tokenCell({ id, symbol, chainId, address, current, nameHtml, subHtml, linkMode }) {
  const inner = `${avatar(symbol, chainId, address)}<span class="pos-name"><b>${nameHtml}</b><small>${subHtml}</small></span>`;
  if (current || !chainId) return `<button class="pos-token" data-act="toggle-row" data-row="${escapeHtml(id)}">${inner}</button>`;
  if (linkMode === 'action') {
    return `<button class="pos-token" data-act="open-token" data-chain="${escapeHtml(chainId)}" data-address="${escapeHtml(address)}" title="Open ${escapeHtml(symbol)} on FOMO">${inner}</button>`;
  }
  return `<a class="pos-token" href="${escapeHtml(tokenHref(chainId, address))}" title="Open ${escapeHtml(symbol)}">${inner}</a>`;
}

function openRow(p, o, showChain) {
  const { level, label } = levelFormatter(o.priceDisplay);
  const id = `open:${p.assetId}`;
  const expanded = o.expandedRow === id;
  const current = p.assetId === o.currentAssetId;
  const value = p.marketValue ?? p.costBasis;
  return `
    <div class="pos-row ${tone(p.unrealizedPnl)} ${expanded ? 'expanded' : ''}">
      <div class="pos-main">
        ${tokenCell({
          id,
          symbol: p.symbol,
          chainId: p.chainId,
          address: p.address,
          current,
          linkMode: o.linkMode,
          nameHtml: `${escapeHtml(p.symbol)}${current ? ' <i class="here">this token</i>' : ''}`,
          subHtml: `${showChain ? chainTag(p.chainId) : ''}${formatCompactQty(p.quantity)} ${escapeHtml(p.symbol)}`,
        })}
        <button class="pos-toggle" data-act="toggle-row" data-row="${escapeHtml(id)}" aria-expanded="${expanded}"
          aria-label="${escapeHtml(`${p.symbol} details`)}">
          <span class="pos-val num"><b>${formatUsd(value)}</b>
            <small class="chg">${arrow(p.unrealizedPnl)} ${formatPct(Math.abs(p.unrealizedPnlPct ?? 0), { sign: false })}</small></span>
          <span class="chev">${icons.chevron(12)}</span>
        </button>
      </div>
      ${hoverCardHtml({
        symbol: p.symbol,
        chainId: p.chainId,
        address: p.address,
        headValue: formatUsd(value),
        headSub: `${arrow(p.unrealizedPnl)} ${formatPct(p.unrealizedPnlPct)}`,
        headSubClass: 'chg',
        rows: [
          [o.priceDisplay === 'mcap' ? 'Avg entry MC' : 'Avg entry', level(p.averageEntryPrice, p.entryMarketCapUsd)],
          [label('Current'), level(p.currentPrice, p.marketCapUsd)],
          ['Holding', `${formatCompactQty(p.quantity)} ${escapeHtml(p.symbol)}`],
          ['Cost', formatUsd(p.costBasis)],
          ['Unrealized P&amp;L', `${formatUsd(p.unrealizedPnl, { sign: true })} (${formatPct(p.unrealizedPnlPct)})`, 'chg'],
          ['Opened', timeAgo(p.openedAt)],
        ],
      })}
      ${
        expanded
          ? `<div class="pos-detail">
        <div class="pos-actions">
          <button class="btn-sm share" data-act="share-pnl" data-share="open:${escapeHtml(p.assetId)}">${icons.share(12)} Share P&amp;L</button>
          <button class="btn-sm danger" data-act="close-row" data-asset="${escapeHtml(p.assetId)}"
            data-chain="${escapeHtml(p.chainId)}" data-address="${escapeHtml(p.address)}" ${o.pending ? 'disabled' : ''}>Sell all</button>
        </div>
      </div>`
          : ''
      }
    </div>`;
}

function closedRow(t, o, showChain) {
  const { level, label } = levelFormatter(o.priceDisplay);
  const id = `closed:${t.id}`;
  const expanded = o.expandedRow === id;
  return `
    <div class="pos-row ${tone(t.realizedPnl)} ${expanded ? 'expanded' : ''}">
      <div class="pos-main">
        ${tokenCell({
          id,
          symbol: t.symbol,
          chainId: t.chainId,
          address: t.address,
          current: t.assetId === o.currentAssetId,
          linkMode: o.linkMode,
          nameHtml: escapeHtml(t.symbol),
          subHtml: `${showChain && t.chainId ? chainTag(t.chainId) : ''}Held ${formatDuration(t.holdMs)}, closed ${timeAgo(t.exitTime)}`,
        })}
        <button class="pos-toggle" data-act="toggle-row" data-row="${escapeHtml(id)}" aria-expanded="${expanded}" aria-label="${escapeHtml(`${t.symbol} trade details`)}">
          <span class="pos-val num"><b class="chg">${formatUsd(t.realizedPnl, { sign: true })}</b>
            <small class="chg">${arrow(t.realizedPnl)} ${formatPct(Math.abs(t.returnPct), { sign: false })}</small></span>
          <span class="chev">${icons.chevron(12)}</span>
        </button>
      </div>
      ${hoverCardHtml({
        symbol: t.symbol,
        chainId: t.chainId,
        address: t.address,
        headValue: formatUsd(t.realizedPnl, { sign: true }),
        headSub: `${arrow(t.realizedPnl)} ${formatPct(t.returnPct)}`,
        headSubClass: 'chg',
        rows: [
          [label('Entry'), level(t.entryPrice, t.entryMarketCapUsd)],
          [label('Exit'), level(t.exitPrice, t.exitMarketCapUsd)],
          ['Position size', formatUsd(t.positionSizeUsd)],
          ['Proceeds', formatUsd(t.proceedsUsd)],
          ['Simulated fees', formatUsd(t.fees)],
          ['Realized P&amp;L', `${formatUsd(t.realizedPnl, { sign: true })} (${formatPct(t.returnPct)})`, 'chg'],
          ['Buys / sells', `${t.buyCount} / ${t.sellCount}`],
          ['Held', formatDuration(t.holdMs)],
          ['Opened', formatDateTime(t.entryTime)],
          ['Closed', formatDateTime(t.exitTime)],
        ],
      })}
      ${
        expanded
          ? `<div class="pos-detail">
        <div class="pos-actions">
          <button class="btn-sm share" data-act="share-pnl" data-share="closed:${escapeHtml(t.id)}">${icons.share(12)} Share P&amp;L</button>
        </div>
      </div>`
          : ''
      }
    </div>`;
}

/**
 * Shows a row's details in a floating card while the pointer (or keyboard focus) is on it, the way
 * FOMO shows a token card on hover. Call once per surface with the element that holds the rows.
 * @returns {() => void} detach
 */
export function attachPositionHover(scope) {
  const card = document.createElement('div');
  card.className = 'pos-hover';
  card.hidden = true;
  // Mount outside `scope`: extension pages re-render their whole app container. In the FOMO
  // overlay the shadow root is the outermost place the panel's styles still reach.
  const root = scope.getRootNode();
  (root instanceof ShadowRoot ? root : document.body).appendChild(card);
  let shownFor = null;
  let shownKey = null;

  function hide() {
    shownFor = null;
    shownKey = null;
    card.hidden = true;
    card.innerHTML = '';
  }

  const rowKey = (row) => row.querySelector('[data-row]')?.dataset.row || null;

  function place(row) {
    const r = row.getBoundingClientRect();
    const { width: w, height: h } = card.getBoundingClientRect();
    const gap = 10;
    const margin = 8;
    let left = r.left - w - gap;
    let top = r.top - 8;
    if (window.innerWidth < w + r.width + gap * 2) {
      // Narrow window (popup, small screens): sit above or below the row instead of beside it.
      left = Math.min(Math.max(margin, r.left), window.innerWidth - w - margin);
      top = r.bottom + gap + h > window.innerHeight ? r.top - h - gap : r.bottom + gap;
    } else if (left < margin) {
      left = r.right + gap;
    }
    card.style.left = `${Math.max(margin, left)}px`;
    card.style.top = `${Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - h - margin))}px`;
  }

  function show(row, force = false) {
    const source = row?.querySelector('.pos-card');
    if (!source || (row === shownFor && !force)) return;
    shownFor = row;
    shownKey = rowKey(row);
    card.className = `pos-hover ${row.classList.contains('profit') ? 'profit' : row.classList.contains('loss') ? 'loss' : ''}`;
    card.innerHTML = source.innerHTML;
    card.hidden = false;
    place(row);
  }

  const onOver = (e) => {
    const row = e.target.closest?.('.pos-row');
    if (!row || !scope.contains(row)) return hide();
    show(row);
  };
  const onOut = (e) => {
    if (!e.relatedTarget || !shownFor?.contains(e.relatedTarget)) hide();
  };
  const onFocus = (e) => {
    const row = e.target.closest?.('.pos-row');
    if (row) show(row);
    else hide();
  };

  // Refreshing prices re-renders the rows under the pointer, and no new hover event follows.
  // Re-attach to the replacement row so the card stays up and its numbers keep updating.
  const observer = new MutationObserver(() => {
    if (!shownFor || shownFor.isConnected) return;
    const replacement = shownKey && scope.querySelector(`.pos-row [data-row="${CSS.escape(shownKey)}"]`)?.closest('.pos-row');
    if (!replacement) return hide();
    shownFor = null;
    show(replacement, true);
  });
  observer.observe(scope, { childList: true, subtree: true });

  scope.addEventListener('pointerover', onOver);
  scope.addEventListener('pointerout', onOut);
  scope.addEventListener('focusin', onFocus);
  scope.addEventListener('focusout', hide);
  // The row can move or vanish under the card: scrolling, re-rendering or leaving the panel.
  scope.addEventListener('scroll', hide, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && hide());

  return () => {
    hide();
    observer.disconnect();
    card.remove();
    window.removeEventListener('scroll', hide, true);
    window.removeEventListener('resize', hide);
  };
}

/** Placeholder rows shaped like the real ones while data loads. */
export function skeletonRows(count = 3) {
  return Array.from(
    { length: count },
    () => `<div class="pos-row skeleton" aria-hidden="true"><div class="pos-main"><span class="pos-token">
      <span class="av sk"></span><span class="pos-name"><span class="sk sk-line w60"></span><span class="sk sk-line w40"></span></span></span>
      <span class="pos-toggle"><span class="pos-val"><span class="sk sk-line w50"></span><span class="sk sk-line w30"></span></span></span></div></div>`,
  ).join('');
}

/**
 * @param {{ tab: 'open'|'closed', positions: object[]|null, closed: object[]|null, hideDust: boolean,
 *   expandedRow: string|null, priceDisplay: 'price'|'mcap', pending: boolean, currentAssetId?: string,
 *   linkMode: 'href'|'action', limit?: number }} o
 * @returns {{ html: string, dustCount: number }}
 */
export function positionsListHtml(o) {
  if (o.tab === 'open') {
    if (o.positions === null) return { html: skeletonRows(3), dustCount: 0 };
    const dust = o.positions.filter((p) => (p.marketValue ?? p.costBasis) < DUST_USD);
    const visible = (o.hideDust ? o.positions.filter((p) => !dust.includes(p)) : o.positions).slice(0, o.limit ?? Infinity);
    if (!o.positions.length) {
      return { html: `<div class="empty"><b>No open positions</b><span>Buy a token on fomo.family and it shows up here.</span></div>`, dustCount: 0 };
    }
    if (!visible.length) return { html: `<div class="empty"><span>Only small positions under ${formatUsd(DUST_USD, { decimals: 0 })}.</span></div>`, dustCount: dust.length };
    const dup = duplicateSymbols(o.positions);
    return { html: visible.map((p) => openRow(p, o, dup.has(p.symbol))).join(''), dustCount: dust.length };
  }
  if (o.closed === null) return { html: skeletonRows(3), dustCount: 0 };
  if (!o.closed.length) {
    return { html: `<div class="empty"><b>No closed trades yet</b><span>Sell a whole position and its result lands here.</span></div>`, dustCount: 0 };
  }
  const unique = o.closed.filter((t, i, all) => all.findIndex((x) => x.assetId === t.assetId) === i);
  const dup = duplicateSymbols(unique);
  return { html: o.closed.slice(0, o.limit ?? Infinity).map((t) => closedRow(t, o, dup.has(t.symbol))).join(''), dustCount: 0 };
}
