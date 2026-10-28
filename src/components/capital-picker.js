// "Choose your starting capital" picker, shared by first-time setup and account reset
// (side panel and popup). Quick-pick amounts plus a custom field.
import { escapeHtml, formatCompactUsd, formatUsd } from './format.js';

const DEFAULT_PRESETS = [1000, 5000, 10000, 25000, 50000, 100000];

export function createCapitalChoice(config, current) {
  const presets = config?.startingBalancePresets?.length ? config.startingBalancePresets : DEFAULT_PRESETS;
  const preferred = current ?? config?.startingBalance ?? 10000;
  return presets.includes(preferred) ? { selected: preferred, custom: '' } : { selected: null, custom: String(preferred) };
}

export function capitalAmount(choice) {
  if (choice.custom !== '') {
    const n = Number(choice.custom);
    return Number.isFinite(n) ? n : NaN;
  }
  return choice.selected ?? NaN;
}

function limits(config) {
  return { min: config?.minStartingBalance ?? 100, max: config?.maxStartingBalance ?? 1000000 };
}

export function capitalError(choice, config) {
  const amount = capitalAmount(choice);
  const { min, max } = limits(config);
  if (!(amount > 0)) return 'Pick an amount or enter your own.';
  if (amount < min || amount > max) {
    return `Choose between ${formatUsd(min, { decimals: 0 })} and ${formatUsd(max, { decimals: 0 })}.`;
  }
  return null;
}

/**
 * @param {{ config: object, choice: {selected:number|null, custom:string}, busy: boolean,
 *   submitAct: string, submitLabel: string, error?: string|null }} opts
 */
export function renderCapitalPicker({ config, choice, busy, submitAct, submitLabel, error = null }) {
  const presets = config?.startingBalancePresets?.length ? config.startingBalancePresets : DEFAULT_PRESETS;
  const { min, max } = limits(config);
  const amount = capitalAmount(choice);
  const invalid = capitalError(choice, config);
  return `
    <div class="capital" data-capital-picker>
      <div class="capital-grid" role="group" aria-label="Starting capital">
        ${presets
          .map(
            (v) => `<button type="button" class="capital-opt num" data-capital="${v}" aria-pressed="${choice.custom === '' && choice.selected === v}">${formatCompactUsd(v)}</button>`,
          )
          .join('')}
      </div>
      <label class="capital-custom ${choice.custom !== '' ? 'active' : ''}">
        <span class="dollar">$</span>
        <input name="customCapital" inputmode="decimal" autocomplete="off" placeholder="Custom amount, like 25,000…" value="${escapeHtml(choice.custom)}"
          aria-label="Custom starting capital in USD" />
      </label>
      <p class="capital-hint">Between ${formatUsd(min, { decimals: 0 })} and ${formatUsd(max, { decimals: 0 })} in virtual USD</p>
      <div class="capital-summary num" data-capital-summary role="status" aria-live="polite">${
        invalid ? escapeHtml(invalid) : `You'll start with <b>${formatUsd(amount)}</b> in virtual cash`
      }</div>
      ${error ? `<div class="banner err" role="alert">${escapeHtml(error)}</div>` : ''}
      <button class="btn primary block" data-act="${submitAct}" data-capital-submit ${busy || invalid ? 'disabled' : ''}>${escapeHtml(submitLabel)}</button>
    </div>`;
}

/**
 * Handles preset clicks and custom typing in place (no full re-render, so the input keeps focus).
 * Returns true when the event belonged to a picker.
 */
export function handleCapitalEvent(event, choice, config, { busy = false } = {}) {
  const picker = event.target.closest?.('[data-capital-picker]');
  if (!picker) return false;

  if (event.type === 'click') {
    const opt = event.target.closest('[data-capital]');
    if (!opt) return false;
    choice.selected = Number(opt.dataset.capital);
    choice.custom = '';
    picker.querySelector('[name="customCapital"]').value = '';
  } else if (event.type === 'input' && event.target.name === 'customCapital') {
    let v = event.target.value.replace(/[^0-9.]/g, '');
    const dot = v.indexOf('.');
    if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '').slice(0, 2);
    v = v.slice(0, 10);
    if (v !== event.target.value) event.target.value = v;
    choice.custom = v;
    if (v !== '') choice.selected = null;
  } else if (event.type === 'keydown' && event.key === 'Enter' && event.target.name === 'customCapital') {
    event.preventDefault();
    picker.querySelector('[data-capital-submit]')?.click();
    return true;
  } else {
    return false;
  }

  const amount = capitalAmount(choice);
  const invalid = capitalError(choice, config);
  picker.querySelectorAll('[data-capital]').forEach((b) => b.setAttribute('aria-pressed', String(choice.custom === '' && Number(b.dataset.capital) === choice.selected)));
  picker.querySelector('.capital-custom').classList.toggle('active', choice.custom !== '');
  picker.querySelector('[data-capital-summary]').innerHTML = invalid
    ? escapeHtml(invalid)
    : `You'll start with <b>${formatUsd(amount)}</b> in virtual cash`;
  picker.querySelector('[data-capital-submit]').disabled = busy || !!invalid;
  return true;
}
