// Everything that depends on FOMO's markup lives here. Detection is text-based (the
// labels users see) rather than class-based, because utility class names churn.
// Labels verified against fomo.family's web bundle: "Buy", "Sell", "Buy {symbol}",
// "Sell {symbol}", "Enter amount", "Closed trades".

export const TOKEN_PATH = /^\/tokens\/([A-Za-z0-9_-]+)\/([A-Za-z0-9]{20,66})\/?$/;
export const LEGACY_TOKEN_PATH = /^\/token\/?$/;

export const LABELS = {
  buyTab: /^buy$/i,
  sellTab: /^sell$/i,
  actionButton: /^(buy|sell)\s+(\S{1,20})$/i,
  enterAmount: /^enter amount$/i,
  closedTrades: /^closed trades$/i,
};

const MAX_PANEL_WIDTH = 640;
const MAX_PANEL_HEIGHT = 1100;

const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

function isVisible(el) {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.01;
}

/** Buy/Sell tab pair that sit next to each other. */
export function findSideTabs(root = document, ignore = null) {
  const buttons = [...root.querySelectorAll('button, [role="tab"]')].filter((b) => !ignore?.contains(b));
  for (const buy of buttons) {
    if (!LABELS.buyTab.test(text(buy)) || !isVisible(buy)) continue;
    const parent = buy.parentElement;
    const sell = parent && [...parent.children].find((c) => c !== buy && LABELS.sellTab.test(text(c)));
    if (sell) return { buy, sell, container: parent };
  }
  return null;
}

/** "Buy GCAT" / "Sell GCAT" confirm button inside a container. */
export function findActionButton(root, ignore = null) {
  return (
    [...root.querySelectorAll('button')].find((b) => !ignore?.contains(b) && LABELS.actionButton.test(text(b)) && isVisible(b)) || null
  );
}

function containsText(root, re) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.currentNode; node; node = walker.nextNode()) {
    if (node.childElementCount === 0 && re.test(text(node))) return node;
  }
  return null;
}

/**
 * Smallest ancestor of the Buy/Sell tabs that also holds the amount field and the
 * confirm button, grown to include "Closed trades" when that stays panel-sized.
 */
export function findTradePanel(ignore = null) {
  const tabs = findSideTabs(document, ignore);
  if (!tabs) return null;

  let panel = null;
  for (let el = tabs.container.parentElement; el && el !== document.body; el = el.parentElement) {
    const r = el.getBoundingClientRect();
    if (r.width > MAX_PANEL_WIDTH || r.height > MAX_PANEL_HEIGHT) break;
    if (findActionButton(el, ignore) && containsText(el, LABELS.enterAmount)) {
      panel = el;
      break;
    }
  }
  if (!panel) return null;

  for (let el = panel.parentElement; el && el !== document.body; el = el.parentElement) {
    const r = el.getBoundingClientRect();
    if (r.width > MAX_PANEL_WIDTH || r.height > MAX_PANEL_HEIGHT) break;
    if (containsText(el, LABELS.closedTrades)) {
      panel = el;
      break;
    }
  }
  return panel;
}

/** Ticker from the confirm button, e.g. "Buy GCAT" -> "GCAT". */
export function readSymbol(panel) {
  const btn = panel && findActionButton(panel);
  const match = btn && LABELS.actionButton.exec(text(btn));
  return match ? match[2].replace(/^\$/, '') : null;
}
