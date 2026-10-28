// Paper P&L share card, laid out like FOMO's own "Position" card (token, chart, P&L, invested /
// avg entry / current) so it reads instantly to FOMO users. What marks it as paper: the violet
// frame and P&L figure instead of FOMO's colours, and a "PAPER" tag on the wordmark bottom-left.
// Drawn on a canvas, so the preview is exactly the image that gets saved or copied.
import { api } from '../services/api.js';
import { escapeHtml, formatCompactUsd, formatDuration, formatPrice } from './format.js';
import { icons } from './icons.js';
import { LOGO_DATA_URL } from './logo.js';
import { TOKENS_CSS } from './styles.js';
import { tokenLogoDataUrl } from './positions.js';
import { isAdmin } from './admin.js';

const W = 360;
const H = 432;
const EXPORT_SCALE = 3; // 1080 x 1296 PNG
const C = {
  frame: '#a896ff',
  frameDeep: '#7a66f2',
  card: '#08070f',
  box: '#12111a',
  line: 'rgba(203, 208, 235, 0.12)',
  text: '#f7f7f7',
  muted: '#9899a3',
  faint: '#5c5f68',
  paper: '#b9aaff',
  green: '#21c95e',
  red: '#ff622e',
};
// Two looks for the same simulated numbers. "paper" is our violet card; "fomo" mirrors the
// format FOMO's own share card uses (blue frame, green/red P&L, white stat values). Both keep
// the Paper Terminal wordmark and the "Simulated trade" line - the numbers are simulated either
// way, and an image that hides that is a fake real-trade flex.
const THEMES = {
  paper: { frame: '#a896ff', frameDeep: '#7a66f2', tagBg: 'rgba(168, 150, 255, 0.16)', tagText: '#a896ff', value: '#a896ff', tinted: true },
  fomo: { frame: '#6c7bff', frameDeep: '#3f4fd8', tagBg: 'rgba(108, 123, 255, 0.2)', tagText: '#a3b0ff', value: '#f7f7f7', tinted: false },
};

const FONT = 'Aeonik, Geist, Inter, ui-sans-serif, system-ui, "Segoe UI", sans-serif';

// ---------- data ----------

/** Card data for an open position (unrealized) or a closed trade (realized). */
export function shareDataFromPosition(p) {
  return {
    status: 'open',
    symbol: p.symbol,
    chainId: p.chainId,
    address: p.address,
    cycleId: p.cycleId,
    pnl: p.unrealizedPnl,
    pnlPct: p.unrealizedPnlPct,
    invested: p.costBasis,
    entryPrice: p.averageEntryPrice,
    entryMc: p.entryMarketCapUsd,
    lastPrice: p.currentPrice,
    lastMc: p.marketCapUsd,
    lastLabel: 'Current',
    from: p.openedAt,
    to: new Date().toISOString(),
  };
}

export function shareDataFromClosed(t) {
  return {
    status: 'closed',
    symbol: t.symbol,
    chainId: t.chainId,
    address: t.address,
    cycleId: t.id,
    pnl: t.realizedPnl,
    pnlPct: t.returnPct,
    invested: t.positionSizeUsd,
    entryPrice: t.entryPrice,
    entryMc: t.entryMarketCapUsd,
    lastPrice: t.exitPrice,
    lastMc: t.exitMarketCapUsd,
    lastLabel: 'Exit',
    from: t.entryTime,
    to: t.exitTime,
  };
}

/** Resolves a "open:<assetId>" / "closed:<id>" share key against the lists a surface already holds. */
export function findShareData(key, { positions = [], closed = [] } = {}) {
  const i = String(key || '').indexOf(':');
  const kind = key.slice(0, i);
  const id = key.slice(i + 1);
  if (kind === 'open') {
    const p = (positions || []).find((x) => x.assetId === id);
    return p ? shareDataFromPosition(p) : null;
  }
  const t = (closed || []).find((x) => String(x.id) === id);
  return t ? shareDataFromClosed(t) : null;
}

// ---------- formatting (card style: short, FOMO-like) ----------

