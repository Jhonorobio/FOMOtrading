// Header for the popup and side panel, modelled on FOMO's own top bar: a cash card, an
// equity card with total P&L, and the profile avatar. "PAPER" sits where FOMO shows
// "Deposit more", so paper mode is always visible next to the balance.
import { escapeHtml, formatUsd, pnlClass } from './format.js';
import { icons } from './icons.js';

/**
 * @param {{ user: object|null, account: object|null, performance: object|null, profileOpen: boolean, compact?: boolean }} o
 */
export function renderAppHeader({ user, account, performance, profileOpen, compact = false }) {
  const logo = `<img class="brand-mark" src="../../icons/icon-48.png" alt="Paper Terminal" width="28" height="28" />`;
  if (!user || !account) {
    return `
      ${logo}
      <span class="wordmark">Paper Terminal</span>
      <span class="spacer"></span>
      <button class="icon-btn" data-act="open-settings" aria-label="Settings">${icons.gear(18)}</button>`;
  }
  const cash = performance?.cash ?? account.cashBalance;
  const equity = performance?.totalEquity ?? cash;
  const total = performance?.totalPnl ?? null;
  const initial = escapeHtml((user.displayName || user.email || '?').slice(0, 1).toUpperCase());
  return `
    ${compact ? '' : logo}
    <div class="head-cards">
      <button class="mini" data-act="goto-portfolio" title="Paper cash">
        <span class="v num">${formatUsd(cash)} <small>cash</small></span>
        <span class="s paper-tag">Paper</span>
      </button>
      <button class="mini" data-act="goto-portfolio" title="Paper equity: cash plus open positions">
        <span class="v num">${formatUsd(equity)}</span>
        <span class="s num ${pnlClass(total)}">${total === null ? '&nbsp;' : `${formatUsd(total, { sign: true })} <small>total</small>`}</span>
      </button>
    </div>
    <div class="profile" data-el="profile">
      <button class="avatar" data-act="toggle-profile" aria-haspopup="menu" aria-expanded="${profileOpen}" aria-label="Account menu">${
        user.photoUrl ? `<img src="${escapeHtml(user.photoUrl)}" alt="" width="34" height="34" referrerpolicy="no-referrer" />` : initial
      }</button>
      <div class="profile-menu" role="menu" ${profileOpen ? '' : 'hidden'}>
        <div class="pm-user"><b>${escapeHtml(user.displayName || 'Paper trader')}</b><small>${escapeHtml(user.email || '')}</small></div>
        <button role="menuitem" data-act="open-settings">${icons.gear(16)} Settings</button>
        <button role="menuitem" class="danger" data-act="signout">${icons.signout(16)} Sign out</button>
      </div>
    </div>`;
}
