import { renderAppHeader } from '../components/app-header.js';
import { capitalAmount, capitalError, createCapitalChoice, handleCapitalEvent, renderCapitalPicker } from '../components/capital-picker.js';
import { escapeHtml, formatCompactQty, formatCompactUsd, formatDuration, formatPct, formatPrice, formatUsd, pnlClass } from '../components/format.js';
import { icons } from '../components/icons.js';
import { attachPositionHover, avatar, hydrateLogos, positionsListHtml, tone } from '../components/positions.js';
import { findShareData, openPnlCard } from '../components/pnl-card.js';
import { avatarPreview, fileToAvatarDataUrl, NAME_MAX, nameError, suggestedName } from '../components/profile.js';
import { PANEL_CSS } from '../components/styles.js';
import { createTradePanel } from '../components/trade-panel.js';
import { parseAssetFromUrl, parseManualAsset } from '../integrations/target-terminal/adapter.js';
import { api } from '../services/api.js';
import { getSessionUser, getSettings, onStateChange, updateSettings } from '../storage/settings.js';

const style = document.createElement('style');
style.textContent = `${PANEL_CSS}\n:root { --font: 'Geist', ui-sans-serif, system-ui, sans-serif; }`;
document.head.appendChild(style);

const app = document.getElementById('app');
// Opened as a full tab right after install.
const PAGE_MODE = new URLSearchParams(location.search).has('welcome');
if (PAGE_MODE) document.body.classList.add('page');

const TABS = [
  ['trade', 'Trade'],
  ['portfolio', 'Portfolio'],
  ['history', 'History'],
  ['style', 'Style'],
  ['tokens', 'Tokens'],
];
const STYLE_SAMPLE = 5; // closed trades needed for a confident style read

const state = {
  user: null,
  config: null,
  serverError: null,
  settings: null,
  tab: 'trade',
  detectedAsset: null,
  manualAsset: null,
  manualError: null,
  portfolio: null,
  trades: null,
  closedTrades: null,
  tokens: null,
  tokensError: null,
  posTab: 'open',
  expandedRow: null,
  filters: { side: '', asset: '', from: '', to: '', scope: 'current' },
  showDates: false,
  expandedTrade: null,
  sheet: null, // 'settings' | 'reset'
  profileOpen: false,
  account: null,
  needsSetup: false,
  capital: null,
  capitalError: null,
  nameDraft: null,
  nameError: null,
  needsConsent: false,
  consent: { age: false, terms: false },
  consentError: null,
  profileBusy: false,
  banner: null,
  busy: false,
};

let tradePanel = null;
let tradeHost = null;
let viewHost = null;

// ---------- bootstrap ----------
attachPositionHover(app);

async function init() {
  state.settings = await getSettings();
  state.user = await getSessionUser();
  await loadConfig();
  await loadAccount();
  await detectActiveTab();
  render();
  if (state.user) loadTabData();

  // The FOMO page and the popup can ask the side panel to open Settings or a tab.
  const consumeIntent = async () => {
    const { sidepanelIntent: intent } = await chrome.storage.local.get('sidepanelIntent');
    if (!intent) return;
    await chrome.storage.local.remove('sidepanelIntent');
    if (Date.now() - intent.at > 15000) return;
    if (intent.action === 'settings') {
      state.sheet = 'settings';
      renderSheet();
    } else if (intent.action === 'tab' && TABS.some(([id]) => id === intent.tab) && !state.needsSetup) {
      switchTab(intent.tab);
    }
  };
  consumeIntent();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.sidepanelIntent?.newValue) consumeIntent();
  });

  onStateChange(async (changes) => {
    if (changes.settings) state.settings = await getSettings();
    if (changes.session) {
      const wasSignedIn = !!state.user;
      state.user = await getSessionUser();
      if (!!state.user !== wasSignedIn) {
        Object.assign(state, { portfolio: null, trades: null, closedTrades: null, tokens: null, tokensError: null, tab: 'trade', account: null, needsSetup: false, capital: null, profileOpen: false });
        await loadAccount();
        render();
      }
    }
    if (changes.portfolioVersion || changes.session) loadTabData();
    else renderView();
  });

  chrome.tabs.onActivated.addListener(onTabChange);
  chrome.tabs.onUpdated.addListener((_id, info, tab) => {
    if (tab.active && (info.url || info.status === 'complete')) onTabChange();
  });
  setInterval(() => document.visibilityState === 'visible' && state.user && state.tab === 'portfolio' && loadTabData(), 15000);
  setInterval(() => document.visibilityState === 'visible' && state.user && state.tab === 'tokens' && loadTabData(), 5000);
}

/** Is there an active paper account, or does the user still need to choose starting capital? */
async function loadAccount() {
  if (!state.user) return;
  try {
    const me = await api.me();
    state.account = me.account;
    tradePanel?.setAccount(me.account);
    state.needsSetup = me.needsSetup;
    state.needsConsent = me.needsConsent === true;
  } catch (err) {
    if (err.code === 'SERVER_UNREACHABLE') state.serverError = err;
  }
}

async function loadConfig() {
  try {
    state.config = await api.config();
    state.serverError = null;
  } catch (err) {
    state.serverError = err;
  }
}

async function detectActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.detectedAsset = tab?.url ? parseAssetFromUrl(tab.url) : null;
  } catch {
    state.detectedAsset = null;
  }
}

async function onTabChange() {
  const before = currentAsset();
  await detectActiveTab();
  const after = currentAsset();
  if (state.detectedAsset) state.manualAsset = null;
  if (before?.address !== after?.address || before?.chain !== after?.chain) {
    tradePanel?.setAsset(after);
    if (state.tab === 'trade') renderView();
  }
}

const currentAsset = () => state.detectedAsset || state.manualAsset;

async function loadTabData() {
  if (!state.user || state.needsSetup) return;
  try {
    const needPortfolio = state.tab === 'portfolio' || state.tab === 'style' || !state.portfolio;
    const [portfolio, trades, closed, tokensResp] = await Promise.all([
      needPortfolio ? api.portfolio() : null,
      state.tab === 'history' ? api.trades(historyParams()) : null,
      state.tab === 'portfolio' && state.posTab === 'closed' ? api.closedTrades() : null,
      state.tab === 'tokens' ? api.tokens() : null,
    ]);
    if (portfolio) {
      state.portfolio = portfolio;
      state.account = portfolio.account;
      tradePanel?.setAccount(portfolio.account);
    }
    if (trades) state.trades = trades.trades;
    if (closed) state.closedTrades = closed.closedTrades;
    if (tokensResp) {
      state.tokens = tokensResp.tokens ?? [];
      state.tokensError = null;
    }
    state.serverError = null;
  } catch (err) {
    if (err.code === 'SERVER_UNREACHABLE') state.serverError = err;
    else if (err.code === 'ACCOUNT_SETUP_REQUIRED') {
      state.needsSetup = true;
      return render();
    } else {
      if (state.tab === 'tokens') state.tokensError = err.message;
      else flash('err', err.message);
    }
  }
  renderView();
  renderTopbar();
}

function flash(kind, text) {
  state.banner = { kind, text };
  renderView();
  setTimeout(() => {
    if (state.banner?.text === text) {
      state.banner = null;
      renderView();
    }
  }, 6000);
}

