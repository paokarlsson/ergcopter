// DOM-delen av spelet: skärmarna (start, ny flygning, redo, nedräkning), topplistan,
// notiser, anslutningen, inställningar och debug. Instrumenten ligger i hud.js,
// Fjällräddaren-menyn i career.js, resultatet i results.js och flygloggarna i logplayer.js.
// All text från användare eller datakällor sätts med textContent.

import { CONFIG_SCHEMA, CHILD_CLASS, CHILD_REMINDER, formatMilestones, parseMilestones, sanitize } from '../core/config.js';
import { preview, CALIBRATION_STEPS, CALIBRATION_ACTIONS, PERSON_SECONDS, BALANCE_MASS } from '../core/calibration.js';
import { fmtM } from './render.js';
import { starText, programOf } from '../core/exercise.js';

const $ = (id) => document.getElementById(id);

const SCREEN_FOR_STATE = {
  IDLE: 'screen-idle',
  SETUP: 'screen-setup',
  MENU: 'screen-menu',
  READY: 'screen-ready',
  COUNTDOWN: 'screen-countdown',
  FLYING: null,
  FINISHED: 'screen-finished',
};

const MAX_DEBUG_LINES = 200;
const TOAST_MS = 2400; // samma som animationen i game.css

export class GameUI {
  constructor() {
    this.el = {
      hud: $('hud'),
      toast: $('toast'),
      idle: $('screen-idle'),
      mainMenu: $('main-menu'),
      boardPanel: $('board-panel'),
      boardIdle: $('board-idle'),
      boardTabs: $('board-tabs'),
      todayIdle: $('today-idle'),
      connStatus: $('conn-status'),
      sourceSelect: $('source-select'),
      connect: $('connect'),
      setupForm: $('setup-form'),
      setupMode: $('setup-mode'),
      setupSubmit: $('setup-submit'),
      setupError: $('setup-error'),
      name: $('name'),
      age: $('age'),
      mass: $('mass'),
      klassHint: $('klass-hint'),
      liftTitle: $('lift-title'),
      liftValue: $('lift-value'),
      childReminder: $('child-reminder'),
      readyKicker: $('ready-kicker'),
      readyName: $('ready-name'),
      readyGoal: $('ready-goal'),
      readyBest: $('ready-best'),
      countdown: $('countdown'),
      disc: $('screen-disconnected'),
      discMessage: $('disc-message'),
      reconnect: $('reconnect'),
      warning: $('warning'),
      warningText: $('warning-text'),
      settings: $('settings'),
      settingsFields: $('settings-fields'),
      settingsPreview: $('settings-preview'),
      debug: $('debug'),
    };
    $('warning-close').addEventListener('click', () => (this.el.warning.hidden = true));
    this.toastTimer = null;
    this.toastQueue = [];
    this.settingsBase = null;
    this.#buildCalibrationHelp();
    // Förhandsvisningen räknas om medan operatören ändrar värden (spec §12.4).
    this.el.settingsFields.addEventListener('input', () => {
      if (this.settingsBase) this.renderPreview(sanitize(this.readSettings(this.settingsBase)));
    });
  }

  // --- Skärmar ------------------------------------------------------------------

  showState(state) {
    for (const id of Object.values(SCREEN_FOR_STATE)) if (id) $(id).hidden = true;
    const id = SCREEN_FOR_STATE[state];
    if (id) $(id).hidden = false;
    this.el.hud.hidden = !['COUNTDOWN', 'FLYING'].includes(state);
    if (state === 'SETUP') {
      this.el.setupError.textContent = '';
      this.el.name.focus();
    }
  }

  /** Startskärmen visar menyn eller topplistan. */
  setIdleView(view) {
    this.el.mainMenu.hidden = view !== 'menu';
    this.el.boardPanel.hidden = view !== 'board';
  }

