// DOM-delen av spelet: skärmar, instrument, topplista, inställningar, debug.
// All text från användare eller datakällor sätts med textContent.

import { CONFIG_SCHEMA, CLASSES, CHILD_CLASS, CHILD_REMINDER, formatMilestones, parseMilestones, sanitize } from './config.js';
import { preview, CALIBRATION_STEPS, CALIBRATION_ACTIONS, PERSON_SECONDS, BALANCE_MASS } from './calibration.js';
import { fmtM } from './render.js';

const $ = (id) => document.getElementById(id);

const SCREEN_FOR_STATE = {
  IDLE: 'screen-idle',
  SETUP: 'screen-setup',
  READY: 'screen-ready',
  COUNTDOWN: 'screen-countdown',
  FLYING: null,
  FINISHED: 'screen-finished',
};

const REASONS = {
  landed: 'Landade',
  idle: 'Inga fler drag',
  time: 'Tiden är slut',
  operator: 'Avbrutet',
};

const MAX_DEBUG_LINES = 200;
const TOAST_MS = 2400; // samma som animationen i game.css

export class GameUI {
  constructor() {
    this.el = {
      hud: $('hud'),
      alt: $('alt'),
      altMax: $('alt-max'),
      lift: document.querySelector('.lift'),
      liftPct: $('lift-pct'),
      liftFill: $('lift-fill'),
      liftMeter: $('lift-meter'),
      liftHint: $('lift-hint'),
      vario: $('vario'),
      timer: $('timer'),
      raw: $('raw'),
      replayBadge: $('replay-badge'),
      toast: $('toast'),
      boardIdle: $('board-idle'),
      boardTabs: $('board-tabs'),
      todayIdle: $('today-idle'),
      connStatus: $('conn-status'),
      sourceSelect: $('source-select'),
      connect: $('connect'),
      setupForm: $('setup-form'),
      setupError: $('setup-error'),
      name: $('name'),
      mass: $('mass'),
      klassOptions: $('klass-options'),
      childReminder: $('child-reminder'),
      readyName: $('ready-name'),
      countdown: $('countdown'),
      finName: $('fin-name'),
      finReason: $('fin-reason'),
      finHeight: $('fin-height'),
      finRank: $('fin-rank'),
      finMilestone: $('fin-milestone'),
      disc: $('screen-disconnected'),
      discMessage: $('disc-message'),
      reconnect: $('reconnect'),
      warning: $('warning'),
      warningText: $('warning-text'),
      mockPanel: $('mock-panel'),
      mockPower: $('mock-power'),
      mockValue: $('mock-value'),
      settings: $('settings'),
      settingsFields: $('settings-fields'),
      settingsPreview: $('settings-preview'),
      debug: $('debug'),
    };
    $('warning-close').addEventListener('click', () => (this.el.warning.hidden = true));
    this.toastTimer = null;
    this.toastQueue = [];
    this.settingsBase = null;
    this.#buildClassOptions();
    this.#buildCalibrationHelp();
    // Förhandsvisningen räknas om medan operatören ändrar värden (tillägg §5).
    this.el.settingsFields.addEventListener('input', () => {
      if (this.settingsBase) this.renderPreview(sanitize(this.readSettings(this.settingsBase)));
    });
  }

  // --- Skärmar ------------------------------------------------------------------

  showState(state) {
    for (const id of Object.values(SCREEN_FOR_STATE)) if (id) $(id).hidden = true;
    const id = SCREEN_FOR_STATE[state];
    if (id) $(id).hidden = false;
    this.el.hud.hidden = !['COUNTDOWN', 'FLYING', 'FINISHED'].includes(state);
    if (state === 'SETUP') {
      this.el.setupError.textContent = '';
      this.el.name.focus();
    }
  }

  /**
   * Topplistan med en flik per klass (och ev. en sammanlagd).
   * @param {{ label: string }[]} tabs
   * @param {number} active  index för vald flik
   * @param {(i: number) => void} onSelect
   */
  renderBoardTabs(tabs, active, onSelect) {
    this.el.boardTabs.replaceChildren(
      ...tabs.map((tab, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.role = 'tab';
        b.className = 'tab';
        b.textContent = tab.label;
        b.setAttribute('aria-selected', String(i === active));
        b.addEventListener('click', () => onSelect(i));
        return b;
      })
    );
  }