function switchTab(tab) {
  state.tab = tab;
  state.banner = null;
  state.expandedRow = null;
  state.expandedTrade = null;
  renderView();
  loadTabData();
}

// ---------- shell ----------
function render() {
  const ready = !!state.user && !state.needsSetup && !state.needsConsent;
  app.innerHTML = `
    <div class="shell">
      <header class="topbar" data-el="topbar"></header>
      ${ready ? `<nav class="nav" role="tablist" aria-label="Sections">${TABS.map(([id, label]) => `<button role="tab" data-tab="${id}" aria-selected="${state.tab === id}">${label}</button>`).join('')}</nav>` : ''}
      <main data-el="trade" class="view"></main>
      <main data-el="view" class="view"></main>
      <div class="footer-note">Paper trading only. No wallet, no real orders, no real funds.</div>
    </div>
    <div data-el="sheet"></div>`;
  tradeHost = app.querySelector('[data-el="trade"]');
  viewHost = app.querySelector('[data-el="view"]');
  renderTopbar();

  if (tradePanel) {
    tradePanel.destroy();
    tradePanel = null;
  }
  if (ready) {
    tradeHost.innerHTML = `<div data-el="assetBar"></div><div data-el="panelSlot"></div>`;
    tradePanel = createTradePanel({ root: tradeHost.querySelector('[data-el="panelSlot"]'), mode: 'sidepanel' });
    tradePanel.setAsset(currentAsset());
  }
  renderView();
}

function renderTopbar() {
  const bar = app.querySelector('[data-el="topbar"]');
  if (!bar) return;
  bar.innerHTML = renderAppHeader({
    user: state.user,
    account: state.needsSetup ? null : state.account,
    performance: state.portfolio?.performance ?? null,
    profileOpen: state.profileOpen,
  });
}

function renderView() {
  if (!viewHost) return;
  renderSheet({ onlyIfChanged: true });
  if (!state.user) {
    tradeHost.hidden = true;
    setViewHtml(renderWelcome());
    return;
  }
  if (state.needsConsent && !state.needsSetup) {
    tradeHost.hidden = true;
    viewHost.hidden = false;
    setViewHtml(renderConsentGate());
    return;
  }
  if (state.needsSetup) {
    tradeHost.hidden = true;
    viewHost.hidden = false;
    setViewHtml(renderSetup());
    return;
  }
  app.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  tradeHost.hidden = state.tab !== 'trade';
  const banner = state.banner ? `<div class="banner ${state.banner.kind}" role="status">${escapeHtml(state.banner.text)}</div>` : '';
  const offline = state.serverError ? `<div class="banner err" role="status">${escapeHtml(state.serverError.message)}</div>` : '';

  if (state.tab === 'trade') {
    setViewHtml(offline + banner + renderSupport());
    viewHost.hidden = false;
    renderAssetBar();
    return;
  }
  viewHost.hidden = false;
  const body = {
    portfolio: renderPortfolio,
    history: renderHistory,
    style: renderStyle,
    tokens: renderTokens,
  }[state.tab]();
  setViewHtml(offline + banner + body);
  hydrateLogos(viewHost);
}

/** Skip identical re-renders so buttons aren't replaced under the cursor during refreshes. */
const renderedMarkup = new WeakMap();
function setViewHtml(markup) {
  if (renderedMarkup.get(viewHost) === markup) return;
  renderedMarkup.set(viewHost, markup);
  viewHost.innerHTML = markup;
}

// ---------- welcome / auth ----------
function renderWelcome() {
  return `
    <section class="welcome">
      <img class="hero-mark" src="../../icons/icon-128.png" alt="" width="56" height="56" />
      <div>
        <h1>Practice on FOMO with paper money</h1>
        <p style="margin-top:6px">Same trading flow, virtual balance, a full record of every trade.</p>
      </div>
      ${state.serverError ? `<div class="banner err">${escapeHtml(state.serverError.message)} <button class="inline-btn" data-act="retry-config">Retry</button></div>` : ''}
      ${state.banner ? `<div class="banner ${state.banner.kind}">${escapeHtml(state.banner.text)}</div>` : ''}
      <div class="field" style="margin-top:12px">
        <label for="access-code">Access code</label>
        <input id="access-code" class="input" name="accessCode" type="text" autocomplete="off" spellcheck="false"
          placeholder="FOMO" maxlength="20" />
        <p class="fine">Enter the access code (<b>FOMO</b> or <b>fomo</b>) to unlock your personal paper account.</p>
      </div>
      <button class="btn primary block" data-act="code" ${state.busy || state.serverError ? 'disabled' : ''}>Unlock account</button>
      <p class="fine">Your paper account is separate from FOMO. We never ask for your FOMO login, wallet or keys.</p>
      <p class="fine">For ${state.config?.minimumAge ?? 18}s and over. By continuing you accept our
        <button class="link-btn" data-act="open-docs" data-section="terms">Terms</button> and
        <button class="link-btn" data-act="open-docs" data-section="privacy">Privacy policy</button>.</p>
    </section>`;
}

// ---------- first-time setup: pick a username, then starting capital ----------
function renderSetup() {
  state.capital ??= createCapitalChoice(state.config);
  state.nameDraft ??= suggestedName(state.user);
  return `
    <section class="welcome">
      <ol class="steps compact">
        <li class="done"><span class="n">${icons.check(12)}</span><span>Signed in as <b>${escapeHtml(state.user.email)}</b></span></li>
        <li class="current"><span class="n">2</span><span><b>Pick a username and starting capital</b></span></li>
      </ol>
      <div class="field">
        <label for="setup-name">Username</label>
        <input id="setup-name" class="input" name="setupName" maxlength="${NAME_MAX}" autocomplete="off" spellcheck="false"
          value="${escapeHtml(state.nameDraft)}" placeholder="How you show up on shared P&L cards…" />
        ${state.nameError ? `<p class="err-text">${escapeHtml(state.nameError)}</p>` : ''}
      </div>
      <div>
        <h1>How much do you want to practice with?</h1>
        <p style="margin-top:6px">Pick a size close to what you would really trade.</p>
      </div>
      ${state.serverError ? `<div class="banner err">${escapeHtml(state.serverError.message)}</div>` : ''}
      ${renderConsentFields()}
      ${renderCapitalPicker({ config: state.config, choice: state.capital, busy: state.busy, submitAct: 'start-account', submitLabel: 'OK, start trading', error: state.capitalError })}
      <p class="fine">You can pick a new amount later with Reset in Settings.</p>
    </section>`;
}

