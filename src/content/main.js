// Runs on every fomo.family page.
// - A Paper Terminal on/off switch sits in FOMO's top bar, next to FOMO's balance cards
//   (falls back to a draggable pill if the top bar can't be found).
// - When ON and a token page is open, the paper trade panel is placed exactly over
//   FOMO's Buy/Sell panel, and the real panel is made inert so a click can't reach it.
// - When OFF, nothing is covered and the real FOMO panel works normally.
import { PANEL_CSS } from '../components/styles.js';
import { icons } from '../components/icons.js';
import { LOGO_DATA_URL } from '../components/logo.js';
import { createTradePanel } from '../components/trade-panel.js';
import { createTargetTerminalAdapter, parseAssetFromUrl } from '../integrations/target-terminal/adapter.js';
import { readSymbol } from '../integrations/target-terminal/selectors.js';
import { extensionAlive, getSettings, onStateChange, updateSettings } from '../storage/settings.js';

const DETECT_MS = 500;
const FLOAT_AFTER_MS = 3500;

const OVERLAY_CSS = `
${PANEL_CSS}
:host { all: initial; }
[hidden] { display: none !important; }
.frame { position: fixed; z-index: 45; box-sizing: border-box; background: var(--bg-primary); overflow: hidden; }
.frame.anchored { border-radius: 12px; }
.frame.floating { top: 84px; right: 16px; width: 384px; max-width: calc(100vw - 32px); max-height: calc(100vh - 100px); overflow: auto; overscroll-behavior: contain;
  padding: 12px; border-radius: 16px; border: 1px solid var(--paper-line); box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6); z-index: 2147483000; }
.float-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font: 500 12px var(--font); color: var(--text-secondary); }
.float-head span { flex: 1; }
.frame:not(.floating) .float-head { display: none; }

/* Paper switch. Docked: a compact card in FOMO's top bar, same height as FOMO's balance cards.
   Violet outline even when OFF so the way into paper trading stays easy to spot. */
.toggle { -webkit-tap-highlight-color: rgba(168, 150, 255, 0.2); position: fixed; z-index: 2147483001; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 8px; height: 40px;
  border-radius: 12px; background: var(--bg-primary); border: 1px solid var(--paper-line);
  font: 700 13px var(--font); color: var(--text-primary); user-select: none; touch-action: none; cursor: pointer;
  transition: background-color .15s, border-color .15s; }
.toggle:hover { border-color: var(--paper-strong); }
.toggle.on { background: var(--paper-t); border-color: var(--paper-strong); }
.toggle .mark { width: 20px; height: 20px; border-radius: 6px; display: block; flex: none; }
.toggle .label { display: flex; flex-direction: column; line-height: 1.1; white-space: nowrap; }
.toggle .label small { font-size: 11px; font-weight: 600; color: var(--paper); }
.toggle.floating { height: auto; padding: 7px 8px 7px 10px; border-radius: 999px; background: #12111a; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); cursor: grab; }
.toggle.floating.on { background: #1a1730; }
.toggle.dragging { cursor: grabbing; }
/* Narrow windows: just the logo and the switch, parked in the bottom-left corner. */
.toggle.corner { gap: 6px; padding: 5px 6px 5px 7px; }
.toggle.corner .label { display: none; }
.toggle.corner .mark { width: 18px; height: 18px; }
.switch { position: relative; width: 34px; height: 20px; border-radius: 999px; border: 0; padding: 0; cursor: pointer; flex: none;
  background: rgba(203, 208, 235, 0.18); transition: background-color .15s; }
.switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
  background: var(--text-primary); transition: transform .15s; }
.switch:hover { background: rgba(203, 208, 235, 0.3); }
.switch[aria-checked="true"] { background: var(--green); }
.switch[aria-checked="true"]:hover { background: #2ad96a; }
.switch[aria-checked="true"]::after { transform: translateX(14px); }
@media (prefers-reduced-motion: no-preference) {
  .toggle.nudge { animation: paper-nudge 1.6s ease-out 1; }
  @keyframes paper-nudge { 0% { box-shadow: 0 0 0 0 rgba(168, 150, 255, 0.55); } 100% { box-shadow: 0 0 0 10px rgba(168, 150, 255, 0); } }
}
.switch:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
`;

