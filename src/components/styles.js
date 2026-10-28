// Palette mirrors the reference terminal's dark theme so the paper panel feels native.
// Violet marks "practice mode": calm and clearly separate from the green/red that carry
// the real feedback (profit/loss, buy/sell). Amber is kept only for genuine cautions.
export const TOKENS_CSS = `
:host, :root {
  --bg-primary: #060510;
  --bg-secondary: #12111a;
  --bg-tertiary: rgba(203, 208, 235, 0.1);
  --bg-tertiary-solid: #161522;
  --line: rgba(203, 208, 235, 0.09);
  --line-strong: rgba(203, 208, 235, 0.16);
  --text-primary: #f7f7f7;
  --text-secondary: #9899a3;
  --text-tertiary: #5c5f68;
  --green: #21c95e;
  --green-t: rgba(33, 201, 94, 0.2);
  --red: #ff622e;
  --red-t: rgba(255, 98, 46, 0.14);
  --warning: #ffc74f;
  --warning-t: rgba(255, 199, 79, 0.12);
  --paper: #a896ff;
  --paper-t: rgba(168, 150, 255, 0.12);
  --paper-line: rgba(168, 150, 255, 0.28);
  --paper-strong: rgba(168, 150, 255, 0.55);
  --accent: #a896ff; /* one accent: the paper violet (also focus rings and links) */
  --radius-sm: 8px;
  --radius: 12px;
  --font: Aeonik, Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
`;