// ---------- trade tab ----------
function renderAssetBar() {
  const bar = tradeHost.querySelector('[data-el="assetBar"]');
  if (!bar) return;
  const detected = state.detectedAsset;
  const manual = state.manualAsset;
  if (detected || manual) {
    const a = detected || manual;
    bar.innerHTML = `
      <div class="asset-strip">
        ${avatar(a.symbol || a.address, a.chain, a.address)}
        <div class="grow">
          <b>${detected ? 'Token open on FOMO' : 'Token from link'}</b>
          <small class="num"><span class="chain-tag">${escapeHtml(a.chain)}</span>${escapeHtml(shortAddr(a.address))}</small>
        </div>
        ${detected ? '<span class="live" aria-label="Following the active FOMO tab"></span>' : '<button class="btn sm" data-act="clear-manual">Clear</button>'}
      </div>`;
    hydrateLogos(bar);
    return;
  }
  bar.innerHTML = `
    <form class="manual" data-form="manual">
      <label class="search">${icons.search(16)}<input name="asset" autocomplete="off" spellcheck="false" placeholder="https://fomo.family/tokens/solana/…"
        aria-label="Token link or chain:address" /></label>
      <button class="btn sm" style="height:40px">Load</button>
    </form>
    ${state.manualError ? `<div class="banner err" style="margin-top:8px">${escapeHtml(state.manualError)}</div>` : ''}
    <p class="muted" style="font-size:12px;margin:8px 2px 0">Or <button class="link-btn" data-act="open-fomo">open fomo.family</button> and pick a token. It shows up here automatically.</p>`;
}

// ---------- support ----------
const SUPPORT = {
  fomo: '_DexRex',
  fomoUrl: 'https://fomo.family/r/_DexRex',
  sol: 'CGjv7kmSvsnsnRXL23HCWF4KfwwSYeHvGNPUBoqL1ujd',
};

const shortKey = (k) => `${k.slice(0, 6)}…${k.slice(-6)}`;

/**
 * A quiet card at the foot of the Trade tab: follow on FOMO, or tip in SOL. Both copyable.
 * Hidden, it folds to its own header row in the same card, so the tab keeps its shape.
 */
function renderSupport() {
  const collapsed = state.settings?.supportCollapsed === true;
  const toggle = `<button class="support-toggle" data-act="toggle-support" aria-expanded="${!collapsed}"
        aria-controls="support-body">${collapsed ? 'Show' : 'Hide'}${icons.chevron(12)}</button>`;
  if (collapsed) {
    return `
    <section class="support collapsed">
      <div class="support-top">
        <h2 class="support-head">${icons.heart(14)} Support</h2>
        ${toggle}
      </div>
    </section>`;
  }
  return `
    <section class="support">
      <div class="support-top">
        <h2 class="support-head">${icons.heart(14)} Support Paper Terminal</h2>
        ${toggle}
      </div>
      <div id="support-body">
      <p>Free to use, and it stays that way. If it earns its place in your routine, a follow or a tip helps.</p>
      <div class="support-row">
        <span class="support-label">FOMO</span>
        <button class="support-value" data-act="copy-support" data-copy="${escapeHtml(SUPPORT.fomo)}"
          title="Copy ${escapeHtml(SUPPORT.fomo)}">${escapeHtml(SUPPORT.fomo)}${icons.copy(13)}</button>
        <button class="support-open" data-act="open-support" title="Open on fomo.family" aria-label="Open ${escapeHtml(SUPPORT.fomo)} on fomo.family">${icons.external(13)}</button>
      </div>
      <div class="support-row">
        <span class="support-label">SOL</span>
        <button class="support-value num" data-act="copy-support" data-copy="${escapeHtml(SUPPORT.sol)}"
          title="Copy ${escapeHtml(SUPPORT.sol)}">${escapeHtml(shortKey(SUPPORT.sol))}${icons.copy(13)}</button>
      </div>
      </div>
    </section>`;
}

/** Age and terms confirmation. Both are required before any paper trade, for new users and after a policy change. */
function renderConsentFields() {
  const age = state.config?.minimumAge ?? 18;
  return `
    <div class="consent">
      <label class="check"><input type="checkbox" name="confirmAge" ${state.consent.age ? 'checked' : ''} />
        <span>I am ${age} or older.</span></label>
      <label class="check"><input type="checkbox" name="acceptTerms" ${state.consent.terms ? 'checked' : ''} />
        <span>I accept the <button type="button" class="link-btn" data-act="open-docs" data-section="terms">Terms</button> and
          <button type="button" class="link-btn" data-act="open-docs" data-section="privacy">Privacy Policy</button>, and I understand
          every trade here is simulated.</span></label>
      ${state.consentError ? `<p class="err-text">${escapeHtml(state.consentError)}</p>` : ''}
    </div>`;
}

/** Shown to an existing account when the policies change and need accepting again. */
function renderConsentGate() {
  return `
    <section class="welcome">
      <div>
        <h1>A quick confirmation before you trade</h1>
        <p style="margin-top:6px">Our terms changed. Confirm these two and you are back where you were. Your history is untouched.</p>
      </div>
      ${renderConsentFields()}
      <button class="btn primary block" data-act="accept-consent" ${state.busy ? 'disabled' : ''}>Agree and Continue</button>
      <p class="fine">Paper Terminal simulates trades. No wallet, no real orders, no real funds.</p>
    </section>`;
}

const shortAddr = (a) => (a.length > 12 ? `${a.slice(0, 5)}…${a.slice(-4)}` : a);

