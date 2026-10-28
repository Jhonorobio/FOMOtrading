// Paper trade panel: Buy/Sell tabs, amount, presets, available balance, primary action,
// paper-mode status row, open position and closed trades. Used by the page overlay
// and by the side panel. Every fill is simulated by the paper server.
import { PORTFOLIO_REFRESH_MS, PRICE_STALE_MS, QUOTE_REFRESH_MS } from '../config.js';
import { api } from '../services/api.js';
import { getSessionUser, getSettings, onStateChange, updateSettings } from '../storage/settings.js';
import { escapeHtml, formatCompactQty, formatCompactUsd, formatPct, formatPrice, formatQty, formatUsd, pnlClass, timeAgo } from './format.js';
import { icons } from './icons.js';
import { LOGO_DATA_URL } from './logo.js';
import { arrow, attachPositionHover, avatar, hydrateLogos, levelFormatter, positionsListHtml } from './positions.js';
import { isAdmin } from './admin.js';
import { findShareData, openPnlCard, shareDataFromPosition } from './pnl-card.js';

const LOW_LIQUIDITY_USD = 10000;

const TEMPLATE = `
<div class="pt">
  <div class="head" data-el="head">
    <span class="paper-pill" title="Trades placed here are simulated">${icons.paper(12)} PAPER MODE</span>
    <div class="head-cards" data-el="headCards">
      <button class="mini" data-act="dashboard" title="Open paper dashboard">
        <span class="v num" data-el="cash">-</span>
        <span class="s link">Dashboard</span>
      </button>
      <button class="mini" data-act="dashboard" data-el="equityCard" title="Paper equity and total P&L">
        <span class="v num" data-el="equity">-</span>
        <span class="s num" data-el="totalPnl">-</span>
      </button>
      <div class="profile" data-el="profile">
        <button class="avatar" data-el="avatar" data-act="toggle-profile" aria-haspopup="menu" aria-expanded="false"
          aria-label="Account" title="Account"></button>
        <div class="profile-menu" data-el="profileMenu" role="menu" hidden>
          <div class="pm-user"><b data-el="pmName"></b><small data-el="pmEmail"></small></div>
          <button role="menuitem" data-act="profile-settings">${icons.gear(16)} Settings</button>
          <button role="menuitem" class="danger" data-act="profile-signout">${icons.close(16)} Sign out</button>
        </div>
      </div>
    </div>
  </div>

  <section class="card paper">
    <div class="tabs" role="tablist">
      <button class="tab buy" role="tab" data-side="BUY">Buy</button>
      <button class="tab sell" role="tab" data-side="SELL">Sell</button>
    </div>

    <label class="amount" data-el="amountBox">
      <span class="dollar">$</span>
      <input data-el="amount" name="amount" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="0" aria-label="Amount in USD" />
      <span class="hint num" data-el="hint">Enter amount</span>
    </label>

    <div class="presets" data-el="presets">
      <button class="preset num" data-preset="0"></button>
      <button class="preset num" data-preset="1"></button>
      <button class="preset num" data-preset="2"></button>
      <button class="preset num" data-preset="3"></button>
      <button class="preset max" data-act="max-amount" data-el="maxBtn" title="Use everything available">Max</button>
      <button class="icon-btn" data-act="edit-presets" title="Edit presets" aria-label="Edit presets">${icons.gear(16)}</button>
    </div>
    <div class="preset-editor" data-el="presetEditor" hidden>
      <input data-edit="0" name="preset1" inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="Preset 1" />
      <input data-edit="1" name="preset2" inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="Preset 2" />
      <input data-edit="2" name="preset3" inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="Preset 3" />
      <input data-edit="3" name="preset4" inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="Preset 4" />
      <div class="row"><span class="muted" data-el="presetUnit"></span>
        <button class="btn-sm" data-act="cancel-presets">Cancel</button><button class="btn-sm" data-act="save-presets">Save</button></div>
    </div>

    <div class="available num" data-el="available">$0 available</div>

    <button class="cta" data-act="submit" data-el="cta"><span data-el="ctaLabel">Buy</span><span class="tag">PAPER</span></button>
    <div class="notice" data-el="notice" role="status" hidden></div>

    <div class="status" data-el="status">
      <button class="status-row" data-act="toggle-status" aria-expanded="false">
        <span data-el="statusIcon">${icons.warning(16)}</span>
        <span class="grow" data-el="statusText">Paper trading</span>
        <span class="chev">${icons.chevron(16)}</span>
      </button>
      <dl class="status-body num" data-el="statusBody" hidden></dl>
    </div>
  </section>

  <section class="card position" data-el="position" hidden></section>

  <section class="positions" data-el="positions" hidden>
    <div class="pos-head">
      <h2 class="pos-title">Your positions</h2>
      <div class="pos-controls">
        <div class="pos-tabs unit" role="group" aria-label="Show entry and exit as">
          <button data-price-mode="price" title="Show USD price per token">$</button>
          <button data-price-mode="mcap" title="Show market cap">MC</button>
        </div>
        <div class="pos-tabs" role="tablist" aria-label="Positions">
          <button role="tab" data-pos-tab="open">Open<span class="dot" data-el="openDot" hidden></span></button>
          <button role="tab" data-pos-tab="closed">Closed</button>
        </div>
      </div>
    </div>
    <div class="pos-list" data-el="posList"></div>
    <button class="dust" data-act="toggle-dust" data-el="dustBtn" hidden>Hide dust</button>
  </section>

  <div class="foot" data-el="foot">
    <span>Simulated fills at live prices · no real funds</span>
    <button data-act="real-panel" data-el="realPanelBtn">Use real panel</button>
  </div>
</div>`;

