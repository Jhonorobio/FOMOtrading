// Toolbar popup: the FOMO-style balance header, the token on the current FOMO tab, a short
// positions list (same rows as FOMO and the side panel), the paper-mode switch and a way into
// the full side panel.
import { renderAppHeader } from '../components/app-header.js';
import { capitalAmount, capitalError, createCapitalChoice, handleCapitalEvent, renderCapitalPicker } from '../components/capital-picker.js';
import { escapeHtml, formatPct, formatPrice, formatQty, formatUsd, pnlClass } from '../components/format.js';
import { icons } from '../components/icons.js';
import { attachPositionHover, avatar, hydrateLogos, positionsListHtml } from '../components/positions.js';
import { findShareData, openPnlCard } from '../components/pnl-card.js';
import { PANEL_CSS } from '../components/styles.js';
import { parseAssetFromUrl } from '../integrations/target-terminal/adapter.js';
import { api } from '../services/api.js';
import { getSessionUser, getSettings, onStateChange, updateSettings } from '../storage/settings.js';

const style = document.createElement('style');
style.textContent = `${PANEL_CSS}\n:root { --font: 'Geist', ui-sans-serif, system-ui, sans-serif; }`;
document.head.appendChild(style);

const POPUP_ROWS = 4;
const app = document.getElementById('app');
const state = {
  user: null,
  config: null,
  settings: null,
  serverError: null,
  portfolio: null,
  asset: null,
  assetState: null,
  banner: null,
  busy: false,
  account: null,
  needsSetup: false,
  needsConsent: false,
  capital: null,
  capitalError: null,
  profileOpen: false,
  expandedRow: null,
  loaded: false,
};

// sidePanel.open() must run synchronously inside the click, so resolve the window up front.
let windowId = null;

attachPositionHover(app);

async function init() {
  const [win, [tab], settings, user] = await Promise.all([
    chrome.windows.getCurrent(),
    chrome.tabs.query({ active: true, currentWindow: true }),
    getSettings(),
    getSessionUser(),
  ]);
  windowId = win.id;
  Object.assign(state, { settings, user, asset: tab?.url ? parseAssetFromUrl(tab.url) : null });
  render();
  await load();

  onStateChange(async (changes) => {
    if (changes.settings) state.settings = await getSettings();
    if (changes.session) state.user = await getSessionUser();
    if (changes.session || changes.portfolioVersion) await load();
    else render();
  });
}

async function load() {
  try {
    state.config = await api.config();
    state.serverError = null;
  } catch (err) {
    state.serverError = err;
    state.loaded = true;
    render();
    return;
  }
  if (state.user) {
    try {
      const me = await api.me();
      state.account = me.account;
      state.needsSetup = me.needsSetup;
      state.needsConsent = me.needsConsent === true;
    } catch (err) {
      flash('err', err.message);
    }
  }
  if (state.user && !state.needsSetup) {
    const [portfolio, assetState] = await Promise.allSettled([api.portfolio(), state.asset ? api.assetState(state.asset) : Promise.resolve(null)]);
    if (portfolio.status === 'fulfilled') state.portfolio = portfolio.value;
    else flash('err', portfolio.reason.message);
    state.assetState = assetState.status === 'fulfilled' ? assetState.value : null;
  }
  state.loaded = true;
  render();
}

function flash(kind, text) {
  state.banner = { kind, text };
  render();
  setTimeout(() => {
    if (state.banner?.text === text) {
      state.banner = null;
      render();
    }
  }, 5000);
}

// ---------- render ----------
function render() {
  const banner = state.banner ? `<div class="banner ${state.banner.kind}" role="status">${escapeHtml(state.banner.text)}</div>` : '';
  const offline = state.serverError
    ? `<div class="banner err" role="status">${escapeHtml(state.serverError.message)} <button class="inline-btn" data-act="retry">Retry</button></div>`
    : '';
  let body;
  if (!state.loaded) body = `<div class="sk" style="height:220px;border-radius:14px" aria-hidden="true"></div>`;
  else if (!state.user) body = renderSignedOut();
  else if (state.needsSetup) body = renderSetup();
  else body = renderSignedIn();

  app.innerHTML = `
    <div class="shell">
      <header class="topbar">${renderAppHeader({
        user: state.user,
        account: state.needsSetup ? null : state.account,
        performance: state.portfolio?.performance ?? null,
        profileOpen: state.profileOpen,
      })}</header>
      <main class="view">${offline}${banner}${body}</main>
    </div>`;
  hydrateLogos(app);
}