function cardUsd(v, { sign = false } = {}) {
  if (!Number.isFinite(v)) return '-';
  const abs = Math.abs(v);
  let body;
  if (abs >= 10000) body = Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(abs);
  else if (abs >= 100 || Number.isInteger(Math.round(abs * 100) / 100)) body = abs.toLocaleString('en-US', { maximumFractionDigits: abs >= 100 ? 0 : 2 });
  else body = abs.toFixed(2);
  const prefix = v < 0 && abs >= 0.005 ? '-' : sign && v > 0 ? '+' : '';
  return `${prefix}$${body}`;
}

const level = (price, mc) => (mc > 0 ? formatCompactUsd(mc) : formatPrice(price));
const pctText = (v) => (Number.isFinite(v) ? `${Math.abs(v) >= 1000 ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(2)}%` : '-');

// ---------- drawing ----------

function loadImage(src, { cors = false } = {}) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function font(ctx, size, weight = 700) {
  ctx.font = `${weight} ${size}px ${FONT}`;
}

function circleImage(ctx, img, x, y, d, fallbackLetter, bg = '#1c1b27') {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, d, d);
  if (img) {
    ctx.drawImage(img, x, y, d, d);
  } else {
    ctx.fillStyle = C.muted;
    font(ctx, d * 0.45);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fallbackLetter, x + d / 2, y + d / 2 + 1);
  }
  ctx.restore();
}