// ---------- shared bits ----------
function stat(label, value, { cls = '', hint = '', last = false } = {}) {
  return `<div class="stat ${last ? 'last-row' : ''}"><div class="label">${label}</div><div class="value num ${cls}">${value}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
}

function skeletonBlock(height) {
  return `<div class="sk" style="height:${height}px;border-radius:14px" aria-hidden="true"></div>`;
}

// ---------- portfolio (open + closed positions) ----------
function renderPortfolio() {
  const p = state.portfolio;
  if (!p) return `${skeletonBlock(70)}${skeletonBlock(120)}${skeletonBlock(220)}`;
  const perf = p.performance;
  const trend = perf.totalPnl >= 0 ? icons.trendUp(14) : icons.trendDown(14);
  const { html, dustCount } = positionsListHtml({
    tab: state.posTab,
    positions: p.positions,
    closed: state.closedTrades,
    hideDust: state.settings.hideDust !== false,
    expandedRow: state.expandedRow,
    priceDisplay: state.settings.priceDisplay === 'mcap' ? 'mcap' : 'price',
    pending: state.busy,
    linkMode: 'action',
  });
  const price = state.settings.priceDisplay === 'mcap' ? 'mcap' : 'price';
  const hideDust = state.settings.hideDust !== false;
  return `
    <section class="equity">
      <span class="label">Total equity</span>
      <span class="big num">${formatUsd(perf.totalEquity)}</span>
      <span class="pnl-line num ${pnlClass(perf.totalPnl)}">${trend} ${formatUsd(perf.totalPnl, { sign: true })} (${formatPct(perf.totalPnlPct)})
        <small>since starting with ${formatUsd(perf.startingBalance, { decimals: 0 })}</small></span>
    </section>
    <section class="box stat-grid">
      ${stat('Cash', formatUsd(perf.cash))}
      ${stat('Invested', formatUsd(perf.invested))}
      ${stat('Today', formatUsd(perf.todayPnl, { sign: true }), { cls: pnlClass(perf.todayPnl) })}
      ${stat('Unrealized', formatUsd(perf.unrealizedPnl, { sign: true }), { cls: pnlClass(perf.unrealizedPnl), last: true })}
      ${stat('Win rate', perf.winRate === null ? '-' : formatPct(perf.winRate, { sign: false }), { hint: `${perf.wins} won, ${perf.losses} lost`, last: true })}
      ${stat('Trades', String(perf.tradeCount), { hint: `${perf.buyCount} buys, ${perf.sellCount} sells`, last: true })}
    </section>
    <section class="positions">
      <div class="pos-head">
        <span class="pos-title">Your positions</span>
        <div class="pos-controls">
          <div class="pos-tabs unit" role="group" aria-label="Show entry and exit as">
            <button data-price-mode="price" aria-pressed="${price === 'price'}" title="USD price per token">$</button>
            <button data-price-mode="mcap" aria-pressed="${price === 'mcap'}" title="Market cap">MC</button>
          </div>
          <div class="pos-tabs" role="tablist" aria-label="Positions">
            <button role="tab" data-pos-tab="open" aria-selected="${state.posTab === 'open'}">Open${p.positions.length ? '<span class="dot"></span>' : ''}</button>
            <button role="tab" data-pos-tab="closed" aria-selected="${state.posTab === 'closed'}">Closed</button>
          </div>
        </div>
      </div>
      <div class="pos-list">${html}</div>
      ${state.posTab === 'open' && dustCount ? `<button class="dust" data-act="toggle-dust">${hideDust ? `Show dust (${dustCount})` : 'Hide dust'}</button>` : ''}
    </section>`;
}

// ---------- history ----------
function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}
const timeOf = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function renderHistory() {
  const f = state.filters;
  const seg = (value, label) => `<button type="button" data-filter-side="${value}" aria-pressed="${f.side === value}">${label}</button>`;
  const filtered = f.side || f.asset || f.from || f.to;
  let list;
  if (state.trades === null) {
    list = `<div class="pos-list">${Array.from({ length: 4 }, () => '<div class="sk" style="height:52px;margin:4px 0" aria-hidden="true"></div>').join('')}</div>`;
  } else if (!state.trades.length) {
    list = filtered
      ? `<div class="empty"><b>No trades match</b><span>Try a different ticker or date range.</span></div>`
      : `<div class="empty"><b>No paper trades yet</b><span>Your buys and sells show up here, newest first.</span></div>`;
  } else {
    let lastDay = '';
    list = state.trades
      .map((t) => {
        const day = dayLabel(t.timestamp);
        const header = day !== lastDay ? `<div class="day-h">${day}</div>` : '';
        lastDay = day;
        return header + tradeRow(t);
      })
      .join('');
  }
  return `
    <form class="filters" data-form="filters">
      <div class="filter-row">
        <div class="seg" role="group" aria-label="Side">${seg('', 'All')}${seg('BUY', 'Buys')}${seg('SELL', 'Sells')}</div>
        <button type="button" class="icon-btn" data-act="toggle-dates" aria-pressed="${state.showDates}" aria-label="Filter by date">${icons.calendar(18)}</button>
      </div>
      <label class="search">${icons.search(16)}<input name="asset" value="${escapeHtml(f.asset)}" autocomplete="off" spellcheck="false" placeholder="Search a ticker, like PORK…"
        aria-label="Search by ticker" /></label>
      ${
        state.showDates
          ? `<div class="date-row">
        <div class="field"><label for="f-from">From</label><input id="f-from" class="input" type="date" name="from" value="${escapeHtml(f.from)}" /></div>
        <div class="field"><label for="f-to">To</label><input id="f-to" class="input" type="date" name="to" value="${escapeHtml(f.to)}" /></div>
      </div>`
          : ''
      }
      <label class="check"><input type="checkbox" data-filter-scope ${f.scope === 'all' ? 'checked' : ''} /> Include accounts from before a reset</label>
    </form>
    <section class="box trade-list">${list}</section>`;
}

function tradeRow(t) {
  const open = state.expandedTrade === t.id;
  const buy = t.side === 'BUY';
  const sub = t.realizedPnl === null ? timeOf(t.timestamp) : `${formatUsd(t.realizedPnl, { sign: true })}`;
  return `
    <div class="pos-row ${buy ? '' : tone(t.realizedPnl)} ${open ? 'expanded' : ''}">
      <div class="pos-main">
        <button class="pos-token" data-act="toggle-trade" data-id="${escapeHtml(t.id)}" aria-expanded="${open}">
          ${avatar(t.symbol, t.chainId, t.address)}
          <span class="pos-name"><b>${escapeHtml(t.symbol)}</b>
            <small class="num"><span class="side-verb ${buy ? 'buy' : 'sell'}">${buy ? 'Bought' : 'Sold'}</span> ${formatCompactQty(t.quantity)} at ${formatPrice(t.executionPrice)}</small></span>
        </button>
        <button class="pos-toggle" data-act="toggle-trade" data-id="${escapeHtml(t.id)}" aria-label="${escapeHtml(`${t.symbol} trade details`)}">
          <span class="pos-val num"><b>${formatUsd(t.total)}</b><small class="${t.realizedPnl === null ? 'muted' : 'chg'}">${sub}</small></span>
          <span class="chev">${icons.chevron(12)}</span>
        </button>
      </div>
      ${
        open
          ? `<div class="pos-detail num">
        <dl>
          <dt>Time</dt><dd>${new Date(t.timestamp).toLocaleString()}</dd>
          <dt>Requested</dt><dd>${formatUsd(t.requestedValue)}</dd>
          <dt>Market price</dt><dd>${formatPrice(t.marketPrice)}</dd>
          <dt>Fill price</dt><dd>${formatPrice(t.executionPrice)}</dd>
          <dt>Simulated fee</dt><dd>${formatUsd(t.fee)}</dd>
          <dt>Simulated slippage</dt><dd>${formatUsd(t.slippage)}</dd>
          <dt>Cash after</dt><dd>${formatUsd(t.cashAfter)}</dd>
          <dt>Liquidity</dt><dd>${formatCompactUsd(t.liquidityUsd)}</dd>
          <dt>Market cap</dt><dd>${formatCompactUsd(t.marketCapUsd)}</dd>
          <dt>Position</dt><dd>${t.status === 'closed' ? 'Closed' : 'Still open'}</dd>
        </dl>
        <div class="pos-actions"><button class="btn-sm" data-act="open-token" data-chain="${escapeHtml(t.chainId)}" data-address="${escapeHtml(t.address)}">${icons.external(12)} Open on FOMO</button></div>
      </div>`
          : ''
      }
    </div>`;
}

// ---------- tokens (Mobula discovery feed via server) ----------
function renderTokens() {
  if (state.tokensError) {
    return `<div class="banner err" role="status">${escapeHtml(state.tokensError)}</div>`;
  }
  const tokens = state.tokens || [];
  if (!tokens.length) {
    return `<div class="empty"><b>No tokens yet</b><span>The Mobula discovery feed is connecting. Wait a few seconds for live tokens to appear.</span></div>`;
  }
  const list = tokens.map((t) => {
    return `
      <div class="token-row">
        <div class="token-main">
          ${avatar(t.symbol || '?', t.chainId, t.address)}
          <div class="token-info">
            <b class="token-sym">${escapeHtml(t.symbol || '?')}</b>
            <small class="token-name muted">${escapeHtml(t.name || '')}</small>
          </div>
          <button class="token-open" data-act="open-token" data-chain="${escapeHtml(t.chainId || 'solana')}" data-address="${escapeHtml(t.address)}" title="Open ${escapeHtml(t.symbol || '?')} on FOMO">${icons.external(12)}</button>
        </div>
        <div class="token-stats">
          <div class="token-stat"><span class="token-label">Market cap</span><span class="token-value num">${formatCompactUsd(t.marketCap)}</span></div>
          <div class="token-stat"><span class="token-label">Holders</span><span class="token-value num">${Number(t.holders || 0).toLocaleString()}</span></div>
        </div>
      </div>`;
  }).join('');
  return `
    <section class="box pad">
      <div class="section-h"><span>Discovered tokens</span><span class="num">${tokens.length}</span></div>
      <div class="token-list">${list}</div>
    </section>`;
}

// ---------- style: competence feedback, not badges ----------
function renderStyle() {
  const p = state.portfolio;
  if (!p) return `${skeletonBlock(108)}${skeletonBlock(80)}${skeletonBlock(200)}`;
  const s = p.tradingStyle;
  const perf = p.performance;
  const n = s.sampleSize;
  const progress = Math.min(n / STYLE_SAMPLE, 1);
  const circumference = 2 * Math.PI * 32;
  const unlocked = n >= STYLE_SAMPLE;
  const remaining = STYLE_SAMPLE - n;
  const num = (v, d = 2) => (v === null || v === undefined ? '-' : v.toFixed(d));
  const offset = new Date().getTimezoneOffset() / 60;
  const localHours = s.activityByHourUtc.map((_, h) => s.activityByHourUtc[(((h + Math.round(offset)) % 24) + 24) % 24]);
  const maxHour = Math.max(1, ...localHours);
  const best = perf.bestTrade;

  return `
    <section class="box style-hero">
      <div class="ring" role="img" aria-label="${Math.min(n, STYLE_SAMPLE)} of ${STYLE_SAMPLE} closed trades">
        <svg viewBox="0 0 76 76"><circle class="track" cx="38" cy="38" r="32" fill="none" stroke-width="7" />
          <circle class="fill" cx="38" cy="38" r="32" fill="none" stroke-width="7" stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${(circumference * (1 - progress)).toFixed(2)}" /></svg>
        <span class="ring-label num">${unlocked ? icons.check(22) : `${n}/${STYLE_SAMPLE}`}</span>
      </div>
      <div>
        <span class="kicker">Your trading style</span>
        ${
          unlocked
            ? `<h1>${escapeHtml(s.style)}</h1><p>${escapeHtml(s.styleDescription)} Based on ${n} closed trades.</p>`
            : `<h1>Close ${remaining} more trade${remaining === 1 ? '' : 's'}</h1><p>After ${STYLE_SAMPLE} closed trades you get a read on how you hold and size positions.</p>`
        }
      </div>
    </section>

    <section class="records">
      <div class="record"><span class="ic">${icons.trophy(18)}</span><div class="value num ${best ? pnlClass(best.realizedPnl) : ''}">${best ? formatUsd(best.realizedPnl, { sign: true }) : '-'}</div><div class="label">Best trade${best ? `, ${escapeHtml(best.symbol)}` : ''}</div></div>
      <div class="record"><span class="ic">${icons.trendUp(18)}</span><div class="value num">${s.personalBests.bestReturnPct === null ? '-' : formatPct(s.personalBests.bestReturnPct)}</div><div class="label">Best return</div></div>
      <div class="record"><span class="ic">${icons.target(18)}</span><div class="value num">${s.longestWinningRun}</div><div class="label">Wins in a row</div></div>
    </section>

    <h2 class="section-h">How you trade</h2>
    <section class="box stat-grid two">
      ${stat('Median hold', formatDuration(s.medianHoldMs))}
      ${stat('Win rate', s.winRatePct === null ? '-' : formatPct(s.winRatePct, { sign: false }))}
      ${stat('Profit factor', num(s.profitFactor), { cls: s.profitFactor === null ? '' : s.profitFactor >= 1 ? 'up' : 'down', hint: 'Gross profit over gross loss' })}
      ${stat('Expectancy', formatUsd(s.expectancyUsd, { sign: true }), { cls: pnlClass(s.expectancyUsd), hint: 'Average result per trade' })}
      ${stat('Average win', formatUsd(s.averageWinUsd, { sign: true }), { cls: s.averageWinUsd ? 'up' : '' })}
      ${stat('Average loss', formatUsd(s.averageLossUsd, { sign: true }), { cls: s.averageLossUsd ? 'down' : '' })}
      ${stat('Buy size', formatUsd(s.averageBuySizeUsd), { hint: s.averageBuyPctOfCash === null ? '' : `${formatPct(s.averageBuyPctOfCash, { sign: false })} of cash`, last: true })}
      ${stat('Max drawdown', s.maxRealizedDrawdownPct ? formatPct(-s.maxRealizedDrawdownPct) : '0.00%', { cls: s.maxRealizedDrawdownPct ? 'down' : '', hint: 'On closed trades', last: true })}
    </section>

    <h2 class="section-h">Coaching</h2>
    <ul class="notes">${s.insights.map((i) => `<li>${icons.lightning(14)}<span>${escapeHtml(i)}</span></li>`).join('')}</ul>

    <h2 class="section-h">When you trade <small>Local time</small></h2>
    <section class="box pad">
      <div class="hours">${localHours.map((c, h) => `<span class="${c ? '' : 'zero'}" title="${h}:00, ${c} fill${c === 1 ? '' : 's'}" style="height:${c ? Math.max(8, (c / maxHour) * 100) : 5}%"></span>`).join('')}</div>
      <div class="hours-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
    </section>

    <h2 class="section-h">Download history</h2>
    <section class="box pad">
      <p class="muted" style="font-size:13px">JSON has every fill, closed trades, open positions and these style metrics. CSV has one row per fill.</p>
      <div class="export">
        <button class="btn sm" data-act="export" data-format="json" ${state.busy ? 'disabled' : ''}>${icons.download(14)} JSON</button>
        <button class="btn sm" data-act="export" data-format="csv" ${state.busy ? 'disabled' : ''}>${icons.download(14)} CSV</button>
      </div>
    </section>`;
}

// ---------- sheets ----------
let renderedSheetKey = null;

function renderSheet({ onlyIfChanged = false } = {}) {
  const slot = app.querySelector('[data-el="sheet"]');
  if (!slot) return;
  // Avoid re-rendering an open sheet on background refreshes (would steal input focus).
  const key = `${state.sheet}|${state.busy}|${!!state.user}|${state.capitalError}`;
  if (onlyIfChanged && key === renderedSheetKey && slot.childElementCount === (state.sheet ? 1 : 0)) return;
  renderedSheetKey = key;
  if (!state.sheet) {
    slot.innerHTML = '';
    return;
  }
  if (state.sheet === 'reset') {
    state.capital ??= createCapitalChoice(state.config, state.account?.startingBalance);
    slot.innerHTML = `
      <div class="scrim">
        <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="reset-title" data-sheet>
          <h2 id="reset-title">Reset paper account</h2>
          <p>Open paper positions close and a new account starts with the capital you choose. Earlier trades stay in History and in exports.</p>
          ${renderCapitalPicker({ config: state.config, choice: state.capital, busy: state.busy, submitAct: 'confirm-reset', submitLabel: 'Reset account', error: state.capitalError })}
          <button class="btn block" data-act="close-sheet">Cancel</button>
        </div>
      </div>`;
    return;
  }
  const s = state.settings;
  slot.innerHTML = `
    <div class="scrim">
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title" data-sheet>
        <h2 id="settings-title">Settings</h2>
        ${state.user ? `<p>Signed in as <b style="color:var(--text-primary)">${escapeHtml(state.user.email)}</b></p>` : ''}
        ${
          state.user
            ? `<div class="profile-edit">
          <span class="pfp-slot" data-el="pfpSlot">${avatarPreview(state.user)}</span>
          <div class="profile-fields">
            <label for="profile-name">Username</label>
            <input id="profile-name" class="input" name="profileName" data-el="profileName" maxlength="${NAME_MAX}" autocomplete="off" spellcheck="false"
              value="${escapeHtml(state.nameDraft ?? suggestedName(state.user))}" />
            <div class="profile-actions">
              <button class="btn sm" data-act="pick-photo" data-el="pickPhoto">${icons.image(14)} <span>${state.user.photoUrl ? 'Change picture' : 'Add picture'}</span></button>
              <button class="btn sm" data-act="remove-photo" data-el="removePhoto" ${state.user.photoUrl ? '' : 'hidden'}>Remove</button>
              <button class="btn sm primary" data-act="save-profile" data-el="saveProfile">Save</button>
            </div>
            <p class="profile-note" data-el="profileNote" role="status">${state.nameError ? escapeHtml(state.nameError) : ''}</p>
          </div>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-el="photoInput" hidden />
        </div>`
            : ''
        }
        <div class="group">
          <div class="toggle-row">
            <div><b>Paper panel on FOMO</b><small>Covers FOMO's Buy/Sell panel while on.</small></div>
            <button class="switch" role="switch" aria-checked="${s.overlayEnabled}" data-act="toggle-overlay" aria-label="Paper panel on FOMO"></button>
          </div>
          <div class="toggle-row">
            <div><b>Discreet mode on FOMO</b><small>Takes the paper wording off the FOMO panel so it reads like an ordinary terminal. Fills stay simulated.</small></div>
            <button class="switch" role="switch" aria-checked="${!!s.discreetOverlay}" data-act="toggle-discreet" aria-label="Discreet mode on FOMO"></button>
          </div>
          ${
            state.user && state.account
              ? `<div class="toggle-row">
            <div><b>Reset paper account</b><small class="num">Start over with new capital. Now ${formatUsd(state.account.startingBalance, { decimals: 0 })}.</small></div>
            <button class="btn sm" data-act="open-reset">Reset</button>
          </div>`
              : ''
          }
        </div>

        <div class="group">
          <div class="toggle-row">
            <div><b>Policies</b><small>What we store, what the rules are, and the licences behind the extension.</small></div>
            <button class="btn sm" data-act="open-docs" data-section="about">Read</button>
          </div>
          <div class="policy-links">
            <button class="link-btn" data-act="open-docs" data-section="privacy">Privacy policy</button>
            <button class="link-btn" data-act="open-docs" data-section="terms">Terms</button>
            <button class="link-btn" data-act="open-docs" data-section="storage">Storage &amp; cookies</button>
            <button class="link-btn" data-act="open-docs" data-section="notices">Third-party notices</button>
          </div>
          ${
            state.user
              ? `<div class="toggle-row danger-row">
            <div><b>Delete account and data</b><small>Removes your profile, trades and history from the server. This cannot be undone.</small></div>
            <button class="btn sm danger" data-act="delete-account" data-armed="false">Delete account and data</button>
          </div>`
              : ''
          }
        </div>
        <div class="field">
          <label>Paper server</label>
          <div class="server-status ${state.serverError ? 'down' : 'ok'}">
            <span class="dot" aria-hidden="true"></span>
            <span>${
              state.serverError
                ? `<b>Offline.</b> ${escapeHtml(state.serverError.message)}`
                : `Connected, market data from ${escapeHtml(state.config?.marketDataProvider || 'the server')}`
            }</span>
          </div>
          <span class="status-text num">${escapeHtml(String(s.serverUrl).replace(/^https?:\/\//, ''))}</span>
        </div>
        <div class="actions">
          <button class="btn" data-act="close-sheet">Done</button>
          ${state.user ? `<button class="btn" data-act="signout">${icons.signout(16)} Sign out</button>` : '<span></span>'}
        </div>
      </div>
    </div>`;
}

// ---------- events ----------
app.addEventListener('click', async (e) => {
  if (state.capital && handleCapitalEvent(e, state.capital, state.config, { busy: state.busy })) return;

  // Close the profile menu on any click outside it.
  if (state.profileOpen && !e.target.closest('.profile')) {
    state.profileOpen = false;
    renderTopbar();
  }

  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) return switchTab(tabBtn.dataset.tab);

  const posTab = e.target.closest('[data-pos-tab]');
  if (posTab) {
    state.posTab = posTab.dataset.posTab;
    state.expandedRow = null;
    if (state.posTab === 'closed' && state.closedTrades === null) renderView();
    return loadTabData();
  }
  const priceMode = e.target.closest('[data-price-mode]');
  if (priceMode) {
    state.settings = await updateSettings({ priceDisplay: priceMode.dataset.priceMode });
    return renderView();
  }
  const sideBtn = e.target.closest('[data-filter-side]');
  if (sideBtn) {
    state.filters.side = sideBtn.dataset.filterSide;
    state.trades = null;
    renderView();
    return loadTabData();
  }
  const scope = e.target.closest('[data-filter-scope]');
  if (scope) {
    state.filters.scope = scope.checked ? 'all' : 'current';
    state.trades = null;
    renderView();
    return loadTabData();
  }

  const target = e.target.closest('[data-act]');
  if (!target) return;
  const act = target.dataset.act;

  switch (act) {
    case 'code': {
      const input = app.querySelector('#access-code');
      const code = input?.value?.trim() ?? '';
      if (!code) {
        input?.focus();
        break;
      }
      state.busy = true;
      renderView();
      try {
        await api.signInWithCode(code);
        await loadAccount();
        render();
        flash('ok', 'Account unlocked.');
      } catch (err) {
        flash('err', err.message);
      } finally {
        state.busy = false;
        renderView();
      }
      break;
    }
    case 'retry-config':
      await loadConfig();
      render();
      break;
    case 'toggle-profile':
      state.profileOpen = !state.profileOpen;
      renderTopbar();
      break;
    case 'goto-portfolio':
      switchTab('portfolio');
      break;
    case 'toggle-row':
      state.expandedRow = state.expandedRow === target.dataset.row ? null : target.dataset.row;
      renderView();
      break;
    case 'toggle-dust':
      state.settings = await updateSettings({ hideDust: state.settings.hideDust === false });
      renderView();
      break;
    case 'toggle-trade':
      state.expandedTrade = state.expandedTrade === target.dataset.id ? null : target.dataset.id;
      renderView();
      break;
    case 'toggle-dates':
      state.showDates = !state.showDates;
      if (!state.showDates && (state.filters.from || state.filters.to)) {
        Object.assign(state.filters, { from: '', to: '' });
        state.trades = null;
        loadTabData();
      }
      renderView();
      break;
    case 'open-token':
      openToken(target.dataset.chain, target.dataset.address);
      break;
    case 'share-pnl': {
      const data = findShareData(target.dataset.share, { positions: state.portfolio?.positions, closed: state.closedTrades });
      if (data) openPnlCard({ data, user: state.user });
      break;
    }
    case 'close-row': {
      if (state.busy) break;
      state.busy = true;
      renderView();
      try {
        const res = await api.closePosition({ chain: target.dataset.chain, address: target.dataset.address, clientRequestId: crypto.randomUUID() });
        state.expandedRow = null;
        state.closedTrades = null;
        flash(res.trade.realizedPnl < 0 ? 'err' : 'ok', `Closed ${res.trade.symbol} at ${formatPrice(res.trade.executionPrice)}, P&L ${formatUsd(res.trade.realizedPnl, { sign: true })}`);
      } catch (err) {
        flash('err', err.message);
      } finally {
        state.busy = false;
        loadTabData();
      }
      break;
    }
    case 'export':
      await exportHistory(target.dataset.format);
      break;
    case 'start-account': {
      const invalid = capitalError(state.capital, state.config);
      if (invalid || state.busy) break;
      const name = app.querySelector('[name="setupName"]')?.value ?? state.nameDraft ?? '';
      state.nameDraft = name;
      state.nameError = nameError(name);
      if (state.nameError) {
        renderView();
        app.querySelector('[name="setupName"]')?.focus();
        break;
      }
      readConsentBoxes();
      state.consentError = consentError();
      if (state.consentError) {
        renderView();
        break;
      }
      state.busy = true;
      state.capitalError = null;
      renderView();
      try {
        await api.consent({ acceptedTerms: true, confirmedAge: true });
        state.needsConsent = false;
        const profile = await api.updateProfile({ displayName: name.trim() });
        state.user = profile.user;
        const res = await api.startAccount(capitalAmount(state.capital));
        Object.assign(state, { account: res.account, needsSetup: false, capital: null, nameDraft: null, nameError: null, tab: 'trade', busy: false });
        render();
        flash('ok', `You're set with ${formatUsd(res.account.startingBalance)} in virtual cash. Open any token on fomo.family to start.`);
        loadTabData();
      } catch (err) {
        state.busy = false;
        if (err.code === 'ACCOUNT_ALREADY_STARTED') {
          await loadAccount();
          render();
        } else {
          state.capitalError = err.message;
          renderView();
        }
      }
      break;
    }
    case 'open-fomo':
      chrome.tabs.create({ url: 'https://fomo.family/' });
      break;
    case 'copy-support': {
      const value = target.dataset.copy || '';
      const label = target.firstChild;
      try {
        await navigator.clipboard.writeText(value);
        // Confirm in place: re-rendering here would swap the button under the cursor.
        const was = label.textContent;
        target.classList.add('copied');
        label.textContent = 'Copied';
        clearTimeout(target.dataset.timer);
        setTimeout(() => {
          if (!target.isConnected) return;
          label.textContent = was;
          target.classList.remove('copied');
        }, 1600);
      } catch {
        flash('err', 'Copy was blocked. Select the text and copy it by hand.');
      }
      break;
    }
    case 'open-support':
      chrome.tabs.create({ url: SUPPORT.fomoUrl });
      break;
    case 'toggle-support':
      state.settings = await updateSettings({ supportCollapsed: state.settings?.supportCollapsed !== true });
      renderView();
      break;
    case 'open-docs':
      chrome.tabs.create({ url: chrome.runtime.getURL(`src/docs/docs.html#${target.dataset.section || 'about'}`) });
      break;
    case 'accept-consent': {
      readConsentBoxes();
      state.consentError = consentError();
      if (state.consentError || state.busy) {
        renderView();
        break;
      }
      state.busy = true;
      renderView();
      try {
        await api.consent({ acceptedTerms: true, confirmedAge: true });
        state.needsConsent = false;
        state.busy = false;
        render();
        loadTabData();
      } catch (err) {
        state.busy = false;
        state.consentError = err.message;
        renderView();
      }
      break;
    }
    case 'delete-account': {
      // Two taps: the first arms the button, the second erases everything.
      if (target.dataset.armed !== 'true') {
        target.dataset.armed = 'true';
        target.textContent = 'Tap again to confirm';
        target.classList.add('confirm');
        setTimeout(() => {
          if (!target.isConnected) return;
          target.dataset.armed = 'false';
          target.textContent = 'Delete account and data';
          target.classList.remove('confirm');
        }, 5000);
        break;
      }
      target.disabled = true;
      try {
        await api.deleteAccount();
        Object.assign(state, {
          user: null,
          account: null,
          portfolio: null,
          trades: null,
          closedTrades: null,
          sheet: null,
          needsSetup: false,
          needsConsent: false,
          capital: null,
          consent: { age: false, terms: false },
        });
        render();
      } catch (err) {
        target.disabled = false;
        flash('err', err.message);
      }
      break;
    }
    case 'open-reset':
      state.sheet = 'reset';
      state.capital = null;
      state.capitalError = null;
      renderSheet();
      break;
    case 'confirm-reset': {
      const invalid = capitalError(state.capital, state.config);
      if (invalid || state.busy) break;
      state.busy = true;
      renderSheet();
      try {
        const res = await api.resetAccount(capitalAmount(state.capital));
        Object.assign(state, { account: res.account, portfolio: null, trades: null, closedTrades: null, sheet: null, capital: null, capitalError: null });
        flash('ok', `New paper account started with ${formatUsd(res.account.startingBalance)}.`);
      } catch (err) {
        state.capitalError = err.message;
      } finally {
        state.busy = false;
        renderSheet();
        renderTopbar();
        loadTabData();
      }
      break;
    }
    case 'open-settings':
      state.profileOpen = false;
      renderTopbar();
      state.sheet = 'settings';
      renderSheet();
      break;
    case 'close-sheet':
      state.sheet = null;
      state.capital = null;
      state.capitalError = null;
      renderSheet();
      break;
    case 'toggle-overlay':
      state.settings = await updateSettings({ overlayEnabled: !state.settings.overlayEnabled });
      renderSheet();
      break;
    case 'pick-photo':
      app.querySelector('[data-el="photoInput"]')?.click();
      break;
    case 'remove-photo':
      await saveProfile({ photoUrl: null }, 'Picture removed.');
      break;
    case 'save-profile': {
      const field = app.querySelector('[name="profileName"]');
      const name = field?.value ?? '';
      state.nameDraft = name;
      state.nameError = nameError(name);
      if (state.nameError) {
        setProfileNote(app.querySelector('[data-el="profileNote"]'), 'err', state.nameError);
        field?.focus();
        break;
      }
      await saveProfile({ displayName: name.trim() }, 'Username saved.');
      break;
    }
    case 'toggle-discreet':
      state.settings = await updateSettings({ discreetOverlay: !state.settings.discreetOverlay });
      renderSheet();
      break;
    case 'signout':
      state.sheet = null;
      state.profileOpen = false;
      renderSheet();
      await api.signOut();
      break;
    case 'clear-manual':
      state.manualAsset = null;
      tradePanel?.setAsset(null);
      renderAssetBar();
      break;
  }
});