function renderSignedOut() {
  return `
    <section class="welcome" style="padding:6px 2px 0">
      <div><h1 style="font-size:20px">Practice on FOMO with paper money</h1><p style="margin-top:4px">Same trading flow, virtual balance.</p></div>
      <div class="field" style="margin-top:12px">
        <label for="access-code">Access code</label>
        <input id="access-code" class="input" name="accessCode" type="text" autocomplete="off" spellcheck="false"
          placeholder="FOMO" maxlength="20" />
        <p class="fine">Enter the access code (<b>FOMO</b> or <b>fomo</b>) to unlock your personal paper account.</p>
      </div>
      <button class="btn primary block" data-act="code" ${state.busy || state.serverError ? 'disabled' : ''}>Unlock account</button>
    </section>`;
}

function renderSetup() {
  if (state.needsConsent) {
    return `
    <section class="welcome" style="padding:0">
      <ol class="steps compact">
        <li class="done"><span class="n">${icons.check(12)}</span><span>Signed in as <b>${escapeHtml(state.user.email)}</b></span></li>
        <li class="current"><span class="n">2</span><span><b>Confirm your age and accept the terms</b></span></li>
      </ol>
      <p class="fine">Paper Terminal is for ${state.config?.minimumAge ?? 18}s and over, and every trade it places is simulated.</p>
      <button class="btn primary block" data-act="sidepanel">${icons.panel(16)} Finish in the dashboard</button>
      <p class="fine"><button class="link-btn" data-act="open-docs" data-section="terms">Terms</button> ·
        <button class="link-btn" data-act="open-docs" data-section="privacy">Privacy policy</button></p>
    </section>`;
  }
  state.capital ??= createCapitalChoice(state.config);
  return `
    <section class="welcome" style="padding:0">
      <ol class="steps compact">
        <li class="done"><span class="n">${icons.check(12)}</span><span>Signed in as <b>${escapeHtml(state.user.email)}</b></span></li>
        <li class="current"><span class="n">2</span><span><b>Choose your starting capital</b></span></li>
      </ol>
      ${renderCapitalPicker({ config: state.config, choice: state.capital, busy: state.busy, submitAct: 'start-account', submitLabel: 'OK, start trading', error: state.capitalError })}
      <p class="fine">You can pick a new amount later with Reset in Settings.</p>
    </section>`;
}

function renderSignedIn() {
  const p = state.portfolio;
  const positions = p ? p.positions : null;
  const { html } = positionsListHtml({
    tab: 'open',
    positions,
    closed: null,
    hideDust: state.settings.hideDust !== false,
    expandedRow: state.expandedRow,
    priceDisplay: state.settings.priceDisplay === 'mcap' ? 'mcap' : 'price',
    pending: state.busy,
    linkMode: 'action',
    limit: POPUP_ROWS,
  });
  const on = state.settings?.overlayEnabled;
  return `
    ${renderCurrentToken()}
    <section class="positions">
      <div class="pos-head">
        <span class="pos-title">Your positions</span>
        <button class="link-btn" data-act="sidepanel-tab">${positions && positions.length > POPUP_ROWS ? `See all ${positions.length}` : 'See all'}</button>
      </div>
      <div class="pos-list">${html}</div>
    </section>
    <div class="box pad toggle-row">
      <div><b>Paper panel on FOMO</b><small>${on ? 'Covers the real Buy/Sell panel' : 'Real FOMO panel is active'}</small></div>
      <button class="switch" role="switch" aria-checked="${!!on}" data-act="toggle-overlay" aria-label="Paper panel on FOMO"></button>
    </div>
    <div style="display:grid;grid-template-columns:1fr auto;gap:8px">
      <button class="btn primary" data-act="sidepanel">${icons.panel(16)} Open dashboard</button>
      <button class="btn" data-act="export" aria-label="Download trading history as JSON" title="Download history (JSON)">${icons.download(16)}</button>
    </div>`;
}

function renderCurrentToken() {
  if (!state.asset) {
    return `<div class="asset-strip"><div class="grow"><b>No token open</b><small>Open a token to paper trade it.</small></div>
      <button class="btn sm" data-act="open-fomo">Open FOMO</button></div>`;
  }
  const q = state.assetState?.quote;
  const pos = state.assetState?.position;
  return `
    <div class="asset-strip">
      ${avatar(q?.symbol || '?', state.asset.chain, state.asset.address)}
      <div class="grow">
        <b class="num">${escapeHtml(q?.symbol || 'Loading…')} <span class="muted" style="font-weight:500">${q ? formatPrice(q.priceUsd) : ''}</span></b>
        <small class="num">${
          pos
            ? `${formatQty(pos.quantity)} held, <span class="${pnlClass(pos.unrealizedPnl)}">${formatUsd(pos.unrealizedPnl, { sign: true })} (${formatPct(pos.unrealizedPnlPct)})</span>`
            : 'No paper position yet'
        }</small>
      </div>
      ${pos ? `<span class="num" style="font-weight:700">${formatUsd(pos.marketValue)}</span>` : ''}
    </div>`;
}