export const PANEL_CSS = `
${TOKENS_CSS}
.pt { font-family: var(--font); color: var(--text-primary); font-size: 14px; line-height: 1.35;
  display: flex; flex-direction: column; gap: 12px; -webkit-font-smoothing: antialiased; }
:where(.pt) *, :where(.pt) *::before, :where(.pt) *::after { box-sizing: border-box; }
:where(.pt) button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 0; }
.pt button, .pt a, .pt input, .pt label, .pos-hover { touch-action: manipulation; -webkit-tap-highlight-color: rgba(168, 150, 255, 0.2); }
:where(.pt) button:disabled { cursor: not-allowed; }
.pt button:focus-visible, .pt input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.pt [hidden] { display: none !important; }
.num { font-variant-numeric: tabular-nums; }
.up { color: var(--green); }
.down { color: var(--red); }
.muted { color: var(--text-secondary); }

/* header: paper badge + balance cards (mirrors the cash / equity cards) */
.head { display: flex; align-items: stretch; justify-content: space-between; gap: 8px; }
.paper-pill { display: inline-flex; align-items: center; gap: 6px; align-self: center; padding: 5px 9px; border-radius: 999px;
  background: var(--paper-t); color: var(--paper); font-size: 11px; font-weight: 700; letter-spacing: .06em; white-space: nowrap; }
.head-cards { display: flex; gap: 6px; min-width: 0; }
.mini { display: flex; flex-direction: column; justify-content: center; gap: 1px; padding: 6px 10px; border-radius: var(--radius);
  border: 1px solid var(--line-strong); background: var(--bg-primary); text-align: left; min-width: 0; }
.mini:hover { background: var(--bg-secondary); }
.mini .v { font-weight: 700; font-size: 14px; white-space: nowrap; }
.mini .v small { color: var(--text-secondary); font-weight: 500; font-size: 12px; }
.mini .s { font-size: 12px; font-weight: 700; white-space: nowrap; }
.mini .s small { color: var(--text-secondary); font-weight: 500; }
.link { color: var(--accent); }
.avatar { width: 34px; height: 34px; border-radius: 10px; align-self: center; object-fit: cover; background: var(--bg-tertiary-solid);
  display: grid; place-items: center; font-weight: 700; color: var(--text-secondary); flex: none; overflow: hidden; }
.profile { position: relative; align-self: center; display: flex; }
button.avatar { cursor: pointer; transition: box-shadow .15s; }
button.avatar:hover, button.avatar[aria-expanded="true"] { box-shadow: 0 0 0 2px var(--line-strong); }
.profile-menu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; min-width: 210px; padding: 6px; border-radius: 12px;
  background: var(--bg-tertiary-solid); border: 1px solid var(--line-strong); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55);
  display: flex; flex-direction: column; gap: 2px; }
.pm-user { display: flex; flex-direction: column; gap: 1px; padding: 8px 10px 10px; margin-bottom: 4px; border-bottom: 1px solid var(--line); min-width: 0; }
.pm-user b { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pm-user small { font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.profile-menu [role="menuitem"] { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; border-radius: 8px;
  font-size: 14px; font-weight: 600; text-align: left; color: var(--text-primary); }
.profile-menu [role="menuitem"]:hover { background: var(--bg-tertiary); }
.profile-menu [role="menuitem"] svg { color: var(--text-secondary); }
.profile-menu [role="menuitem"].danger, .profile-menu [role="menuitem"].danger svg { color: var(--red); }

/* main card */
.card { background: var(--bg-primary); border: 1px solid var(--line-strong); border-radius: var(--radius); padding: 8px;
  display: flex; flex-direction: column; gap: 8px; }
.card.paper { border-color: var(--paper-line); }
.tabs { display: flex; gap: 8px; }
.tab { flex: 1; padding: 8px; border-radius: var(--radius-sm); font-size: 16px; font-weight: 700;
  background: var(--bg-secondary); color: var(--text-secondary); transition: background-color .15s, color .15s; }
.tab:hover { background: var(--bg-tertiary); }
.tab.buy.active { background: var(--green-t); color: var(--green); }
.tab.sell.active { background: var(--red-t); color: var(--red); }

.amount { display: flex; align-items: center; gap: 2px; background: var(--bg-secondary); border-radius: var(--radius);
  padding: 0 16px; height: 72px; cursor: text; border: 1px solid transparent; }
.amount:focus-within { border-color: var(--line-strong); }
/* The focus ring belongs on the whole field, not as a box drawn around the inner input. */
.amount input:focus-visible { outline: none; }
.amount:has(input:focus-visible) { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.amount .dollar { font-size: 30px; font-weight: 500; color: var(--text-tertiary); }
.amount.has-value .dollar { color: var(--text-primary); }
.amount input { flex: 1; min-width: 0; background: transparent; border: 0; outline: none; color: var(--text-primary);
  font: 500 30px/1 var(--font); font-variant-numeric: tabular-nums; padding: 0; }
.amount input::placeholder { color: var(--text-tertiary); }
.amount .hint { font-size: 14px; font-weight: 500; color: var(--text-tertiary); white-space: nowrap; text-align: right; }
.amount.has-value .hint { color: var(--text-secondary); }

.presets { display: grid; grid-template-columns: repeat(4, 1fr) auto auto; gap: 8px; align-items: center; }
.preset { padding: 8px 0; border-radius: var(--radius-sm); background: var(--bg-secondary); font-weight: 700; font-size: 14px;
  transition: background-color .15s; white-space: nowrap; }
.preset:hover:not(:disabled) { background: var(--bg-tertiary); }
.preset.active { box-shadow: inset 0 0 0 1px var(--line-strong); background: var(--bg-tertiary); }
.preset:disabled { color: var(--text-tertiary); }
.preset.max { padding: 8px 12px; color: var(--paper); box-shadow: inset 0 0 0 1px var(--paper-line); }
.preset.max:hover:not(:disabled) { background: var(--paper-t); }
.preset.max:disabled { color: var(--text-tertiary); box-shadow: inset 0 0 0 1px var(--line); }
.icon-btn { width: 30px; height: 30px; display: grid; place-items: center; border-radius: var(--radius-sm); color: var(--text-secondary); }
.icon-btn:hover { background: var(--bg-secondary); color: var(--text-primary); }

.preset-editor { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.preset-editor input { width: 100%; background: var(--bg-secondary); border: 1px solid var(--line-strong); border-radius: var(--radius-sm);
  color: var(--text-primary); font: 700 13px var(--font); text-align: center; padding: 7px 4px; }
.preset-editor .row { grid-column: 1 / -1; display: flex; gap: 8px; justify-content: flex-end; font-size: 12px; }
.preset-editor .row .muted { margin-right: auto; align-self: center; }

.available { font-size: 14px; font-weight: 500; padding: 0 2px; }
.available .muted { font-weight: 400; }

.cta { position: relative; width: 100%; height: 48px; border-radius: var(--radius); font-size: 16px; font-weight: 700;
  background: var(--bg-secondary); color: var(--text-secondary); border: 1px solid var(--line-strong);
  transition: background-color .15s, color .15s, opacity .15s; }
.cta.ready.buy { background: var(--green); color: var(--bg-primary); border-color: transparent; }
.cta.ready.sell { background: var(--red); color: var(--bg-primary); border-color: transparent; }
.cta.ready.setup { background: var(--paper); color: var(--bg-primary); }
.cta.ready.setup .tag { display: none; }
.cta.ready.signin { background: var(--text-primary); color: var(--bg-primary); display: flex; align-items: center; justify-content: center; gap: 8px; }
.cta.ready:hover { opacity: .9; }
.cta .tag { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); font-size: 10px; letter-spacing: .08em;
  padding: 3px 6px; border-radius: 6px; background: var(--paper-t); color: var(--paper); }
.cta.ready .tag { background: rgba(6, 5, 16, 0.18); color: var(--bg-primary); }
.cta.pending { opacity: .7; cursor: progress; }

.notice { border-radius: 10px; padding: 9px 12px; font-size: 13px; font-weight: 500; }
.notice.ok { background: var(--green-t); color: var(--green); }
.notice.err, .notice.loss { background: var(--red-t); color: var(--red); }

.status { border-radius: var(--radius); border: 1px solid var(--paper-line); background: var(--paper-t); color: var(--paper); overflow: hidden; }
.status-logo { width: 18px; height: 18px; border-radius: 5px; display: block; flex: none; }
.status-row [data-el="statusIcon"] { display: grid; place-items: center; flex: none; }
.status.danger { border-color: rgba(255, 98, 46, 0.3); background: var(--red-t); color: var(--red); }
.status-row { width: 100%; display: flex; align-items: center; gap: 8px; padding: 10px 12px; font-weight: 700; text-align: left; }
.status-row:not(.static):hover { background: var(--bg-secondary); }
.status-row.static { cursor: default; }
.status-row .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chev { transition: transform .15s; flex: none; opacity: .8; }
.open > button .chev, .open > .status-row .chev { transform: rotate(180deg); }
.status-body { padding: 0 12px 12px; display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; font-size: 13px; }
.status-body dt { color: var(--text-secondary); font-weight: 400; }
.status-body dd { margin: 0; text-align: right; color: var(--text-primary); font-weight: 500; }
.status-body .full { grid-column: 1 / -1; color: var(--text-secondary); font-size: 12px; margin-top: 2px; }
.inline-btn { color: var(--text-primary); text-decoration: underline; font-weight: 600; }
.inline-btn:hover { color: var(--accent); }

/* position */
/* Laid out like a FOMO position: logo + current level on the left, P&L on the right,
   then the invested / entry stats, then the Share and Close actions. */
.position { display: grid; gap: 6px; padding: 8px 10px; }
.position .pos-hd { display: flex; align-items: center; gap: 8px; }
.position .pos-hd .av { width: 30px; height: 30px; }
.position .pos-lead { display: grid; min-width: 0; line-height: 1.25; }
.position .pos-lead b { font-size: 14px; font-weight: 700; }
.position .pos-lead small { font-size: 11px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.position .pos-pnl { margin-left: auto; display: grid; justify-items: end; text-align: right; line-height: 1.25; }
.position .pos-pnl b { font-size: 14px; font-weight: 700; }
.position .pos-pnl small { font-size: 11px; }
.position .pos-stats { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 0; font-size: 12px; }
.position .pos-stats dt { color: var(--text-secondary); }
.position .pos-stats dd { margin: 0; text-align: right; font-weight: 600; }
.position .pos-actions { margin-top: 0; gap: 4px; }
.position .pos-actions .btn-sm { padding: 4px 10px; font-size: 12px; }
.admin-tag { margin-left: 6px; font-style: normal; font-size: 9px; font-weight: 800; letter-spacing: .08em;
  padding: 2px 5px; border-radius: 4px; background: var(--paper-t); color: var(--paper); vertical-align: middle; }
.btn-sm { padding: 6px 12px; border-radius: var(--radius-sm); background: var(--bg-secondary); font-size: 13px; font-weight: 700; }
.btn-sm:hover { background: var(--bg-tertiary); }
.btn-sm.danger { color: var(--red); }
.btn-sm.danger.confirm { background: var(--red); color: var(--bg-primary); }

/* profit / loss theme */
.card.position.profit { border-color: rgba(33, 201, 94, 0.35); background: linear-gradient(180deg, rgba(33, 201, 94, 0.09), rgba(33, 201, 94, 0) 75%), var(--bg-primary); }
.card.position.loss { border-color: rgba(255, 98, 46, 0.35); background: linear-gradient(180deg, rgba(255, 98, 46, 0.09), rgba(255, 98, 46, 0) 75%), var(--bg-primary); }

/* your positions (open / closed) */
.positions { border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--bg-primary); padding: 14px 10px 8px; }
/* Narrow panels (the FOMO overlay, a pinched side panel) can't fit the title and both control
   groups on one line, so the controls drop to their own row instead of running off the card. */
.pos-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; row-gap: 8px; padding: 0 6px 8px; }
.pos-head .pos-controls { margin-left: auto; }
.pos-title { margin: 0; font-size: 16px; font-weight: 700; white-space: nowrap; }
.pos-tabs { display: flex; padding: 3px; gap: 2px; border-radius: 10px; background: var(--bg-secondary); border: 1px solid var(--line); }
.pos-tabs button { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 7px; font-size: 13px; font-weight: 600; color: var(--text-tertiary); }
.pos-tabs button:hover { color: var(--text-secondary); }
.pos-tabs button[aria-selected="true"] { background: var(--paper-t); color: var(--paper); box-shadow: inset 0 0 0 1px var(--paper-line); }
.pos-controls { display: flex; align-items: center; gap: 6px; }
.pos-tabs.unit button { padding: 4px 8px; min-width: 30px; justify-content: center; }
.pos-tabs.unit button[aria-pressed="true"] { background: var(--bg-tertiary); color: var(--text-primary); box-shadow: inset 0 0 0 1px var(--line-strong); }
.pos-tabs .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.pos-list { display: flex; flex-direction: column; gap: 2px; max-height: 360px; overflow: auto; overscroll-behavior: contain; }
.pos-row { border-radius: 10px; transition: background-color .15s; }
.pos-row.profit { --tone: var(--green); --tone-t: rgba(33, 201, 94, 0.07); }
.pos-row.loss { --tone: var(--red); --tone-t: rgba(255, 98, 46, 0.07); }
.pos-row.profit, .pos-row.loss { background: linear-gradient(90deg, var(--tone-t), rgba(0, 0, 0, 0)); }
.pos-row:hover, .pos-row.expanded { background-color: var(--bg-secondary); }
.pos-row .chg { color: var(--tone, var(--text-secondary)); }
.pos-main { width: 100%; display: flex; align-items: center; }
.pos-token { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; padding: 9px 6px; text-align: left;
  color: inherit; text-decoration: none; border-radius: 10px; cursor: pointer; }
a.pos-token:hover .pos-name b { text-decoration: underline; text-underline-offset: 2px; }
.pos-toggle { display: flex; align-items: center; gap: 6px; padding: 9px 4px 9px 8px; border-radius: 10px; }
.pos-toggle .chev { color: var(--text-tertiary); display: grid; }
.pos-row.expanded .pos-toggle .chev { transform: rotate(180deg); }
.av { width: 38px; height: 38px; border-radius: 50%; object-fit: cover; flex: none; background: var(--bg-tertiary-solid); }
.av.letter { display: grid; place-items: center; font-weight: 700; font-size: 15px; color: var(--text-secondary); }
.av.has-img { background-size: cover; background-position: center; color: transparent; }
.pos-row.profit .av, .pos-row.loss .av { box-shadow: 0 0 0 2px var(--tone-t), 0 0 0 1px var(--tone); }
.pos-name { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pos-name b { font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pos-name small { font-size: 12px; color: var(--text-secondary); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pos-name .here { font-style: normal; font-size: 10px; font-weight: 700; letter-spacing: .04em; color: var(--paper); margin-left: 4px; }
.pos-val { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.pos-val b { font-size: 15px; font-weight: 700; }
.pos-val small { font-size: 12px; font-weight: 600; }
/* discreet mode: the paper wording comes off the FOMO panel, the violet accent stays */
.pt.discreet .paper-pill, .pt.discreet .cta .tag, .pt.discreet .foot span { display: none; }
/* The pill was holding the left end of the header row: without it the cards must stay put. */
.pt.discreet .head { justify-content: flex-end; }
.pt.discreet .foot { justify-content: flex-end; }

.pos-detail { padding: 0 8px 10px 56px; font-size: 12px; }
.pos-card { display: none; }

/* hover card: the row's numbers, shown beside it like FOMO's own token card */
/* Mounted outside the panel, so it restates the panel's type instead of inheriting the host page's. */
.pos-hover { position: fixed; z-index: 2147483000; width: 268px; padding: 12px; border-radius: 14px;
  font-family: var(--font); font-size: 12px; font-weight: 500; line-height: 1.35; font-variant-numeric: tabular-nums;
  letter-spacing: normal; text-transform: none; -webkit-font-smoothing: antialiased;
  background: var(--bg-secondary); border: 1px solid var(--line-strong); box-shadow: 0 18px 44px rgba(0, 0, 0, 0.55);
  pointer-events: none; color: var(--text-primary); }
.pos-hover, .pos-hover *, .pos-hover *::before, .pos-hover *::after { box-sizing: border-box; }
.pos-hover[hidden] { display: none; }
.pos-hover .hcard-head { display: flex; align-items: center; gap: 10px; padding-bottom: 10px; margin-bottom: 8px; border-bottom: 1px solid var(--line); }
.pos-hover .hcard-head .av { width: 34px; height: 34px; }
.pos-hover .hcard-head .pos-name b { font-size: 14px; }
.pos-hover .hcard-head .pos-val b { font-size: 14px; }
.pos-hover .hcard-head .pos-val small { font-size: 11px; font-weight: 600; }
.pos-hover .hrow { display: flex; align-items: baseline; gap: 4px; padding: 3px 0; }
.pos-hover .hrow span { color: var(--text-secondary); white-space: nowrap; }
.pos-hover .hrow i { flex: 1; border-bottom: 1px dashed var(--line-strong); transform: translateY(-3px); }
.pos-hover .hrow b { font-weight: 700; white-space: nowrap; }
.pos-hover .chg { color: var(--tone, var(--text-primary)); }
.pos-hover.profit { --tone: var(--green); }
.pos-hover.loss { --tone: var(--red); }
.pos-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
.btn-sm.share { display: inline-flex; align-items: center; gap: 6px; color: var(--paper); }
.btn-sm.share:hover { background: var(--paper-t); }
a.btn-sm { color: var(--text-primary); text-decoration: none; display: inline-flex; align-items: center; }
.chain-tag { display: inline-block; margin-right: 6px; padding: 0 5px; border-radius: 5px; background: var(--bg-tertiary); color: var(--text-secondary);
  font-size: 10px; font-weight: 600; line-height: 16px; vertical-align: 1px; text-transform: lowercase; }
.empty b { display: block; color: var(--text-primary); font-size: 14px; margin-bottom: 2px; }
.empty span { display: block; }
.sk { display: block; border-radius: 6px; background: linear-gradient(90deg, rgba(203, 208, 235, 0.06), rgba(203, 208, 235, 0.13), rgba(203, 208, 235, 0.06));
  background-size: 200% 100%; }
.av.sk { border-radius: 50%; }
.sk-line { height: 10px; margin: 3px 0; }
.sk-line.w30 { width: 36px; } .sk-line.w40 { width: 64px; } .sk-line.w50 { width: 72px; } .sk-line.w60 { width: 96px; }
.pos-row.skeleton .pos-val { align-items: flex-end; }
@media (prefers-reduced-motion: no-preference) {
  .sk { animation: pt-shimmer 1.4s ease-in-out infinite; }
  @keyframes pt-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
}
.dust { margin: 6px 6px 2px; font-size: 13px; font-weight: 500; color: var(--text-tertiary); }
.dust:hover { color: var(--text-secondary); }

/* closed trades accordion */
.acc { border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--bg-primary); }
.acc-head { width: 100%; display: flex; align-items: center; gap: 8px; padding: 12px; color: var(--text-secondary); }
.acc-head .grow { flex: 1; text-align: left; }
.count { font-size: 12px; padding: 1px 7px; border-radius: 999px; background: var(--bg-secondary); color: var(--text-secondary); }
.acc-body { overscroll-behavior: contain; border-top: 1px solid var(--line); max-height: 280px; overflow: auto; }
.ct { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; padding: 10px 12px; border-bottom: 1px solid var(--line); font-size: 13px; }
.ct:last-child { border-bottom: 0; }
.ct .sym { font-weight: 700; font-size: 14px; }
.ct .r { text-align: right; font-weight: 700; }
.ct .meta { color: var(--text-secondary); }
.empty { padding: 16px 12px; color: var(--text-secondary); font-size: 13px; text-align: center; }

.foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--text-secondary); padding: 0 2px; }
.foot button { color: var(--text-secondary); text-decoration: underline; }
.foot button:hover { color: var(--text-primary); }

@keyframes pt-flash { from { background: var(--bg-tertiary); } to { background: transparent; } }
.flash { animation: pt-flash .6s ease-out; }
@media (prefers-reduced-motion: reduce) { .pt * { transition: none !important; animation: none !important; } }
`;