  get idleView() {
    return this.el.boardPanel.hidden ? 'menu' : 'board';
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

  /** Rubriken och knappen efter läget: så högt som möjligt eller Fjällräddaren. */
  setSetupMode(mode) {
    this.el.setupMode.textContent = mode === 'free' ? 'Så högt som möjligt' : 'Fjällräddaren';
    this.el.setupSubmit.textContent = mode === 'free' ? 'Starta flygning' : 'Till Fjällräddaren';
  }

  /**
   * Klassen som åldern ger, och påminnelsen för barn (spec §12.2).
   * @param {{ name: string, ages: string }|null} klass
   */
  setKlass(klass) {
    this.el.klassHint.textContent = klass ? `Klass: ${klass.name}` : '';
    this.el.childReminder.textContent = CHILD_REMINDER;
    this.el.childReminder.hidden = klass?.name !== CHILD_CLASS;
  }

  /**
   * Lyfteffekten i rutan. Visas i watt bara med råa watt påslaget, annars avslöjar
   * den vikten (spec §6).
   * @param {string|null} watts  t.ex. "60 W", null = visas inte
   */
  setLiftPower(watts) {
    this.el.liftTitle.textContent = watts === null ? 'Din lyfteffekt' : 'Din beräknade lyfteffekt';
    this.el.liftValue.textContent = watts ?? 'Räknas från vikten';
    this.el.liftValue.classList.toggle('secret-value', watts === null);
  }

  /** Läser formuläret och tömmer ålder och vikt direkt, så att de inte ligger kvar. */
  takeSetup() {
    const data = {
      name: this.el.name.value,
      age: this.el.age.value,
      mass: this.el.mass.value.trim() === '' ? NaN : Number(this.el.mass.value),
    };
    this.el.age.value = '';
    this.el.mass.value = '';
    this.setKlass(null);
    return data;
  }

  clearSetup() {
    this.el.name.value = '';
    this.el.age.value = '';
    this.el.mass.value = '';
    this.setKlass(null);
  }

  /**
   * @param {object|null} item  vald övning, lektion eller uppflygning, null = fri flygning
   * @param {{ stars: number, summary: string }|null} [best]  bästa resultatet i övningen
   */
  showReady(name, item = null, best = null) {
    this.el.readyKicker.textContent = item ? (item.kind === 'exam' ? 'Uppflygning' : item.steps ? 'Övning' : 'Lektion') : 'Så högt som möjligt';
    this.el.readyName.textContent = name;
    this.el.readyGoal.hidden = !item;
    this.el.readyBest.hidden = !item;
    if (!item) return;
    this.el.readyGoal.textContent = `${item.name}: ${item.goal}`;
    if (item.moments) {
      const names = programOf(item).moments.map((m) => m.name);
      this.el.readyBest.textContent = `${item.intro} Moment: ${names.join(' · ')}.`;
    } else {
      this.el.readyBest.textContent = best
        ? `Ditt bästa: ${starText(best.stars)}${best.summary ? ` – ${best.summary}` : ''}`
        : 'Första gången – lycka till!';
    }
  }

  setCountdown(n) {
    const text = String(Math.max(1, Math.ceil(n)));
    if (this.el.countdown.textContent !== text) this.el.countdown.textContent = text;
  }

  /** Synliga rutor på startskärmen, så att topparnas etiketter inte hamnar under dem. */
  idleRects() {
    if (this.el.idle.hidden) return [];
    return [...this.el.idle.querySelectorAll('.brand, .main-menu, .board-panel, .demo-btn')]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => el.getBoundingClientRect());
  }

  /**
   * Notis, t.ex. en passerad milstolpe. Köas så att snabba passager inte skriver
   * över varandra; vid lång kö hoppas de äldsta över.
   */
  toast(title, subtitle = '', kicker = '') {
    this.toastQueue.push({ title, subtitle, kicker });
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
    const kicker = document.createElement('div');
    kicker.className = 'toast-kicker';
    kicker.textContent = item.kicker;
    t.replaceChildren(...(item.kicker ? [kicker] : []), title, ...(item.subtitle ? [sub] : []));
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

  /** Kort bekräftelse på en knapp, t.ex. "Kopierad ✓". */
  flashButton(button, text) {
    const original = button.textContent;
    button.textContent = text;
    setTimeout(() => (button.textContent = original), 2000);
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

  /** Spec §12.3–12.4: förväntat utfall och balanskontroll med givna parametrar, plus τ. */
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

/** Laddar ned text som en fil. */
export function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