// Clicking the scrim (outside the sheet) closes it.
app.addEventListener(
  'click',
  (e) => {
    if (e.target.classList?.contains('scrim')) {
      state.sheet = null;
      state.capital = null;
      renderSheet();
      e.stopImmediatePropagation();
    }
  },
  true,
);

app.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  switch (form.dataset.form) {
    case 'dev':
      // Dev form removed: use the access code instead.
      break;
    case 'manual': {
      const asset = parseManualAsset(data.asset);
      if (!asset) {
        state.manualError = 'Paste a fomo.family token link, a DexScreener link, or chain:address.';
      } else {
        state.manualError = null;
        state.manualAsset = asset;
        tradePanel?.setAsset(asset);
      }
      renderAssetBar();
      break;
    }
  }
});

// On the document, not the app element: with nothing focused inside the panel, key events
// never reach `app`, so Escape would be ignored while a sheet is open.
document.addEventListener('keydown', (e) => {
  if (state.capital) handleCapitalEvent(e, state.capital, state.config, { busy: state.busy });
  if (e.key !== 'Escape') return;
  if (state.profileOpen) {
    state.profileOpen = false;
    renderTopbar();
  } else if (state.sheet) {
    state.sheet = null;
    state.capital = null;
    state.capitalError = null;
    renderSheet();
  }
});