  renderBoard(entries, todayBest) {
    const items = entries.map((e) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = e.name;
      if (e.klass) {
        const k = document.createElement('span');
        k.className = 'klass';
        k.textContent = ` · ${e.klass}`;
        name.append(k);
      }
      const h = document.createElement('span');
      h.className = 'h';
      h.textContent = `${fmtM(e.hMax)} m`;
      li.append(name, h);
      return li;
    });
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Inga resultat ännu – bli först!';
      items.push(li);
    }
    this.el.boardIdle.replaceChildren(...items);
    this.el.todayIdle.textContent = todayBest ? `Dagens rekord: ${fmtM(todayBest)} m` : '';
  }

  setupError(text) {
    this.el.setupError.textContent = text ?? '';
  }

  /** Läser formuläret och tömmer vikten direkt, så att den inte ligger kvar. */
  takeSetup() {
    const data = {
      name: this.el.name.value,
      mass: this.el.mass.value.trim() === '' ? NaN : Number(this.el.mass.value),
      klass: this.el.klassOptions.querySelector('input:checked')?.value ?? '',
    };
    this.el.mass.value = '';
    return data;
  }

  clearSetup() {
    this.el.name.value = '';
    this.el.mass.value = '';
    for (const input of this.el.klassOptions.querySelectorAll('input')) input.checked = false;
    this.el.childReminder.hidden = true;
  }

  #buildClassOptions() {
    this.el.klassOptions.replaceChildren(
      ...CLASSES.map((c) => {
        const label = document.createElement('label');
        label.className = 'klass-option';
        const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'klass', value: c.name });
        const name = document.createElement('strong');
        name.textContent = c.name;
        const ages = document.createElement('span');
        ages.textContent = c.ages;
        label.append(input, name, ages);
        return label;
      })
    );
    this.el.klassOptions.addEventListener('change', () => {
      const child = this.el.klassOptions.querySelector('input:checked')?.value === CHILD_CLASS;
      this.el.childReminder.textContent = CHILD_REMINDER;
      this.el.childReminder.hidden = !child;
    });
  }

  showReady(name) {
    this.el.readyName.textContent = name;
  }

  setCountdown(n) {
    const text = String(Math.max(1, Math.ceil(n)));
    if (this.el.countdown.textContent !== text) this.el.countdown.textContent = text;
  }

  /** rank/total gäller inom deltagarens klass. */
  showFinished(result, rank, total) {
    this.el.finName.textContent = result.klass ? `${result.name} · ${result.klass}` : result.name;
    this.el.finReason.textContent = REASONS[result.reason] ?? '';
    this.el.finHeight.textContent = `${fmtM(result.hMax)} m`;
    this.el.finRank.textContent = result.klass ? `Plats ${rank} av ${total} i klassen` : `Plats ${rank} av ${total}`;
    const m = result.milestone;
    this.el.finMilestone.textContent = m
      ? `Högsta milstolpe: ${m.name} (${[m.area, `${fmtM(m.h)} m`].filter(Boolean).join(', ')})`
      : 'Ingen milstolpe den här gången';
  }

  // --- Instrument --------------------------------------------------------------------

  /**
   * @param {object} v
   * @param {number} v.h, v.hMax, v.vy, v.time, v.lift (andel), v.power, v.pReq, v.P0
   * @param {boolean} v.onGround, v.showRaw
   * @param {number|null} v.replaySpeed
   */
  updateHud(v) {
    const e = this.el;
    setText(e.alt, `${fmtM(v.h)} m`);
    setText(e.altMax, `${fmtM(v.hMax)} m`);

    const pct = Math.round(v.lift * 100);
    setText(e.liftPct, `${pct} %`);
    e.liftFill.style.width = `${Math.min(200, Math.max(0, pct)) / 2}%`;
    e.liftMeter.setAttribute('aria-valuenow', String(pct));
    e.lift.classList.toggle('good', pct >= 100);
    setText(e.liftHint, v.onGround ? 'På marken: över 100 % lyfter du' : '100 % = håller höjden');

    const vy = Math.abs(v.vy) < 0.05 ? 0 : v.vy;
    setText(e.vario, `${vy > 0 ? '↑' : vy < 0 ? '↓' : '·'} ${Math.abs(vy).toFixed(1).replace('.', ',')} m/s`);
    setText(e.timer, formatClock(v.time));

    e.raw.hidden = !v.showRaw;
    if (v.showRaw) {
      setText(e.raw, `P ${Math.round(v.power)} W · krävs ${Math.round(v.pReq)} W · P0 ${Math.round(v.P0)} W`);
    }
    e.replayBadge.hidden = !v.replaySpeed;
    if (v.replaySpeed) setText(e.replayBadge, `Landning ×${Math.max(1, Math.round(v.replaySpeed))}`);
  }

  /**
   * Notis, t.ex. en passerad milstolpe. Köas så att snabba passager inte skriver
   * över varandra; vid lång kö hoppas de äldsta över.
   */
  /** Synliga instrumentpaneler i skärmkoordinater, så att scenen kan undvika dem. */
  hudRects() {
    const els = this.el.hud.hidden
      ? [this.el.mockPanel]
      : [document.querySelector('.hud-alt'), this.el.lift, this.el.vario, this.el.timer, this.el.mockPanel];
    // getClientRects() är tom för dolda element (offsetParent duger inte: fixed ger alltid null)
    return els.filter((el) => el && el.getClientRects().length > 0).map((el) => el.getBoundingClientRect());
  }

  toast(title, subtitle = '') {
    this.toastQueue.push({ title, subtitle });
    if (this.toastQueue.length > 2) this.toastQueue.splice(0, this.toastQueue.length - 2);
    if (!this.toastTimer) this.#nextToast();
  }

  clearToasts() {
    this.toastQueue = [];
    clearTimeout(this.toastTimer);
    this.toastTimer = null;
    this.el.toast.hidden = true;
  }

  #nextToast() {
    const t = this.el.toast;
    const item = this.toastQueue.shift();
    if (!item) {
      t.hidden = true;
      this.toastTimer = null;
      return;
    }
    const title = document.createElement('div');
    title.textContent = item.title;
    const sub = document.createElement('div');
    sub.className = 'toast-sub';
    sub.textContent = item.subtitle;
    t.replaceChildren(title, ...(item.subtitle ? [sub] : []));
    t.hidden = true;
    void t.offsetWidth; // starta om animationen
    t.hidden = false;
    this.toastTimer = setTimeout(() => this.#nextToast(), TOAST_MS);
  }

  // --- Anslutning -------------------------------------------------------------------

  setConnStatus(status, sourceName) {
    const text = {
      idle: 'Inte ansluten',
      connecting: 'Ansluter…',
      connected: `Ansluten: ${status.message ?? sourceName}`,
      reconnecting: `${status.message ?? 'Frånkopplad'} – återansluter…`,
      disconnected: status.message ?? 'Frånkopplad',
      error: status.message ?? 'Fel',
    }[status.state];
    this.el.connStatus.textContent = text ?? status.state;
    this.el.connStatus.dataset.kind =
      status.state === 'connected' ? 'ok' : ['error', 'disconnected', 'reconnecting'].includes(status.state) ? 'error' : 'idle';
    this.el.connect.textContent = status.state === 'connected' ? 'Anslut igen' : 'Anslut';
  }

  /** Överlägget när ergen tappats under ett pass. null döljer det. */
  showDisconnected(status) {
    this.el.disc.hidden = !status;
    if (!status) return;
    this.el.discMessage.textContent =
      status.state === 'disconnected' ? status.message ?? 'Kunde inte återansluta' : `${status.message ?? 'Frånkopplad'} – försöker återansluta…`;
    this.el.reconnect.hidden = status.state !== 'disconnected';
  }

  showWarning(text) {
    this.el.warningText.textContent = text;
    this.el.warning.hidden = false;
  }

  showMock(visible, watts = 0) {
    this.el.mockPanel.hidden = !visible;
    this.setMockPower(watts);
  }

  setMockPower(watts) {
    this.el.mockPower.value = String(watts);
    setText(this.el.mockValue, `${watts} W`);
  }

  // --- Debug ----------------------------------------------------------------------

  get debugVisible() {
    return !this.el.debug.hidden;
  }

  toggleDebug() {
    this.el.debug.hidden = !this.el.debug.hidden;
    this.el.debug.scrollTop = this.el.debug.scrollHeight;
    return this.debugVisible;
  }

  debug(line) {
    const stamp = new Date().toLocaleTimeString('sv-SE', { hour12: false });
    const lines = `${this.el.debug.textContent}${stamp} ${line}\n`.split('\n');
    this.el.debug.textContent = lines.slice(-MAX_DEBUG_LINES - 1).join('\n');
    if (this.debugVisible) this.el.debug.scrollTop = this.el.debug.scrollHeight;
  }

  // --- Inställningar ------------------------------------------------------------

  get settingsOpen() {
    return this.el.settings.open;
  }

  /** Bygger formuläret från CONFIG_SCHEMA med värdena i cfg. */
  fillSettings(cfg) {
    const groups = new Map();
    for (const f of CONFIG_SCHEMA) {
      if (!groups.has(f.group)) {
        const fs = document.createElement('fieldset');
        fs.className = 'settings-group';
        const legend = document.createElement('legend');
        legend.textContent = f.group;
        fs.append(legend);
        groups.set(f.group, fs);
      }
      const row = document.createElement('label');
      row.className = 'settings-field';
      const label = document.createElement('span');
      label.textContent = f.label;
      let input;
      if (f.type === 'select') {
        input = document.createElement('select');
        for (const [value, text] of f.options) input.append(Object.assign(document.createElement('option'), { value, textContent: text }));
        input.value = cfg[f.key];
      } else if (f.type === 'bool') {
        input = Object.assign(document.createElement('input'), { type: 'checkbox', checked: cfg[f.key] });
      } else if (f.type === 'milestones') {
        input = document.createElement('textarea');
        input.value = formatMilestones(cfg[f.key]);
      } else {
        input = Object.assign(document.createElement('input'), { type: 'number', min: f.min, max: f.max, step: f.step, value: cfg[f.key] });
      }
      input.dataset.key = f.key;
      row.append(label, input);
      groups.get(f.group).append(row);
    }
    this.el.settingsFields.replaceChildren(...groups.values());
  }

  /** Läser formuläret till ett (osanerat) konfigurationsobjekt ovanpå base. */
  readSettings(base) {
    const out = { ...base };
    for (const input of this.el.settingsFields.querySelectorAll('[data-key]')) {
      const f = CONFIG_SCHEMA.find((x) => x.key === input.dataset.key);
      if (f.type === 'bool') out[f.key] = input.checked;
      else if (f.type === 'number') out[f.key] = Number(input.value);
      else if (f.type === 'milestones') out[f.key] = parseMilestones(input.value);
      else out[f.key] = input.value;
    }
    return out;
  }

  openSettings(cfg) {
    this.settingsBase = cfg;
    this.fillSettings(cfg);
    this.renderPreview(cfg);
    this.el.settings.showModal();
  }

  /** Fyller panelen på nytt, t.ex. efter återställning till standard. */
  refreshSettings(cfg) {
    this.settingsBase = cfg;
    this.fillSettings(cfg);
    this.renderPreview(cfg);
  }

  /** Tillägg §4–5: förväntat utfall och balanskontroll med givna parametrar, plus τ. */
  renderPreview(cfg) {
    const p = preview(cfg);
    const tauLine = document.createElement('p');
    tauLine.className = 'preview-tau';
    tauLine.textContent = `τ = H_air / G = ${Math.round(p.tau)} s`;

    const persons = table(
      ['Person', 'Vikt', 'Effekt', 'P0', `Maxhöjd efter ${PERSON_SECONDS} s`],
      p.persons.map((x) => [x.name, `${x.mass} kg`, `${x.power} W`, `${fmtW(x.P0)} W`, x.h > 0 ? `${fmtM(x.h)} m` : 'lättar inte'])
    );
    const best = p.balance.reduce((a, b) => (b.h > a.h ? b : a));
    const balance = table(
      [`Insats (${BALANCE_MASS} kg)`, 'Effekt', 'Maxhöjd'],
      p.balance.map((b) => [b.label + (b === best ? ' ★' : ''), `${b.power} W`, `${fmtM(b.h)} m`])
    );
    const verdict = document.createElement('p');
    verdict.className = 'preview-verdict';
    const ok = best.s >= 180 && best.s <= 300;
    verdict.dataset.ok = String(ok);
    verdict.textContent = ok
      ? `Bästa insatsen: ${best.label} – inom målet 3–5 minuter.`
      : `Bästa insatsen: ${best.label} – utanför målet 3–5 minuter.`;
    this.el.settingsPreview.replaceChildren(tauLine, persons, balance, verdict);
  }

  #buildCalibrationHelp() {
    $('calibration-steps').replaceChildren(
      ...CALIBRATION_STEPS.map((text) => Object.assign(document.createElement('li'), { textContent: text }))
    );
    $('calibration-actions').tBodies[0].replaceChildren(
      ...CALIBRATION_ACTIONS.map((cells) => row(cells))
    );
  }

  closeSettings() {
    this.el.settings.close();
  }
}

function table(headers, rows) {
  const t = document.createElement('table');
  t.className = 'preview-table';
  const head = t.createTHead().insertRow();
  for (const h of headers) head.append(Object.assign(document.createElement('th'), { textContent: h }));
  const body = t.createTBody();
  for (const cells of rows) body.append(row(cells));
  return t;
}

function row(cells) {
  const tr = document.createElement('tr');
  for (const c of cells) tr.append(Object.assign(document.createElement('td'), { textContent: c }));
  return tr;
}

const fmtW = (w) => (Math.round(w * 10) / 10).toLocaleString('sv-SE');

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Laddar ned text som en fil. */
export function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