function ellipsize(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

function drawChart(ctx, box, data, history, trades, opts) {
  const { x, y, w, h } = box;
  const lineColor = data.pnl < 0 ? C.red : C.green;

  // faint dotted guides, like FOMO's chart
  ctx.save();
  ctx.fillStyle = 'rgba(203, 208, 235, 0.10)';
  for (let gx = x + w / 4; gx < x + w - 1; gx += w / 4) for (let gy = y + 6; gy < y + h; gy += 6) ctx.fillRect(Math.round(gx), gy, 1, 1);
  ctx.restore();

  if (history === null) {
    // loading: soft placeholder line
    ctx.save();
    ctx.strokeStyle = 'rgba(203, 208, 235, 0.10)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.6);
    ctx.bezierCurveTo(x + w * 0.3, y + h * 0.2, x + w * 0.6, y + h * 0.9, x + w, y + h * 0.5);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const t0 = Date.parse(history.from);
  const t1 = Date.parse(history.to);
  let points = history.points.filter(([t]) => t >= t0 - 1 && t <= t1 + 60000);
  // No market history: connect the fills so the card still tells the story.
  if (points.length < 2) {
    points = trades.map((tr) => [Date.parse(tr.timestamp), tr.executionPrice]);
    if (Number.isFinite(data.lastPrice)) points.push([Math.max(t1, points.at(-1)?.[0] ?? t1), data.lastPrice]);
    points.sort((a, b) => a[0] - b[0]);
  }
  if (points.length < 2) return;

  const tMin = Math.min(t0, points[0][0]);
  const tMax = Math.max(t1, points.at(-1)[0]);
  const prices = [...points.map((p) => p[1]), ...trades.map((tr) => tr.executionPrice)].filter((p) => p > 0);
  let pMin = Math.min(...prices);
  let pMax = Math.max(...prices);
  if (pMax === pMin) {
    pMax *= 1.05;
    pMin *= 0.95;
  }
  const px = (t) => x + ((t - tMin) / (tMax - tMin || 1)) * w;
  const py = (p) => y + 10 + (1 - (p - pMin) / (pMax - pMin)) * (h - 20);

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach(([t, p], i) => (i ? ctx.lineTo(px(t), py(p)) : ctx.moveTo(px(t), py(p))));
  ctx.stroke();
  ctx.restore();

  if (!opts.markers) return;
  const marks = trades.map((tr) => ({ tr, cx: Math.min(x + w - 8, Math.max(x + 8, px(Date.parse(tr.timestamp)))) }));
  // Quick trades land on the same spot: push earlier markers left so each B/S stays readable.
  for (let i = marks.length - 2; i >= 0; i--) marks[i].cx = Math.max(x + 8, Math.min(marks[i].cx, marks[i + 1].cx - 14));
  for (const { tr, cx } of marks) {
    const cy = Math.min(y + h - 8, Math.max(y + 8, py(tr.executionPrice)));
    const buy = tr.side === 'BUY';
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = buy ? C.green : C.red;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = C.card;
    ctx.stroke();
    ctx.fillStyle = '#060510';
    font(ctx, 9);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(buy ? 'B' : 'S', cx, cy + 0.5);
    ctx.restore();
  }
}

function drawCard(canvas, scale, s, matte) {
  const { data, user, opts } = s;
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // exports get a solid backdrop so pasted images don't show white (transparent) corners
  if (matte) {
    ctx.fillStyle = matte;
    ctx.fillRect(0, 0, W, H);
  }

  const th = THEMES[opts.style === 'fomo' ? 'fomo' : 'paper'];
  // In the FOMO format the P&L carries its own meaning through colour, as theirs does.
  const pnlColor = th.tinted ? C.paper : data.pnl < 0 ? C.red : data.pnl > 0 ? C.green : C.text;

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, th.frame);
  grad.addColorStop(1, th.frameDeep);
  roundRect(ctx, 0, 0, W, H, 26);
  ctx.fillStyle = grad;
  ctx.fill();

  // inner dark card
  const IX = 6;
  const IY = 6;
  const IW = W - 12;
  const IH = H - 80;
  roundRect(ctx, IX, IY, IW, IH, 21);
  ctx.fillStyle = C.card;
  ctx.fill();

  // header: token logo, symbol, status, date
  circleImage(ctx, s.tokenImg, IX + 14, IY + 14, 44, String(data.symbol || '?').replace(/^\$/, '').slice(0, 1).toUpperCase());
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = C.text;
  font(ctx, 18);
  ctx.fillText(ellipsize(ctx, data.symbol || '', 170), IX + 68, IY + 34);

  const tag = data.status === 'open' ? 'Open' : 'Closed';
  font(ctx, 11, 600);
  const tagW = ctx.measureText(tag).width + 16;
  roundRect(ctx, IX + 68, IY + 42, tagW, 18, 9);
  ctx.fillStyle = th.tagBg;
  ctx.fill();
  ctx.fillStyle = th.tagText;
  ctx.fillText(tag, IX + 76, IY + 55);

  const date = new Date(data.to || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  ctx.textAlign = 'right';
  ctx.fillStyle = C.faint;
  font(ctx, 11, 500);
  ctx.fillText(date, IX + IW - 14, IY + 28);
  if (s.markImg) {
    ctx.globalAlpha = 0.55;
    ctx.drawImage(s.markImg, IX + IW - 14 - 16, IY + 40, 16, 16);
    ctx.globalAlpha = 1;
  }

  // chart
  drawChart(ctx, { x: IX + 14, y: IY + 72, w: IW - 28, h: 100 }, data, s.history, s.trades, opts);

  // stats box
  const BX = IX + 10;
  const BY = IY + 184;
  const BW = IW - 20;
  const BH = IH - 184 - 10;
  roundRect(ctx, BX, BY, BW, BH, 15);
  ctx.fillStyle = C.box;
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.stroke();

  // trader
  const name = (user?.displayName || user?.email || 'Paper trader').split('@')[0];
  font(ctx, 13, 700);
  const shownName = ellipsize(ctx, name, BW - 80);
  const nameW = ctx.measureText(shownName).width;
  const rowW = 18 + 7 + nameW;
  const rx = BX + (BW - rowW) / 2;
  circleImage(ctx, s.userImg, rx, BY + 14, 18, name.slice(0, 1).toUpperCase(), '#26243a');
  ctx.textAlign = 'left';
  ctx.fillStyle = C.text;
  ctx.fillText(shownName, rx + 25, BY + 28);
  ctx.fillStyle = 'rgba(203, 208, 235, 0.22)';
  for (let dx = rx; dx < rx + rowW; dx += 5) ctx.fillRect(dx, BY + 39, 2, 1);

  // P&L in paper violet
  const arrow = data.pnl < 0 ? '▼' : data.pnl > 0 ? '▲' : '';
  const big = opts.notional ? cardUsd(data.pnl, { sign: true }) : `${data.pnl < 0 ? '-' : data.pnl > 0 ? '+' : ''}${pctText(data.pnlPct)}`;
  font(ctx, 34, 700);
  ctx.letterSpacing = '-1px';
  const bigW = ctx.measureText(big).width;
  ctx.letterSpacing = '0px';
  let smallParts = [];
  if (opts.notional) smallParts = [['(', C.muted], [`${arrow ? `${arrow} ` : ''}${pctText(data.pnlPct)}`, pnlColor], [')', C.muted]];
  font(ctx, 15, 700);
  const smallW = opts.notional ? smallParts.reduce((a, [t]) => a + ctx.measureText(t).width, 0) + 10 : 0;
  let cx = BX + (BW - bigW - smallW) / 2;
  const baseY = BY + 80;
  font(ctx, 34, 700);
  ctx.letterSpacing = '-1px';
  ctx.fillStyle = pnlColor;
  ctx.fillText(big, cx, baseY);
  ctx.letterSpacing = '0px';
  cx += bigW + 10;
  font(ctx, 15, 700);
  for (const [t, color] of smallParts) {
    ctx.fillStyle = color;
    ctx.fillText(t, cx, baseY - 3);
    cx += ctx.measureText(t).width;
  }

  // three columns
  const rowY = BY + 100;
  ctx.fillStyle = C.line;
  ctx.fillRect(BX, rowY, BW, 1);
  const colW = BW / 3;
  ctx.fillRect(BX + colW, rowY, 1, BH - 100);
  ctx.fillRect(BX + colW * 2, rowY, 1, BH - 100);
  const holdMs = Date.parse(data.to) - Date.parse(data.from);
  const cols = [
    opts.notional ? ['Invested', cardUsd(data.invested)] : ['Held', formatDuration(holdMs)],
    ['Avg. entry', level(data.entryPrice, data.entryMc)],
    [data.lastLabel, level(data.lastPrice, data.lastMc)],
  ];
  ctx.textAlign = 'center';
  cols.forEach(([label, value], i) => {
    const mid = BX + colW * i + colW / 2;
    ctx.fillStyle = C.muted;
    font(ctx, 11, 500);
    ctx.fillText(label, mid, rowY + 24);
    ctx.fillStyle = th.value;
    font(ctx, 15, 700);
    ctx.fillText(ellipsize(ctx, value, colW - 12), mid, rowY + 45);
  });

  // bottom band: our own mark and wordmark, with a PAPER tag on its top-right corner.
  // No other company's wordmark goes on an image people post publicly.
  const bandY = IY + IH;
  ctx.textAlign = 'left';
  const markX = 20;
  const markY = bandY + 18;
  const markSize = 34;
  if (s.markImg) {
    ctx.save();
    roundRect(ctx, markX, markY, markSize, markSize, 9);
    ctx.clip();
    ctx.drawImage(s.markImg, markX, markY, markSize, markSize);
    ctx.restore();
  }

  ctx.fillStyle = '#ffffff';
  font(ctx, 22, 700);
  ctx.letterSpacing = '-0.6px';
  ctx.textBaseline = 'middle';
  ctx.fillText('Paper Terminal', markX + markSize + 11, markY + markSize / 2 + 1);
  ctx.letterSpacing = '0px';
  ctx.textBaseline = 'alphabetic';

  // The wordmark already says Paper Terminal, so the right side carries the disclaimer only.
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
  font(ctx, 11, 500);
  ctx.fillText('Simulated trade', W - 20, bandY + 32);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.fillText('No real funds', W - 20, bandY + 48);
}

// ---------- modal ----------

const MODAL_CSS = `
${TOKENS_CSS}
:host { all: initial; }
.backdrop { position: fixed; inset: 0; z-index: 2147483600; background: rgba(6, 5, 16, 0.82); backdrop-filter: blur(6px);
  display: grid; place-items: center; overflow-y: auto; overscroll-behavior: contain; padding: 16px;
  font-family: var(--font); color: var(--text-primary); -webkit-font-smoothing: antialiased; }
@media (prefers-reduced-transparency: reduce) { .backdrop { backdrop-filter: none; background: #060510; } }
.sheet { display: flex; gap: 24px; align-items: flex-start; max-width: 100%; }
.col { display: flex; flex-direction: column; gap: 10px; }
.title { text-align: center; font-weight: 700; font-size: 15px; color: var(--text-primary); margin: 0 0 2px; }
canvas { width: min(${W}px, calc(100vw - 32px)); height: auto; aspect-ratio: ${W} / ${H}; display: block;
  filter: drop-shadow(0 18px 50px rgba(122, 102, 242, 0.28)); transition: filter .2s; }
canvas.fomo { filter: drop-shadow(0 18px 50px rgba(63, 79, 216, 0.34)); }
.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 290px; }
button { font: inherit; color: inherit; border: 0; background: none; cursor: pointer; padding: 0;
  touch-action: manipulation; -webkit-tap-highlight-color: rgba(168, 150, 255, 0.2); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 40px; border-radius: 10px;
  background: var(--bg-secondary); border: 1px solid var(--line-strong); font-size: 13px; font-weight: 700; white-space: nowrap;
  transition: background-color .15s, transform .1s; }
.btn:hover { background: #1b1a26; }
.btn:active { transform: translateY(1px); }
.btn.wide { grid-column: 1 / -1; }
.btn.primary { background: var(--paper); color: #0b0918; border-color: transparent; }
.btn.primary:hover { background: #b9aaff; }
.chips { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; }
.chip { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: 999px; font-size: 12px; font-weight: 700;
  border: 1px solid var(--line-strong); color: var(--text-secondary); }
.chip { transition: color .15s, border-color .15s, background-color .15s; }
.chip:hover { color: var(--text-primary); border-color: var(--paper-line); }
.chip[aria-pressed="true"] { color: var(--text-primary); border-color: var(--paper-line); background: var(--paper-t); }
.chip .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .5; }
.chip[aria-pressed="true"] .dot { background: var(--paper); opacity: 1; }
.admin-tag { font-style: normal; font-size: 9px; font-weight: 800; letter-spacing: .08em; padding: 2px 5px; border-radius: 4px;
  background: var(--paper-t); color: var(--paper); }
.close { position: fixed; top: 14px; right: 14px; width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center;
  color: var(--text-secondary); background: var(--bg-secondary); }
.close:hover { color: var(--text-primary); }
.note { font-size: 12px; color: var(--text-secondary); min-height: 16px; text-align: center; }
.note.ok { color: var(--green); }
.note.err { color: var(--red); }
.hint { font-size: 12px; color: var(--text-tertiary); line-height: 1.4; width: 290px; }
@media (max-width: 720px) {
  .sheet { flex-direction: column; align-items: center; gap: 14px; }
  .actions, .hint { width: min(${W}px, calc(100vw - 32px)); }
  .close { top: 8px; right: 8px; }
}
@media (prefers-reduced-motion: no-preference) {
  .sheet { animation: rise .22s ease-out; }
  @keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
}
`;

let openModal = null;

/**
 * Opens the share card over the current page (FOMO overlay, side panel or popup).
 * @param {{ data: object, user: object|null }} o
 */
export function openPnlCard({ data, user }) {
  openModal?.close();

  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>${MODAL_CSS}</style>
    <div class="backdrop" data-act="backdrop">
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(`${data.symbol} paper P&L card`)}">
        <button class="close" data-act="close" aria-label="Close">${icons.close(16)}</button>
        <div class="col">
          <p class="title">Paper position</p>
          <canvas width="${W}" height="${H}" role="img" aria-label="${escapeHtml(`${data.symbol} paper trade P&L`)}"></canvas>
          <div class="chips">
            <button class="chip" data-opt="notional" aria-pressed="true"><span class="dot"></span>Notional P&amp;L</button>
            <button class="chip" data-opt="markers" aria-pressed="true"><span class="dot"></span>Buy/Sell</button>
          </div>
          ${
            isAdmin(user)
              ? `<div class="chips">
            <button class="chip source" data-style="paper" aria-pressed="true">Paper look</button>
            <button class="chip source" data-style="fomo" aria-pressed="false">FOMO format <i class="admin-tag">ADMIN</i></button>
          </div>`
              : ''
          }
        </div>
        <div class="col">
          <div class="actions">
            <button class="btn primary" data-act="save">${icons.image(16)} Save image</button>
            <button class="btn" data-act="copy">${icons.copy(16)} Copy image</button>
          </div>
          <p class="note" data-el="note" aria-live="polite"></p>
          <p class="hint">Paper trade: simulated at live prices with virtual money. Nothing was bought or sold on-chain.</p>
        </div>
      </div>
    </div>`;
  document.body.appendChild(host);

  const canvas = shadow.querySelector('canvas');
  const note = shadow.querySelector('[data-el="note"]');
  const s = { data, user, opts: { notional: true, markers: true, style: 'paper' }, history: null, trades: [], tokenImg: null, userImg: null, markImg: null };
  const draw = () => drawCard(canvas, Math.max(2, Math.ceil(window.devicePixelRatio || 1)), s);

  const flash = (kind, text) => {
    note.className = `note ${kind}`;
    note.textContent = text;
  };

  function toBlob() {
    const out = document.createElement('canvas');
    drawCard(out, EXPORT_SCALE, s, C.card);
    return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image.'))), 'image/png'));
  }

  const fileName = () => `paper-${String(data.symbol || 'trade').replace(/[^A-Za-z0-9_-]/g, '')}-pnl-${new Date().toISOString().slice(0, 10)}.png`;

  async function save() {
    try {
      const url = URL.createObjectURL(await toBlob());
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName();
      shadow.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      flash('ok', 'Image saved.');
    } catch (err) {
      flash('err', err.message || 'Could not save the image.');
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': toBlob() })]);
      flash('ok', 'Copied. Paste it anywhere.');
    } catch {
      flash('err', 'Copy was blocked here. Use Save image instead.');
    }
  }

  /** Card look. Same simulated trade either way, so only the colours change. */
  function pickStyle(kind) {
    s.opts.style = kind === 'fomo' ? 'fomo' : 'paper';
    for (const chip of shadow.querySelectorAll('[data-style]')) {
      chip.setAttribute('aria-pressed', String(chip.dataset.style === s.opts.style));
    }
    canvas.classList.toggle('fomo', s.opts.style === 'fomo');
    draw();
  }

  function close() {
    document.removeEventListener('keydown', onKey, true);
    host.remove();
    if (openModal?.host === host) openModal = null;
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      return close();
    }
    // Keep Tab inside the dialog: behind it sits the whole page, which is inert to the reader.
    if (e.key !== 'Tab') return;
    const items = [...shadow.querySelectorAll('button:not([disabled])')];
    if (!items.length) return;
    const active = shadow.activeElement;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (active === first || !items.includes(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !items.includes(active))) {
      e.preventDefault();
      first.focus();
    }
  }
  document.addEventListener('keydown', onKey, true);

  shadow.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-opt]');
    if (opt) {
      const key = opt.dataset.opt;
      s.opts[key] = !s.opts[key];
      opt.setAttribute('aria-pressed', String(s.opts[key]));
      return draw();
    }
    // Admin only: the same simulated numbers in our violet card or in FOMO's card format.
    const styleBtn = e.target.closest('[data-style]');
    if (styleBtn) return pickStyle(styleBtn.dataset.style);

    const target = e.target.closest('[data-act]');
    if (!target) return;
    if (target.dataset.act === 'backdrop' && e.target !== target) return;
    if (target.dataset.act === 'close' || target.dataset.act === 'backdrop') return close();
    if (target.dataset.act === 'save') return save();
    if (target.dataset.act === 'copy') return copy();
  });
  // Keep the page's own hotkeys (FOMO) from reacting while the card is open.
  for (const type of ['keydown', 'keyup', 'keypress']) host.addEventListener(type, (e) => e.stopPropagation());

  openModal = { host, close };
  draw();
  shadow.querySelector('[data-act="save"]').focus();

  // Fonts, images, chart and fill markers arrive asynchronously; redraw as each lands.
  const alive = () => host.isConnected;
  document.fonts?.load?.(`700 34px ${FONT}`).then(() => alive() && draw(), () => {});
  loadImage(LOGO_DATA_URL).then((img) => {
    s.markImg = img;
    if (alive()) draw();
  });
  tokenLogoDataUrl(data.chainId, data.address)
    .then((url) => loadImage(url))
    .then((img) => {
      s.tokenImg = img;
      if (alive()) draw();
    });
  // Google avatars send CORS headers; if the page blocks them, the initial is drawn instead.
  loadImage(user?.photoUrl, { cors: true }).then((img) => {
    s.userImg = img;
    if (alive()) draw();
  });

  const fromMs = Date.parse(data.from);
  const toMs = data.to ? Date.parse(data.to) : Date.now();
  Promise.all([
    api.priceHistory(data.chainId, data.address, fromMs, toMs).catch(() => ({ points: [], from: data.from, to: data.to })),
    api
      .trades({ asset: `${data.chainId}:${data.address}`, limit: 200 })
      .then((r) => r.trades.filter((t) => (data.cycleId ? t.cycleId === data.cycleId : true)))
      .catch(() => []),
  ]).then(([history, trades]) => {
    s.trades = trades.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    s.history = { points: history.points || [], from: history.from || data.from, to: history.to || data.to };
    if (alive()) draw();
  });

  return openModal;
}