// ---------- actions ----------
function openSidePanel(intent) {
  // Must be called synchronously inside the click.
  const opening = chrome.sidePanel.open({ windowId });
  if (intent) chrome.storage.local.set({ sidepanelIntent: { ...intent, at: Date.now() } });
  opening.then(() => window.close());
}

app.addEventListener('click', async (e) => {
  if (state.capital && handleCapitalEvent(e, state.capital, state.config, { busy: state.busy })) return;
  if (state.profileOpen && !e.target.closest('.profile')) {
    state.profileOpen = false;
    render();
  }
  const target = e.target.closest('[data-act]');
  if (!target) return;
  switch (target.dataset.act) {
    case 'sidepanel':
      openSidePanel();
      break;
    case 'sidepanel-tab':
    case 'goto-portfolio':
      openSidePanel({ action: 'tab', tab: 'portfolio' });
      break;
    case 'open-settings':
      openSidePanel({ action: 'settings' });
      break;
    case 'toggle-profile':
      state.profileOpen = !state.profileOpen;
      render();
      break;
    case 'retry':
      await load();
      break;
    case 'code': {
      const input = document.getElementById('access-code');
      const code = input?.value?.trim() ?? '';
      if (!code) {
        input?.focus();
        break;
      }
      state.busy = true;
      render();
      try {
        await api.signInWithCode(code);
        await load();
      } catch (err) {
        flash('err', err.message);
      } finally {
        state.busy = false;
        render();
      }
      break;
    }
    case 'start-account': {
      if (state.busy || capitalError(state.capital, state.config)) break;
      state.busy = true;
      state.capitalError = null;
      render();
      try {
        const res = await api.startAccount(capitalAmount(state.capital));
        Object.assign(state, { account: res.account, needsSetup: false, capital: null, busy: false });
        flash('ok', `You’re set with ${formatUsd(res.account.startingBalance)}. Open any token on fomo.family to trade.`);
        await load();
      } catch (err) {
        state.busy = false;
        state.capitalError = err.message;
        render();
      }
      break;
    }
    case 'signout':
      state.profileOpen = false;
      await api.signOut();
      Object.assign(state, { portfolio: null, assetState: null, banner: null, account: null, needsSetup: false, capital: null });
      render();
      break;
    case 'toggle-overlay':
      state.settings = await updateSettings({ overlayEnabled: !state.settings.overlayEnabled });
      render();
      break;
    case 'open-docs':
      chrome.tabs.create({ url: chrome.runtime.getURL(`src/docs/docs.html#${target.dataset.section || 'about'}`) });
      window.close();
      break;
    case 'open-fomo':
      chrome.tabs.create({ url: 'https://fomo.family/' });
      window.close();
      break;
    case 'open-token':
      chrome.tabs.create({ url: `https://fomo.family/tokens/${encodeURIComponent(target.dataset.chain)}/${encodeURIComponent(target.dataset.address)}` });
      window.close();
      break;
    case 'share-pnl': {
      const data = findShareData(target.dataset.share, { positions: state.portfolio?.positions });
      if (data) openPnlCard({ data, user: state.user });
      break;
    }
    case 'toggle-row':
      state.expandedRow = state.expandedRow === target.dataset.row ? null : target.dataset.row;
      render();
      break;
    case 'close-row': {
      if (state.busy) break;
      state.busy = true;
      render();
      try {
        const res = await api.closePosition({ chain: target.dataset.chain, address: target.dataset.address, clientRequestId: crypto.randomUUID() });
        state.expandedRow = null;
        flash(res.trade.realizedPnl < 0 ? 'err' : 'ok', `Closed ${res.trade.symbol}, P&L ${formatUsd(res.trade.realizedPnl, { sign: true })}`);
      } catch (err) {
        flash('err', err.message);
      } finally {
        state.busy = false;
        render();
      }
      break;
    }
    case 'export':
      try {
        const file = await api.export('json');
        const url = URL.createObjectURL(new Blob([file.text], { type: file.contentType }));
        const a = Object.assign(document.createElement('a'), { href: url, download: file.filename });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        flash('ok', `Downloaded ${file.filename}`);
      } catch (err) {
        flash('err', err.message);
      }
      break;
  }
});

app.addEventListener('input', (e) => {
  if (state.capital) handleCapitalEvent(e, state.capital, state.config, { busy: state.busy });
});
app.addEventListener('keydown', (e) => {
  if (state.capital) handleCapitalEvent(e, state.capital, state.config, { busy: state.busy });
  if (e.key === 'Escape' && state.profileOpen) {
    state.profileOpen = false;
    render();
  }
});

app.addEventListener('submit', async (e) => {
  e.preventDefault();
  // No dev form anymore; access code is handled via the 'code' action above.
});

init();