let filterTimer = null;
app.addEventListener('input', (e) => {
  if (state.capital && handleCapitalEvent(e, state.capital, state.config, { busy: state.busy })) return;
  const form = e.target.closest('[data-form="filters"]');
  if (!form || e.target.type === 'checkbox') return;
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    const data = Object.fromEntries(new FormData(form));
    state.filters.asset = String(data.asset || '').trim();
    if (state.showDates) {
      state.filters.from = data.from || '';
      state.filters.to = data.to || '';
    }
    loadHistoryKeepingFocus();
  }, 300);
});

/** Date inputs are local calendar days; send them to the server as UTC instants. */
function historyParams() {
  const f = state.filters;
  return {
    ...f,
    from: f.from ? new Date(`${f.from}T00:00:00`).toISOString() : '',
    to: f.to ? new Date(`${f.to}T23:59:59.999`).toISOString() : '',
  };
}

async function loadHistoryKeepingFocus() {
  const active = document.activeElement;
  const name = active?.name;
  const caret = active?.selectionStart;
  try {
    state.trades = (await api.trades(historyParams())).trades;
  } catch (err) {
    flash('err', err.message);
  }
  renderView();
  if (name) {
    const el = viewHost.querySelector(`[name="${name}"]`);
    el?.focus();
    if (caret !== undefined && caret !== null && el?.setSelectionRange && el.type !== 'date') el.setSelectionRange(caret, caret);
  }
}