/**
 * @param {{ root: ShadowRoot|HTMLElement, mode: 'overlay'|'sidepanel', onUseRealPanel?: () => void }} opts
 */
export function createTradePanel({ root, mode, onUseRealPanel }) {
  const host = document.createElement('div');
  host.innerHTML = TEMPLATE;
  const el = {};
  host.querySelectorAll('[data-el]').forEach((n) => (el[n.dataset.el] = n));
  const container = host.firstElementChild;
  root.appendChild(container);
  const detachHover = attachPositionHover(container);

  if (mode === 'sidepanel') {
    el.head.hidden = true;
    el.realPanelBtn.hidden = true;
  }

  const state = {
    asset: null,
    user: null,
    config: null,
    serverError: null,
    side: 'BUY',
    amount: '',
    sellPercent: null,
    quote: null,
    quoteReceivedAt: 0,
    quoteError: null,
    account: null,
    position: null,
    portfolio: null,
    needsSetup: false,
    allClosed: null,
    posTab: 'open',
    hideDust: true,
    priceDisplay: 'price',
    discreet: false,
    expandedRow: null,
    pending: false,
    notice: null,
    statusOpen: false,
    profileOpen: false,
    editingPresets: false,
    presets: { BUY: [10, 100, 500, 1000], SELL: [25, 50, 75, 100] },
    mismatchConfirmed: false,
  };

  // Only touch the DOM when markup changes, so buttons aren't replaced under the cursor.
  const html = new WeakMap();
  function setHtml(node, markup) {
    if (html.get(node) === markup) return;
    html.set(node, markup);
    node.innerHTML = markup;
  }

  let noticeTimer = null;
  let quoteTimer = null;
  let portfolioTimer = null;
  let destroyed = false;

  // ---------- data ----------
  async function loadSession() {
    const [user, settings] = await Promise.all([getSessionUser(), getSettings()]);
    state.user = user;
    state.presets = { BUY: settings.buyPresets, SELL: settings.sellPresets };
    state.hideDust = settings.hideDust !== false;
    state.priceDisplay = settings.priceDisplay === 'mcap' ? 'mcap' : 'price';
    // Discreet mode only applies on the site; the extension's own pages always say "paper".
    state.discreet = mode === 'overlay' && settings.discreetOverlay === true;
    try {
      state.config = await api.config();
      state.serverError = null;
    } catch (err) {
      state.serverError = err;
    }
  }

  async function refreshAsset() {
    if (!state.asset || destroyed) return;
    const assetKey = `${state.asset.chain}:${state.asset.address}`;
    try {
      if (state.user) {
        let res;
        try {
          res = await api.assetState(state.asset);
          state.needsSetup = false;
        } catch (err) {
          if (err.code !== 'ACCOUNT_SETUP_REQUIRED') throw err;
          // Signed in but no starting capital chosen yet: still show the live price.
          state.needsSetup = true;
          res = { ...(await api.quote(state.asset)), account: null, position: null };
        }
        if (!state.asset || assetKey !== `${state.asset.chain}:${state.asset.address}`) return;
        state.quote = res.quote;
        state.account = res.account;
        state.position = res.position;
      } else {
        const res = await api.quote(state.asset);
        state.quote = res.quote;
      }
      state.quoteReceivedAt = Date.now();
      state.quoteError = null;
      state.serverError = null;
    } catch (err) {
      if (err.code === 'SERVER_UNREACHABLE') state.serverError = err;
      else state.quoteError = err;
      if (err.status === 401) state.user = null;
    }
    render();
  }

  async function refreshPortfolio() {
    if (!state.user || mode !== 'overlay' || destroyed) return;
    try {
      state.portfolio = await api.portfolio();
      state.needsSetup = false;
    } catch (err) {
      if (err.code === 'ACCOUNT_SETUP_REQUIRED') {
        state.needsSetup = true;
        state.portfolio = null;
      }
      // otherwise the header keeps last known values
    }
    render();
    if (state.posTab === 'closed') refreshClosed();
  }

  async function refreshClosed() {
    if (!state.user || mode !== 'overlay' || destroyed) return;
    try {
      state.allClosed = (await api.closedTrades()).closedTrades;
    } catch {
      // keep last known list
    }
    render();
  }

  /**
   * Self-scheduling polls instead of setInterval: a slow round trip delays the next tick rather
   * than stacking a second request on top of it, which is what made prices lag behind the chart.
   */
  function schedule() {
    clearTimeout(quoteTimer);
    clearTimeout(portfolioTimer);
    const loop = (run, ms, set) => {
      const tick = async () => {
        if (destroyed) return;
        if (document.visibilityState === 'visible') await run();
        if (!destroyed) set(setTimeout(tick, ms));
      };
      set(setTimeout(tick, ms));
    };
    loop(refreshAsset, QUOTE_REFRESH_MS, (t) => (quoteTimer = t));
    loop(refreshPortfolio, PORTFOLIO_REFRESH_MS, (t) => (portfolioTimer = t));
  }

  // ---------- derived ----------
  const symbol = () => state.quote?.symbol || state.position?.symbol || state.asset?.symbol || 'token';
  const isStale = () => !!state.quote && Date.now() - state.quoteReceivedAt > PRICE_STALE_MS;
  const norm = (s) => String(s || '').replace(/^\$/, '').toUpperCase();
  const symbolMismatch = () =>
    !!(state.asset?.symbol && state.quote?.symbol && norm(state.asset.symbol) !== norm(state.quote.symbol));
  const amountNumber = () => {
    const n = Number(state.amount);
    return Number.isFinite(n) ? n : NaN;
  };
  const positionValue = () => (state.position && state.quote ? state.position.quantity * state.quote.priceUsd : 0);

  function ctaState() {
    const sym = symbol();
    if (state.serverError) return { label: 'Paper server offline', ready: false };
    if (!state.asset) return { label: 'Select a token', ready: false };
    if (!state.user && state.signingIn) return { label: 'Unlocking account…', ready: false, pending: true };
    if (!state.user) return { label: 'Unlock account with access code', ready: true, kind: 'signin' };
    if (state.needsSetup) return { label: 'Choose starting capital', ready: true, kind: 'setup' };
    if (state.pending) return { label: state.side === 'BUY' ? `Buying ${sym}…` : `Selling ${sym}…`, ready: false, pending: true };
    if (state.quoteError && !state.quote) return { label: 'Market price unavailable', ready: false };
    if (!state.quote) return { label: 'Loading price…', ready: false };
    if (isStale()) return { label: 'Market data is stale', ready: false };

    const amount = amountNumber();
    const base = state.side === 'BUY' ? `Buy ${sym}` : `Sell ${sym}`;
    if (state.side === 'SELL' && !state.position) return { label: `No ${sym} to sell`, ready: false };
    if (!(amount > 0) && !(state.side === 'SELL' && state.sellPercent)) return { label: base, ready: false };

    if (state.side === 'BUY') {
      const fee = amount * (state.config?.feeRate || 0);
      if (state.account && amount + fee > state.account.cashBalance + 1e-6) return { label: plain('Not enough paper balance', 'Not enough balance'), ready: false };
      if (state.config && amount < state.config.minTradeUsd) return { label: `Minimum ${formatUsd(state.config.minTradeUsd)}`, ready: false };
      if (state.config && amount > state.config.maxTradeUsd) return { label: `Maximum ${formatUsd(state.config.maxTradeUsd, { decimals: 0 })}`, ready: false };
    } else if (!state.sellPercent && amount > positionValue() * 1.000001) {
      return { label: `Not enough ${sym}`, ready: false };
    }
    if (symbolMismatch() && !state.mismatchConfirmed) return { label: `Confirm: trade ${state.quote.symbol}`, ready: true, kind: state.side.toLowerCase() };
    return { label: base, ready: true, kind: state.side.toLowerCase() };
  }

  /** Wording on the FOMO panel: the paper version, or the plain one in discreet mode. */
  const plain = (paperText, plainText) => (state.discreet ? plainText : paperText);

  // ---------- render ----------
  function render() {
    if (destroyed) return;
    container.classList.toggle('discreet', state.discreet);
    const sym = symbol();
    const perf = state.portfolio?.performance;

    // header
    if (mode === 'overlay') {
      if (state.user && !state.needsSetup) {
        el.headCards.hidden = false;
        // Cash and equity come from the same portfolio snapshot so the header always adds up.
        const cash = perf?.cash ?? state.account?.cashBalance;
        el.cash.innerHTML = `${formatUsd(cash)} <small>cash</small>`;
        el.equity.textContent = formatUsd(perf?.totalEquity ?? cash);
        el.totalPnl.className = `s num ${pnlClass(perf?.totalPnl)}`;
        const openCount = perf?.openPositionCount || 0;
        el.totalPnl.innerHTML = perf
          ? `${formatUsd(perf.totalPnl, { sign: true })} <small>total${openCount ? ` · ${openCount} open` : ''}</small>`
          : '<small>&nbsp;</small>';
        el.equityCard.title = perf
          ? `Equity ${formatUsd(perf.totalEquity)} = cash ${formatUsd(perf.cash)} + open positions ${formatUsd(perf.marketValue)}
Total P&L vs ${formatUsd(perf.startingBalance, { decimals: 0 })} start: ${formatUsd(perf.totalPnl, { sign: true })}`
          : 'Paper equity and total P&L';
        setHtml(
          el.avatar,
          state.user.photoUrl
            ? `<img src="${escapeHtml(state.user.photoUrl)}" alt="" width="34" height="34" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover">`
            : escapeHtml((state.user.displayName || state.user.email || '?').slice(0, 1).toUpperCase()),
        );
        setHtml(el.pmName, `${escapeHtml(state.user.displayName || 'Paper trader')}${isAdmin(state.user) ? '<i class="admin-tag">ADMIN</i>' : ''}`);
        el.pmEmail.textContent = state.user.email || '';
        el.profileMenu.hidden = !state.profileOpen;
        el.avatar.setAttribute('aria-expanded', String(state.profileOpen));
      } else {
        el.headCards.hidden = true;
        state.profileOpen = false;
      }
    }

    // tabs
    container.querySelectorAll('.tab').forEach((t) => {
      const active = t.dataset.side === state.side;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', String(active));
    });

    // amount
    if (el.amount.value !== state.amount) el.amount.value = state.amount;
    const amount = amountNumber();
    el.amountBox.classList.toggle('has-value', amount > 0);
    if (amount > 0 && state.quote) {
      const execPrice = state.quote.priceUsd * (1 + (state.side === 'BUY' ? 1 : -1) * (state.config?.slippageRate || 0));
      el.hint.textContent = `≈ ${formatQty(amount / execPrice)} ${sym}`;
    } else {
      el.hint.textContent = state.side === 'SELL' && state.sellPercent ? `${state.sellPercent}% of position` : 'Enter amount';
    }

    // presets
    const presets = state.presets[state.side];
    container.querySelectorAll('[data-preset]').forEach((b, i) => {
      const v = presets[i];
      b.textContent = state.side === 'BUY' ? formatUsd(v, { decimals: 0 }) : `${v}%`;
      b.disabled = state.side === 'SELL' && !state.position;
      b.classList.toggle('active', state.side === 'SELL' ? state.sellPercent === v : amount === v);
    });
    const max = maxAmount();
    el.maxBtn.disabled = !(max > 0);
    el.maxBtn.title = state.side === 'SELL' ? 'Sell the whole position' : 'Spend everything available';
    el.maxBtn.classList.toggle('active', max > 0 && Math.abs(amount - Math.floor(max * 100) / 100) < 0.005);
    el.presets.hidden = state.editingPresets;
    el.presetEditor.hidden = !state.editingPresets;

    // available
    if (!state.user) {
      el.available.innerHTML = `<span class="muted">Sign in, then choose your starting capital</span>`;
    } else if (state.needsSetup) {
      el.available.innerHTML = `<span class="muted">Choose how much virtual capital to practice with</span>`;
    } else if (state.side === 'BUY') {
      // With no token open there is no asset-state call, so fall back to the portfolio's cash
      // rather than showing $0 next to a funded account in the header.
      const cash = state.account?.cashBalance ?? state.portfolio?.account?.cashBalance ?? state.portfolio?.performance?.cash;
      el.available.textContent = cash === undefined || cash === null ? '' : `${formatUsd(cash)} available`;
    } else {
      el.available.innerHTML = state.position
        ? `${formatQty(state.position.quantity)} ${escapeHtml(sym)} <span class="muted">· ${formatUsd(positionValue())} available</span>`
        : `0 ${escapeHtml(sym)} available`;
    }

    // cta
    const cta = ctaState();
    el.ctaLabel.textContent = cta.label;
    el.cta.className = `cta ${cta.ready ? 'ready' : ''} ${cta.kind || ''} ${cta.pending ? 'pending' : ''}`;
    el.cta.disabled = !cta.ready;
    el.cta.querySelector('.tag').hidden = cta.kind === 'signin';
    if (cta.kind === 'signin' && !el.ctaLabel.previousElementSibling) el.ctaLabel.insertAdjacentHTML('beforebegin', `<span data-g>${icons.google(18)}</span>`);
    if (cta.kind !== 'signin') el.cta.querySelector('[data-g]')?.remove();

    // notice
    el.notice.hidden = !state.notice;
    if (state.notice) {
      el.notice.className = `notice ${state.notice.kind}`;
      el.notice.textContent = state.notice.text;
    }

    renderStatus(sym);
    renderPosition(sym);
    renderPositions();
    if (!el.positions.hidden) hydrateLogos(el.posList);
  }

  function renderStatus(sym) {
    let danger = false;
    let text;
    if (state.serverError) {
      danger = true;
      text = plain('Paper server offline', 'Server offline');
    } else if (!state.asset) {
      text = plain('Paper trading · no token selected', 'No token selected');
    } else if (state.quoteError && !state.quote) {
      danger = true;
      text = state.quoteError.code === 'ASSET_NOT_FOUND' ? 'No market found for this token' : 'Market price unavailable';
    } else if (isStale()) {
      danger = true;
      text = 'Market data is stale · refresh';
    } else if (symbolMismatch()) {
      danger = true;
      text = `Check token: page shows ${state.asset.symbol}, market is ${state.quote.symbol}`;
    } else if (state.quote) {
      text = `${plain('Paper trading: ', '')}${sym} · ${formatPrice(state.quote.priceUsd)}`;
    } else {
      text = `Loading ${sym} price…`;
    }
    el.status.classList.toggle('danger', danger);
    setHtml(el.statusIcon, danger ? icons.warning(16) : `<img class="status-logo" src="${LOGO_DATA_URL}" alt="" width="16" height="16" />`);
    // The expandable simulation details live in the side panel only; on the site it's a single status line.
    const expandable = mode === 'sidepanel';
    if (!expandable) state.statusOpen = false;
    el.status.querySelector('.chev').hidden = !expandable;
    el.status.querySelector('.status-row').classList.toggle('static', !expandable);
    el.status.classList.toggle('open', state.statusOpen);
    el.statusText.textContent = text;
    el.statusBody.hidden = !state.statusOpen;
    el.status.querySelector('.status-row').setAttribute('aria-expanded', String(state.statusOpen));
    if (!state.statusOpen) return;

    const q = state.quote;
    const rows = [];
    if (state.serverError) {
      rows.push(`<p class="full">${escapeHtml(state.serverError.message)} Start it with <b>npm start</b> in the server folder, or change the server URL in the side panel settings.</p>`);
    } else if (state.quoteError && !q) {
      rows.push(`<p class="full">${escapeHtml(state.quoteError.message)} Paper trades can't be placed until a current price is available.</p>`);
    }
    if (q) {
      const slip = state.config?.slippageRate || 0;
      rows.push(
        `<dt>Simulated execution price</dt><dd>${formatPrice(q.priceUsd * (1 + (state.side === 'BUY' ? slip : -slip)))}</dd>`,
        `<dt>Market price</dt><dd>${formatPrice(q.priceUsd)}</dd>`,
        `<dt>Liquidity</dt><dd class="${q.liquidityUsd !== null && q.liquidityUsd < LOW_LIQUIDITY_USD ? 'down' : ''}">${formatCompactUsd(q.liquidityUsd)}</dd>`,
        `<dt>Market cap</dt><dd>${formatCompactUsd(q.marketCapUsd)}</dd>`,
        `<dt>24h</dt><dd class="${pnlClass(q.change24hPct)}">${formatPct(q.change24hPct)}</dd>`,
        `<dt>Simulated fee</dt><dd>${formatPct((state.config?.feeRate || 0) * 100, { sign: false })}</dd>`,
        `<dt>Simulated slippage</dt><dd>${formatPct(slip * 100, { sign: false })}</dd>`,
        `<dt>Price source</dt><dd>${escapeHtml(q.source)} · ${timeAgo(new Date(state.quoteReceivedAt).toISOString())}</dd>`,
      );
      if (isStale()) rows.push(`<p class="full">Market data is stale. <button class="inline-btn" data-act="refresh">Refresh</button> before placing a paper trade.</p>`);
      if (symbolMismatch()) {
        rows.push(`<p class="full">The page's ticker doesn't match the market data for this address. Make sure you're trading the token you expect.</p>`);
      }
    }
    rows.push(`<p class="full">Trades here are simulated. No wallet is connected and no real order is sent.</p>`);
    setHtml(el.statusBody, rows.join(''));
  }

  function renderPosition(sym) {
    const p = state.position;
    el.position.hidden = !p || !state.user || state.needsSetup;
    if (!p || !state.user) return;
    el.position.classList.toggle('profit', p.unrealizedPnl > 0);
    el.position.classList.toggle('loss', p.unrealizedPnl < 0);
    const chg = pnlClass(p.unrealizedPnl);
    const posSym = p.symbol || sym || 'token';
    setHtml(el.position, `
      <div class="pos-hd">
        ${avatar(posSym, p.chainId, p.address)}
        <span class="pos-lead">
          <b class="num">${level(p.currentPrice, p.marketCapUsd)}</b>
          <small class="num">${formatCompactQty(p.quantity)} ${escapeHtml(posSym)}</small>
        </span>
        <span class="pos-pnl num ${chg}">
          <b>${formatUsd(p.unrealizedPnl, { sign: true })}</b>
          <small>${arrow(p.unrealizedPnl)} ${formatPct(Math.abs(p.unrealizedPnlPct ?? 0), { sign: false })}</small>
        </span>
      </div>
      <dl class="pos-stats">
        <dt>Invested</dt><dd class="num">${formatUsd(p.costBasis)}</dd>
        <dt>${state.priceDisplay === 'mcap' ? 'Avg entry MC' : 'Avg entry'}</dt>
        <dd class="num">${level(p.averageEntryPrice, p.entryMarketCapUsd)}</dd>
      </dl>
      <div class="pos-actions">
        <button class="btn-sm share" data-act="share-pnl" data-share="current" title="Share P&amp;L">${icons.share(12)} Share</button>
        <button class="btn-sm danger" data-act="close-position" ${state.pending ? 'disabled' : ''}>Close</button>
      </div>`);
    hydrateLogos(el.position);
  }

  /** A price level shown as USD per token, or as market cap when the user prefers MC. */
  const level = (price, marketCap) => levelFormatter(state.priceDisplay).level(price, marketCap);

  /** "Your positions" card: Open / Closed tabs, green in profit, red in loss, tap a row for details. */
  function renderPositions() {
    const show = mode === 'overlay' && !!state.user && !state.needsSetup;
    el.positions.hidden = !show;
    if (!show) return;

    container.querySelectorAll('[data-pos-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.posTab === state.posTab)));
    container.querySelectorAll('[data-price-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.priceMode === state.priceDisplay)));
    const positions = state.portfolio ? state.portfolio.positions : null;
    el.openDot.hidden = !positions?.length;

    const { html, dustCount } = positionsListHtml({
      tab: state.posTab,
      positions,
      closed: state.allClosed,
      hideDust: state.hideDust,
      expandedRow: state.expandedRow,
      priceDisplay: state.priceDisplay,
      pending: state.pending,
      currentAssetId: state.quote?.assetId,
      linkMode: 'href',
    });
    el.dustBtn.hidden = state.posTab !== 'open' || !dustCount;
    el.dustBtn.textContent = state.hideDust ? `Show dust (${dustCount})` : 'Hide dust';
    setHtml(el.posList, html);
  }

  async function closeRow({ chain, address }) {
    if (state.pending) return;
    state.pending = true;
    render();
    try {
      const res = await api.closePosition({ chain, address, clientRequestId: crypto.randomUUID() });
      const t = res.trade;
      showNotice(pnlTone(t.realizedPnl), `${plain('Paper position', 'Position')} ${t.symbol} closed at ${formatPrice(t.executionPrice)} · P&L ${formatUsd(t.realizedPnl, { sign: true })}`);
      state.expandedRow = null;
      state.account = res.account;
      if (t.assetId === state.quote?.assetId) state.position = null;
      await Promise.all([refreshPortfolio(), refreshClosed()]);
    } catch (err) {
      showNotice('err', err.message, 7000);
    } finally {
      state.pending = false;
      render();
    }
  }

  // ---------- actions ----------
  /** Fill notices: green for a gain or a plain buy, red when the fill locked in a loss. */
  const pnlTone = (realizedPnl) => (realizedPnl < 0 ? 'loss' : 'ok');

  function showNotice(kind, text, ms = 5000) {
    state.notice = { kind, text };
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      state.notice = null;
      render();
    }, ms);
    render();
  }

  async function signIn() {
    state.signingIn = true;
    render();
    try {
      // Personal access: unlock via the side panel, where the code input lives.
      showNotice('ok', 'Open the Paper Terminal panel and enter the access code to unlock your account.', 8000);
      api.openSidePanel().catch(() => {});
    } catch (err) {
      showNotice('err', err.message, 8000);
    } finally {
      state.signingIn = false;
      render();
    }
  }

  async function submit() {
    const cta = ctaState();
    if (!cta.ready) return;
    if (cta.kind === 'signin') return signIn();
    if (cta.kind === 'setup') {
      showNotice('ok', 'Choose your starting capital in the Paper Terminal panel to begin.', 6000);
      return api.openSidePanel().catch(() => {});
    }
    if (symbolMismatch() && !state.mismatchConfirmed) {
      state.mismatchConfirmed = true;
      state.statusOpen = mode === 'sidepanel';
      render();
      return;
    }

    const body = { chain: state.asset.chain, address: state.asset.address, side: state.side, clientRequestId: crypto.randomUUID() };
    if (state.side === 'SELL' && state.sellPercent) body.percent = state.sellPercent;
    else body.amountUsd = Math.round(amountNumber() * 100) / 100;

    state.pending = true;
    render();
    try {
      const res = await api.trade(body);
      applyTradeResult(res);
      state.amount = '';
      state.sellPercent = null;
      const t = res.trade;
      const verb = t.side === 'BUY' ? 'Bought' : 'Sold';
      const pnl = t.realizedPnl !== null ? ` · P&L ${formatUsd(t.realizedPnl, { sign: true })}` : '';
      showNotice(pnlTone(t.realizedPnl), `${plain('Paper ', '')}${verb.toLowerCase()} ${formatQty(t.quantity)} ${t.symbol} at ${formatPrice(t.executionPrice)}${pnl}`);
    } catch (err) {
      showNotice('err', err.message, 7000);
      if (err.code?.startsWith('MARKET_DATA')) refreshAsset();
    } finally {
      state.pending = false;
      render();
    }
  }

  function applyTradeResult(res) {
    state.account = res.account;
    state.position = res.position;
    if (res.trade.closesPosition) refreshAsset();
    refreshPortfolio();
  }

  async function closePosition() {
    if (state.pending) return;
    state.pending = true;
    render();
    try {
      const res = await api.closePosition({ chain: state.asset.chain, address: state.asset.address, clientRequestId: crypto.randomUUID() });
      applyTradeResult(res);
      const t = res.trade;
      showNotice(
        pnlTone(t.realizedPnl),
        `${plain('Paper position', 'Position')} closed at ${formatPrice(t.executionPrice)} · P&L ${formatUsd(t.realizedPnl, { sign: true })}`,
      );
    } catch (err) {
      showNotice('err', err.message, 7000);
    } finally {
      state.pending = false;
      render();
    }
  }

  function setAmountFromInput(raw) {
    let v = raw.replace(/[^0-9.]/g, '');
    const firstDot = v.indexOf('.');
    if (firstDot !== -1) v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '').slice(0, 2);
    if (v.length > 12) v = v.slice(0, 12);
    state.amount = v;
    state.sellPercent = null;
    state.mismatchConfirmed = false;
  }

  function applyPreset(i) {
    const v = state.presets[state.side][i];
    if (state.side === 'BUY') {
      state.amount = String(v);
    } else if (state.position) {
      state.sellPercent = v;
      state.amount = (Math.floor(positionValue() * (v / 100) * 100) / 100).toFixed(2);
    }
    state.mismatchConfirmed = false;
    render();
  }

  /**
   * The largest amount this side can actually submit: cash minus the simulated fee when buying,
   * the whole position when selling, and never more than the configured per-trade cap.
   */
  function maxAmount() {
    if (state.side === 'SELL') return state.position ? positionValue() : 0;
    const cash = state.account?.cashBalance ?? state.portfolio?.account?.cashBalance ?? 0;
    const spendable = cash / (1 + (state.config?.feeRate || 0));
    const cap = state.config?.maxTradeUsd ?? Infinity;
    return Math.min(spendable, cap);
  }

  function applyMax() {
    const amount = Math.floor(maxAmount() * 100) / 100;
    if (!(amount > 0)) return;
    state.amount = amount.toFixed(2);
    state.sellPercent = state.side === 'SELL' ? 100 : null;
    state.mismatchConfirmed = false;
    render();
  }

  async function savePresets() {
    const inputs = [...container.querySelectorAll('[data-edit]')];
    const values = inputs.map((i) => Number(i.value));
    const valid = state.side === 'BUY' ? values.every((v) => v > 0 && v <= 1e6) : values.every((v) => v > 0 && v <= 100);
    if (!valid) {
      showNotice('err', state.side === 'BUY' ? 'Presets must be positive dollar amounts.' : 'Sell presets must be between 1 and 100%.');
      return;
    }
    state.presets[state.side] = values;
    state.editingPresets = false;
    await updateSettings(state.side === 'BUY' ? { buyPresets: values } : { sellPresets: values });
    render();
  }

  function openPresetEditor() {
    state.editingPresets = true;
    el.presetUnit.textContent = state.side === 'BUY' ? 'Buy presets ($)' : 'Sell presets (%)';
    container.querySelectorAll('[data-edit]').forEach((input, i) => (input.value = state.presets[state.side][i]));
    render();
    container.querySelector('[data-edit="0"]').focus();
  }

  container.addEventListener('click', (e) => {
    const target = e.target.closest('[data-act],[data-side],[data-preset],[data-pos-tab],[data-price-mode]');
    if (!target || !container.contains(target)) return;
    if (target.dataset.priceMode) {
      state.priceDisplay = target.dataset.priceMode;
      render();
      updateSettings({ priceDisplay: state.priceDisplay });
      return;
    }
    if (target.dataset.posTab) {
      state.posTab = target.dataset.posTab;
      state.expandedRow = null;
      render();
      if (state.posTab === 'closed') refreshClosed();
      return;
    }
    if (target.dataset.side) {
      state.side = target.dataset.side;
      state.amount = '';
      state.sellPercent = null;
      state.editingPresets = false;
      state.mismatchConfirmed = false;
      render();
      return;
    }
    if (target.dataset.preset !== undefined) return applyPreset(Number(target.dataset.preset));
    switch (target.dataset.act) {
      case 'submit':
        return submit();
      case 'toggle-status':
        if (mode !== 'sidepanel') return isStale() || state.quoteError || state.serverError ? refreshAsset() : undefined;
        state.statusOpen = !state.statusOpen;
        return render();
      case 'toggle-row':
        state.expandedRow = state.expandedRow === target.dataset.row ? null : target.dataset.row;
        return render();
      case 'close-row':
        return closeRow(target.dataset);
      case 'share-pnl': {
        const data =
          target.dataset.share === 'current' && state.position
            ? shareDataFromPosition(state.position)
            : findShareData(target.dataset.share, { positions: state.portfolio?.positions, closed: state.allClosed });
        if (data) openPnlCard({ data, user: state.user });
        return;
      }
      case 'toggle-dust':
        state.hideDust = !state.hideDust;
        render();
        return updateSettings({ hideDust: state.hideDust });
      case 'close-position':
        return closePosition();
      case 'max-amount':
        return applyMax();
      case 'edit-presets':
        return openPresetEditor();
      case 'cancel-presets':
        state.editingPresets = false;
        return render();
      case 'save-presets':
        return savePresets();
      case 'refresh':
        return refreshAsset();
      case 'dashboard':
        return api.openSidePanel().catch(() => {});
      case 'toggle-profile':
        state.profileOpen = !state.profileOpen;
        return render();
      case 'profile-settings':
        state.profileOpen = false;
        render();
        // Open the side panel inside this click, then ask it to show Settings.
        api.openSidePanel().catch(() => {});
        chrome.storage.local.set({ sidepanelIntent: { action: 'settings', at: Date.now() } });
        return;
      case 'profile-signout':
        state.profileOpen = false;
        render();
        return api.signOut().catch((err) => showNotice('err', err.message));
      case 'real-panel':
        return onUseRealPanel?.();
    }
  });

  el.amount.addEventListener('input', () => {
    setAmountFromInput(el.amount.value);
    render();
  });
  el.amount.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  // Keep page-level hotkeys on the target site from reacting to typing in our panel.
  for (const type of ['keydown', 'keyup', 'keypress']) container.addEventListener(type, (e) => e.stopPropagation());

  const unsubscribe = onStateChange(async (changes) => {
    if (changes.session || changes.settings) {
      await loadSession();
      if (!state.user) Object.assign(state, { account: null, position: null, portfolio: null, allClosed: null, amount: '', sellPercent: null, profileOpen: false });
    }
    refreshAsset();
    refreshPortfolio();
  });

  const onVisible = () => {
    if (document.visibilityState === 'visible') refreshAsset();
  };
  document.addEventListener('visibilitychange', onVisible);

  // Close the profile menu on outside click or Escape.
  // Clicks outside the panel: the page can't see into the closed shadow root, so treat the host as "inside".
  const panelRoot = container.getRootNode().host || container;
  const onOutside = (e) => {
    if (state.profileOpen && !e.composedPath().includes(panelRoot)) {
      state.profileOpen = false;
      render();
    }
  };
  // Clicks inside the panel but outside the profile menu.
  container.addEventListener(
    'click',
    (e) => {
      if (state.profileOpen && !el.profile.contains(e.target)) {
        state.profileOpen = false;
        render();
      }
    },
    true,
  );
  const onEscape = (e) => {
    if (e.key === 'Escape' && state.profileOpen) {
      state.profileOpen = false;
      render();
      el.avatar.focus();
    }
  };
  document.addEventListener('click', onOutside, true);
  container.addEventListener('keydown', onEscape);

  const ready = (async () => {
    await loadSession();
    render();
    schedule();
    refreshPortfolio();
  })();

  return {
    element: container,
    async setAsset(asset) {
      await ready;
      const same = state.asset && asset && state.asset.chain === asset.chain && state.asset.address === asset.address;
      if (same) {
        if (asset.symbol && asset.symbol !== state.asset.symbol) {
          state.asset = asset;
          render();
        }
        return;
      }
      Object.assign(state, { asset, quote: null, quoteError: null, position: null, amount: '', sellPercent: null, mismatchConfirmed: false });
      render();
      await refreshAsset();
    },
    refresh: () => Promise.all([refreshAsset(), refreshPortfolio()]),
    /** In the side panel the page owns the portfolio, so it hands the account down for the balance line. */
    setAccount(account) {
      if (!account || state.account?.cashBalance === account.cashBalance) return;
      state.account = { ...state.account, ...account };
      render();
    },
    destroy() {
      destroyed = true;
      clearTimeout(quoteTimer);
      clearTimeout(portfolioTimer);
      clearTimeout(noticeTimer);
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('click', onOutside, true);
      detachHover();
      container.remove();
    },
  };
}