export async function start() {
  const adapter = createTargetTerminalAdapter();
  let settings = await getSettings();

  let host = null;
  let frame = null;
  let toggle = null;
  let panel = null;
  let asset = null;
  let anchor = null;
  let anchorRestore = null;
  let scrollParents = [];
  let lastHref = '';
  let routeAt = 0;
  let lastSymbol = null;
  let rafId = 0;
  let resizeObserver = null;

  // ----- persistent host + on/off switch -----
  function ensureHost() {
    if (host) {
      if (!host.isConnected) document.documentElement.appendChild(host);
      return;
    }
    host = document.createElement('div');
    host.id = 'paper-terminal-overlay';
    adapter.ignore(host);
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;

    frame = document.createElement('div');
    frame.className = 'frame';
    frame.hidden = true;
    frame.innerHTML = `<div class="float-head">${icons.paper(14)}<span>Trade panel not found, showing a floating paper panel</span></div>`;

    toggle = document.createElement('div');
    toggle.className = 'toggle';
    toggle.title = 'Paper trading on or off (Alt+Shift+O)';
    toggle.innerHTML = `
      <img class="mark" src="${LOGO_DATA_URL}" alt="" width="20" height="20" />
      <span class="label"><span data-el="word">Paper</span><small data-el="state"></small></span>
      <button class="switch" role="switch" aria-label="Paper trading on or off"></button>`;
    setupToggle();

    shadow.append(style, frame, toggle);
    document.documentElement.appendChild(host);
    renderToggle();
  }

  function renderToggle() {
    if (!toggle) return;
    const on = settings.overlayEnabled;
    toggle.classList.toggle('on', on);
    toggle.querySelector('.switch').setAttribute('aria-checked', String(on));
    toggle.querySelector('[data-el="state"]').textContent = on ? 'On' : 'Off';
    // Discreet mode: the switch keeps the logo and state, without the word on the page.
    toggle.querySelector('[data-el="word"]').hidden = settings.discreetOverlay === true;
    toggle.title = on ? 'Paper trading is on. Click to use the real FOMO panel.' : 'Paper trading is off. Click to practice with paper money.';
    // One-time attention pulse when paper mode is off on a token page, so it's easy to find.
    if (!on && asset && !nudged) {
      nudged = true;
      toggle.classList.add('nudge');
    }
    placeToggle();
  }

  let nudged = false;
  let headerAnchor = null;

  /** FOMO's top-right cash card ("$0.00 cash / Deposit more") or its Login button; the switch docks to its left. */
  function findHeaderAnchor() {
    if (headerAnchor?.isConnected) return headerAnchor;
    headerAnchor = null;
    const xpath = "//*[normalize-space(text())='Deposit more' or normalize-space(text())='Login' or normalize-space(text())='Log in' or normalize-space(text())='Sign up']";
    const hits = document.evaluate(xpath, document.body, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < hits.snapshotLength; i++) {
      const el = hits.snapshotItem(i);
      const r = el.getBoundingClientRect();
      if (!r.width || r.top > 90 || r.left < window.innerWidth / 2) continue;
      // Climb only while the box is still card-sized (FOMO's cash card or the Login button).
      // Wider wrappers can stretch across the whole top bar, which would push the switch onto the search field.
      let best = el;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const pr = p.getBoundingClientRect();
        if (pr.width > 280 || pr.height > 72 || pr.top > 90) break;
        best = p;
      }
      headerAnchor = best;
      return best;
    }
    return null;
  }

  const DOCKED_WIDTH = 128;
  const MIN_DOCK_VIEWPORT = 1000;
  let dockCheck = { key: '', fits: false };

  /** True when the spot left of FOMO's cash card is empty (no search field, buttons or links under it). */
  function dockFits(g, left, top, h) {
    const key = `${window.innerWidth}|${Math.round(g.left)}|${Math.round(g.top)}`;
    // Measuring every header control is costly, so a previous answer stands for a second.
    if (dockCheck.key === key || (dockCheck.at && Date.now() - dockCheck.at < 1000)) return dockCheck.fits;
    const right = left + DOCKED_WIDTH;
    const bottom = top + h;
    let fits = window.innerWidth >= MIN_DOCK_VIEWPORT && left >= 8;
    if (fits) {
      for (const el of document.querySelectorAll('header input, header button, header a, input, [role="search"]')) {
        if (host.contains(el)) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || r.top > 90) continue;
        if (r.left < right + 4 && r.right > left - 4 && r.top < bottom && r.bottom > top) {
          fits = false;
          break;
        }
      }
    }
    dockCheck = { key, fits, at: Date.now() };
    return fits;
  }

  function placeToggle() {
    const group = findHeaderAnchor();
    if (group) {
      const g = group.getBoundingClientRect();
      if (g.width > 0) {
        const h = Math.max(32, Math.min(48, Math.round(g.height > 60 ? 40 : g.height)));
        const left = g.left - DOCKED_WIDTH - 8;
        const top = g.top + (g.height - h) / 2;
        if (dockFits(g, left, top, h)) {
          toggle.classList.remove('floating', 'corner');
          Object.assign(toggle.style, { height: `${h}px`, left: `${left}px`, top: `${top}px` });
          return;
        }
        // Narrow window: tuck a small logo + switch pill into the bottom-left corner instead.
        toggle.classList.add('floating', 'corner');
        toggle.style.height = '';
        const pos = settings.togglePosition;
        const w = toggle.offsetWidth || 72;
        const ch = toggle.offsetHeight || 34;
        const x = pos ? Math.min(Math.max(8, pos.x * window.innerWidth), window.innerWidth - w - 8) : 12;
        const y = pos ? Math.min(Math.max(8, pos.y * window.innerHeight), window.innerHeight - ch - 8) : window.innerHeight - ch - 64;
        Object.assign(toggle.style, { left: `${x}px`, top: `${y}px` });
        return;
      }
    }
    toggle.classList.add('floating');
    toggle.classList.remove('corner');
    toggle.style.height = '';
    const pos = settings.togglePosition;
    const w = toggle.offsetWidth || 220;
    const h = toggle.offsetHeight || 44;
    const x = pos ? Math.min(Math.max(8, pos.x * window.innerWidth), window.innerWidth - w - 8) : 16;
    const y = pos ? Math.min(Math.max(8, pos.y * window.innerHeight), window.innerHeight - h - 8) : window.innerHeight - h - 16;
    Object.assign(toggle.style, { left: `${x}px`, top: `${y}px` });
  }

  function setupToggle() {
    const sw = toggle.querySelector('.switch');
    sw.addEventListener('click', (e) => {
      e.stopPropagation();
      updateSettings({ overlayEnabled: !settings.overlayEnabled });
    });

    // Drag anywhere on the pill (except the switch) to move it; position is remembered.
    let drag = null;
    toggle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.switch') || e.button !== 0) return;
      if (!toggle.classList.contains('floating')) {
        updateSettings({ overlayEnabled: !settings.overlayEnabled });
        return;
      }
      const r = toggle.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
      toggle.setPointerCapture(e.pointerId);
    });
    toggle.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const x = Math.min(Math.max(8, e.clientX - drag.dx), window.innerWidth - toggle.offsetWidth - 8);
      const y = Math.min(Math.max(8, e.clientY - drag.dy), window.innerHeight - toggle.offsetHeight - 8);
      drag.moved = true;
      toggle.classList.add('dragging');
      Object.assign(toggle.style, { left: `${x}px`, top: `${y}px` });
    });
    toggle.addEventListener('pointerup', (e) => {
      if (!drag) return;
      toggle.releasePointerCapture(e.pointerId);
      toggle.classList.remove('dragging');
      if (drag.moved) {
        const r = toggle.getBoundingClientRect();
        updateSettings({ togglePosition: { x: r.left / window.innerWidth, y: r.top / window.innerHeight } });
      } else {
        updateSettings({ overlayEnabled: !settings.overlayEnabled });
      }
      drag = null;
    });
    window.addEventListener('resize', placeToggle);
  }

  // ----- paper panel lifecycle -----
  function mountPanel() {
    if (panel) return;
    panel = createTradePanel({ root: frame, mode: 'overlay', onUseRealPanel: () => updateSettings({ overlayEnabled: false }) });
    resizeObserver = new ResizeObserver(syncAnchorHeight);
    resizeObserver.observe(panel.element);
    panel.setAsset({ ...asset, symbol: lastSymbol });
  }

  function unmountPanel() {
    releaseAnchor();
    cancelAnimationFrame(rafId);
    rafId = 0;
    resizeObserver?.disconnect();
    resizeObserver = null;
    panel?.destroy();
    panel = null;
    if (frame) frame.hidden = true;
  }

  // ----- anchoring over the real panel -----
  function claimAnchor(el) {
    if (anchor === el) return;
    releaseAnchor();
    anchor = el;
    anchorRestore = { opacity: el.style.opacity, minHeight: el.style.minHeight, hadInert: el.hasAttribute('inert') };
    el.setAttribute('inert', '');
    el.style.opacity = '0';
    scrollParents = [];
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(s.overflowY + s.overflowX)) scrollParents.push(p);
    }
    syncAnchorHeight();
  }

  function releaseAnchor() {
    if (!anchor) return;
    if (!anchorRestore.hadInert) anchor.removeAttribute('inert');
    anchor.style.opacity = anchorRestore.opacity;
    anchor.style.minHeight = anchorRestore.minHeight;
    anchor = null;
    lastSymbol = null;
  }

  /** Grow the real panel's slot if our panel is taller, so nothing below is covered. */
  function syncAnchorHeight() {
    if (!anchor || !panel) return;
    anchor.style.minHeight = `${Math.ceil(panel.element.getBoundingClientRect().height)}px`;
  }

  let lastBox = '';
  let lastClip = '';

  function position() {
    rafId = 0;
    if (!anchor || !frame) return;
    const r = anchor.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) {
      frame.hidden = true;
      return;
    }
    frame.hidden = false;
    const box = `${r.top}|${r.left}|${r.width}|${r.height}`;
    // Writing styles invalidates layout, so only do it when the anchor actually moved.
    if (box !== lastBox) {
      lastBox = box;
      Object.assign(frame.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px` });
    }

    let top = 0;
    let left = 0;
    let bottom = window.innerHeight;
    let right = window.innerWidth;
    for (const p of scrollParents) {
      const pr = p.getBoundingClientRect();
      top = Math.max(top, pr.top);
      left = Math.max(left, pr.left);
      bottom = Math.min(bottom, pr.bottom);
      right = Math.min(right, pr.right);
    }
    const clip = [Math.max(0, top - r.top), Math.max(0, r.right - right), Math.max(0, r.bottom - bottom), Math.max(0, left - r.left)];
    const clipPath = clip.some((v) => v > 0) ? `inset(${clip.map((v) => `${v}px`).join(' ')})` : '';
    if (clipPath !== lastClip) {
      lastClip = clipPath;
      frame.style.clipPath = clipPath;
    }
    rafId = requestAnimationFrame(position);
  }

  function layout() {
    if (!frame) return;
    cancelAnimationFrame(rafId);
    rafId = 0;
    renderToggle();

    if (!settings.overlayEnabled || !asset) {
      unmountPanel();
      return;
    }
    mountPanel();

    if (anchor) {
      frame.className = 'frame anchored';
      frame.style.cssText = '';
      position();
      return;
    }
    frame.className = 'frame floating';
    Object.assign(frame.style, { top: '', left: '', width: '', height: '', clipPath: '' });
    frame.hidden = Date.now() - routeAt < FLOAT_AFTER_MS;
  }

  // ----- route + panel detection -----
  function onRoute() {
    const next = parseAssetFromUrl(location.href);
    const changed = !next || !asset || asset.chain !== next.chain || asset.address !== next.address;
    asset = next;
    if (changed) {
      releaseAnchor();
      routeAt = Date.now();
    }
    ensureHost();
    if (asset && panel) panel.setAsset({ ...asset, symbol: lastSymbol });
    layout();
  }

  function detect() {
    if (location.href !== lastHref) {
      lastHref = location.href;
      onRoute();
    }
    ensureHost();
    placeToggle();
    if (!asset || !settings.overlayEnabled) return;

    const hadAnchor = !!anchor;
    if (!anchor || !anchor.isConnected) {
      if (anchor) releaseAnchor();
      const found = adapter.findTradePanel();
      if (found) claimAnchor(found);
    }
    if (anchor) {
      const symbol = readSymbol(anchor);
      if (symbol && symbol !== lastSymbol) {
        lastSymbol = symbol;
        panel?.setAsset({ ...asset, symbol });
      }
    }
    if (hadAnchor !== !!anchor || (!anchor && frame?.hidden && Date.now() - routeAt >= FLOAT_AFTER_MS)) layout();
  }

  onStateChange(async (changes) => {
    if (!changes.settings) return;
    const wasEnabled = settings.overlayEnabled;
    settings = await getSettings();
    if (wasEnabled !== settings.overlayEnabled) {
      // Turning on: show the floating fallback quickly if the real panel can't be found.
      if (settings.overlayEnabled) routeAt = Date.now() - FLOAT_AFTER_MS + 800;
      layout();
      detect();
    } else {
      renderToggle();
    }
  });

  /**
   * The extension was reloaded or updated while this tab stayed open. This copy of the script can no
   * longer reach extension APIs, so stop everything and hand FOMO its real panel back. The new
   * version takes over when the tab is refreshed.
   */
  let detectTimer = 0;
  function shutdown() {
    clearInterval(detectTimer);
    window.removeEventListener('resize', placeToggle);
    try {
      unmountPanel();
    } catch {
      releaseAnchor();
    }
    host?.remove();
    host = frame = toggle = panel = null;
  }

  function tick() {
    if (!extensionAlive()) return shutdown();
    try {
      detect();
    } catch (err) {
      if (!extensionAlive()) shutdown();
      else throw err;
    }
  }

  tick();
  detectTimer = setInterval(tick, DETECT_MS);
}