async function exportHistory(format) {
  state.busy = true;
  renderView();
  try {
    const file = await api.export(format);
    const blob = new Blob([file.text], { type: file.contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    flash('ok', `Downloaded ${file.filename}`);
  } catch (err) {
    flash('err', err.message);
  } finally {
    state.busy = false;
    renderView();
  }
}

async function openToken(chain, address) {
  const url = `https://fomo.family/tokens/${encodeURIComponent(chain)}/${encodeURIComponent(address)}`;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.startsWith('https://fomo.family')) chrome.tabs.update(tab.id, { url });
  else chrome.tabs.create({ url });
}

init();

// ---------- profile (username + picture) ----------
/**
 * Saves the profile by updating the card in place. Re-rendering the whole sheet here made the
 * fields jump and lose focus, so only the picture, the buttons and the note change.
 */
async function saveProfile(patch, okMessage) {
  if (state.profileBusy) return;
  const card = app.querySelector('.profile-edit');
  if (!card) return;
  const el = {};
  card.querySelectorAll('[data-el]').forEach((n) => (el[n.dataset.el] = n));
  const buttons = [...card.querySelectorAll('button')];
  let saved = false;

  state.profileBusy = true;
  state.nameError = null;
  buttons.forEach((b) => (b.disabled = true));
  el.saveProfile.textContent = 'Saving…';
  setProfileNote(el.profileNote, '', '');

  try {
    const { user } = await api.updateProfile(patch);
    state.user = user;
    state.nameDraft = null;
    el.pfpSlot.innerHTML = avatarPreview(user);
    el.pickPhoto.querySelector('span').textContent = user.photoUrl ? 'Change picture' : 'Add picture';
    el.removePhoto.hidden = !user.photoUrl;
    if (document.activeElement !== el.profileName) el.profileName.value = user.displayName || '';
    setProfileNote(el.profileNote, 'ok', okMessage);
    showSaved(el.saveProfile, el.pfpSlot);
    saved = true;
    renderTopbar();
  } catch (err) {
    state.nameError = err.message;
    setProfileNote(el.profileNote, 'err', err.message);
  } finally {
    state.profileBusy = false;
    buttons.forEach((b) => (b.disabled = false));
    el.removePhoto.hidden = !state.user?.photoUrl;
    if (!saved) el.saveProfile.textContent = 'Save';
  }
}

/** Green tick on the button and the picture, so a save is obvious without anything moving. */
function showSaved(button, pfpSlot) {
  clearTimeout(showSaved.timer);
  button.classList.add('saved');
  button.innerHTML = `${icons.check(14)} Saved`;
  const badge = document.createElement('span');
  badge.className = 'pfp-tick';
  badge.innerHTML = icons.check(12);
  pfpSlot.querySelector('.pfp-tick')?.remove();
  pfpSlot.appendChild(badge);
  showSaved.timer = setTimeout(() => {
    button.classList.remove('saved');
    button.textContent = 'Save';
    badge.remove();
  }, 1800);
}

function setProfileNote(node, kind, text) {
  if (!node) return;
  node.className = `profile-note ${kind}`;
  node.textContent = text;
}

// A picked picture is cropped square and shrunk here, so only a few kilobytes reach the server.
app.addEventListener('change', async (e) => {
  if (e.target.dataset.el !== 'photoInput') return;
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const photoUrl = await fileToAvatarDataUrl(file);
    await saveProfile({ photoUrl }, 'Picture updated.');
  } catch (err) {
    state.nameError = err.message;
    setProfileNote(app.querySelector('[data-el="profileNote"]'), 'err', err.message);
  }
});

// Typing in the setup or settings name field keeps its own state, so a background refresh can't wipe it.
app.addEventListener('input', (e) => {
  if (e.target.name === 'setupName' || e.target.name === 'profileName') state.nameDraft = e.target.value;
});

// ---------- consent (age + terms) ----------
function readConsentBoxes() {
  const age = app.querySelector('[name="confirmAge"]');
  const terms = app.querySelector('[name="acceptTerms"]');
  if (age) state.consent.age = age.checked;
  if (terms) state.consent.terms = terms.checked;
}

function consentError() {
  const age = state.config?.minimumAge ?? 18;
  if (!state.consent.age) return `Confirm you are ${age} or older.`;
  if (!state.consent.terms) return 'Accept the terms and privacy policy to continue.';
  return null;
}
