// DOM-delen av spelet: skärmar, instrument, topplista, inställningar, debug.
// All text från användare eller datakällor sätts med textContent.

import { CONFIG_SCHEMA, CLASSES, CHILD_CLASS, CHILD_REMINDER, formatMilestones, parseMilestones, sanitize } from '../core/config.js';
import { preview, CALIBRATION_STEPS, CALIBRATION_ACTIONS, PERSON_SECONDS, BALANCE_MASS } from '../core/calibration.js';
import { fmtM } from './render.js';
import { describeResults, starText, programOf } from '../core/exercise.js';
import { drawHelicopter } from './heli-draw.js';

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

const REASONS = {
  landed: 'Landade',
  idle: 'Inga fler drag',
  time: 'Tiden är slut',
  operator: 'Avbrutet',
};

const MAX_DEBUG_LINES = 200;
const ODO_ROLL_MAX_MS = 15; // över den här farten hinner siffrorna inte rulla klart, så de byts direkt
const LIFT_GAUGE_MAX = 300; // lyftmätarens skala i %, samma tak som ljudet (spec §8)
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
      liftNeedle: $('lift-needle'),
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
      readyGoal: $('ready-goal'),
      readyBest: $('ready-best'),
      menuName: $('menu-name'),
      menuTitle: $('menu-title'),
      menuLogbook: $('menu-logbook'),
      menuAlarm: $('menu-alarm'),
      menuSchool: $('menu-school'),
      menuList: $('menu-list'),
      menuFree: $('menu-free'),
      menuLead: $('menu-lead'),
      drill: $('drill'),
      drillName: $('drill-name'),
      drillStep: $('drill-step'),
      drillText: $('drill-text'),
      drillBar: $('drill-bar'),
      drillBarFill: $('drill-bar-fill'),
      drillSink: $('drill-sink'),
      drillNote: $('drill-note'),
      countdown: $('countdown'),
      finName: $('fin-name'),
      finReason: $('fin-reason'),
      finHeight: $('fin-height'),
      finRank: $('fin-rank'),
      finStars: $('fin-stars'),
      finList: $('fin-list'),
      finNote: $('fin-note'),
      certificate: $('certificate'),
      finMilestone: $('fin-milestone'),
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
    this.altShape = null; // höjdmätarens teckenmönster, byggs om när antalet siffror ändras
    this.settingsBase = null;
    this.#buildClassOptions();
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

  /**
   * @param {object|null} item  vald övning, lektion eller uppflygning, null = fri flygning
   * @param {{ stars: number, summary: string }|null} [best]  bästa resultatet i övningen
   */
  showReady(name, item = null, best = null) {
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

  /**
   * Menyn efter inmatningen: flygskolan (lektioner och uppflygningen), övningarna
   * med stjärnor och fri flygning. Förslaget startar med ett drag; piltangenterna
   * och Enter eller ett tryck väljer något annat.
   * @param {object} m
   * @param {string} m.name, m.title, m.logbook
   * @param {{ item, title, sub, state }[]} m.school   state: done | next | tomorrow | later | open | passed
   * @param {{ item, stars: number|null }[]} m.exercises
   * @param {object|null} m.suggested  det ett drag startar, null = fri flygning
   * @param {string|null} m.alarm      text om larmen (junior)
   * @param {(item: object|null) => void} onChoose
   */
  renderMenu(m, onChoose) {
    const e = this.el;
    e.menuName.textContent = m.name;
    e.menuTitle.textContent = m.title;
    e.menuLogbook.textContent = m.logbook;
    e.menuLead.textContent = `Dra för att starta ${m.suggested ? m.suggested.name : 'fri flygning'} – eller välj något annat nedan.`;
    e.menuAlarm.hidden = !m.alarm;
    e.menuAlarm.textContent = m.alarm ?? '';

    const pill = (text, cls) => Object.assign(document.createElement('span'), { className: cls, textContent: text });
    const button = (cls, item, disabled, parts) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `menu-item ${cls} ${item === m.suggested ? 'suggested' : ''}`.trim();
      b.disabled = disabled;
      b.append(...parts);
      if (item === m.suggested) b.append(pill('Dra för att starta', 'menu-pull'));
      b.addEventListener('click', () => onChoose(item));
      li.append(b);
      return li;
    };
    const STATE = {
      done: ['✓ Genomförd', 'menu-done'],
      next: ['Nästa', 'menu-state'],
      tomorrow: ['I morgon', 'menu-state wait'],
      later: ['Låst', 'menu-state wait'],
      open: ['Öppen', 'menu-state'],
      passed: ['✓ Godkänd', 'menu-done'],
      retry: ['Omprov i morgon', 'menu-state wait'],
    };
    e.menuSchool.replaceChildren(
      ...m.school.map((x) => {
        const [text, cls] = STATE[x.state];
        const parts = [
          pill(x.title, 'menu-name'),
          pill(x.sub, 'menu-goal'),
          ...(x.item === m.suggested ? [] : [pill(text, cls)]),
        ];
        return button(`school ${x.item.kind === 'exam' ? 'exam' : ''}`, x.item, ['tomorrow', 'later', 'retry'].includes(x.state), parts);
      })
    );
    e.menuList.replaceChildren(
      ...m.exercises.map(({ item, stars }) =>
        button('tile', item, false, [
          pill(item.name, 'menu-name'),
          pill(stars ? starText(stars) : '–', `menu-stars ${stars ? '' : 'none'}`.trim()),
          pill(item.goal, 'menu-goal'),
        ])
      )
    );
    e.menuFree.replaceChildren(
      button('free', null, false, [pill('Fri flygning', 'menu-name'), pill('Så högt du kan – topplistan', 'menu-goal')])
    );
  }

  /**
   * Övningens panel under flygningen. null döljer den.
   * @param {{ name, stepText, stepLabel, progress?, sink?, note? }|null} d
   *   sink: { speed, max } visas under landningen, note är instruktörens kommentar
   */
  updateDrill(d) {
    const e = this.el;
    e.drill.hidden = !d;
    if (!d) return;
    setText(e.drillName, d.name);
    setText(e.drillStep, d.stepLabel);
    setText(e.drillText, d.stepText);
    e.drillBar.hidden = d.progress == null;
    if (d.progress != null) e.drillBarFill.style.width = `${Math.round(d.progress * 100)}%`;
    e.drillSink.hidden = !d.sink;
    if (d.sink) {
      const dec = (x) => x.toFixed(1).replace('.', ',');
      setText(e.drillSink, `Sjunker ${dec(Math.max(0, d.sink.speed))} m/s · max ${dec(d.sink.max)}`);
      e.drillSink.dataset.ok = String(d.sink.speed <= d.sink.max);
    }
    e.drillNote.hidden = !d.note;
    if (d.note) setText(e.drillNote, d.note);
  }

  setCountdown(n) {
    const text = String(Math.max(1, Math.ceil(n)));
    if (this.el.countdown.textContent !== text) this.el.countdown.textContent = text;
  }

  /**
   * rank/total gäller inom deltagarens klass.
   * @param {object} [extra]  från profilen: { bests, promoted, teaser, next, heliName, date }
   *   next: text om vad som väntar (t.ex. "Nästa lektion i morgon")
   */
  showFinished(result, rank, total, extra = {}) {
    const e = this.el;
    e.finName.textContent = result.klass ? `${result.name} · ${result.klass}` : result.name;
    delete e.finHeight.dataset.status;
    e.finStars.hidden = true;
    e.finList.hidden = true;
    e.finNote.hidden = true;
    e.certificate.hidden = true;
    if (result.exercise) return this.#showExerciseResult(result, extra);
    e.finReason.textContent = REASONS[result.reason] ?? '';
    e.finHeight.textContent = `${fmtM(result.hMax)} m`;
    e.finRank.textContent = result.klass ? `Plats ${rank} av ${total} i klassen` : `Plats ${rank} av ${total}`;
    const m = result.milestone;
    e.finMilestone.textContent = m
      ? `Högsta milstolpe: ${m.name} (${[m.area, `${fmtM(m.h)} m`].filter(Boolean).join(', ')})`
      : 'Ingen milstolpe den här gången';
  }

  #showExerciseResult(result, extra) {
    const e = this.el;
    const ex = result.exercise;
    const status = ex.status === 'running' ? 'aborted' : ex.status;
    const note = (text) => {
      e.finNote.hidden = !text;
      e.finNote.textContent = text ?? '';
    };
    e.finHeight.dataset.status = status;
    e.finMilestone.textContent = `Tid ${formatClock(result.duration)} · dra för att fortsätta`;

    if (ex.kind === 'exercise') {
      const m = ex.moments[0];
      e.finReason.textContent = `Övning: ${ex.name}`;
      e.finHeight.textContent = { passed: 'Godkänd!', failed: 'Underkänd', aborted: 'Avbruten' }[status];
      e.finStars.hidden = status !== 'passed';
      e.finStars.textContent = m ? starText(m.stars) : '';
      e.finRank.textContent = status === 'failed' ? ex.failReason : describeResults(ex.results);
      const best = extra.bests?.find((b) => b.id === ex.id);
      note(best?.prev ? `Nytt personbästa! Förra bästa: ${starText(best.prev.stars)}${best.prev.summary ? ` – ${best.prev.summary}` : ''}` : null);
      return;
    }

    // Lektion eller uppflygning: ett protokoll med alla moment.
    const exam = ex.kind === 'exam';
    e.finReason.textContent = ex.name;
    e.finHeight.textContent =
      status === 'aborted' ? 'Avbruten' : exam ? (status === 'passed' ? 'Godkänd!' : 'Underkänd') : 'Lektionen klar!';
    if (!exam && status !== 'aborted') e.finHeight.dataset.status = 'passed';
    const stars = ex.moments.reduce((a, m) => a + m.stars, 0);
    e.finStars.hidden = exam || status === 'aborted';
    e.finStars.textContent = `${stars} av ${ex.plan.length * 3} ★`;
    e.finRank.textContent = '';
    e.finList.hidden = false;
    e.finList.replaceChildren(
      ...ex.plan.map((p) => {
        const m = ex.moments.find((x) => x.id === p.id);
        const li = document.createElement('li');
        li.dataset.status = m?.status ?? 'skipped';
        const head = Object.assign(document.createElement('span'), {
          className: 'fin-moment',
          textContent: `${m ? (m.status === 'passed' ? '✓' : '✗') : '–'} ${p.name}`,
        });
        const detail = Object.assign(document.createElement('span'), {
          className: 'fin-detail',
          textContent: !m ? 'inte flugen' : m.status === 'passed' ? `${starText(m.stars)} ${describeResults(m.results)}` : m.failReason,
        });
        if (extra.bests?.some((b) => b.id === p.id && b.prev)) detail.textContent += ' · nytt personbästa!';
        li.append(head, detail);
        return li;
      })
    );
    if (exam && status === 'passed' && extra.promoted) {
      e.finList.hidden = true;
      e.certificate.hidden = false;
      $('cert-name').textContent = result.name;
      $('cert-heli-name').textContent = extra.heliName ?? '';
      $('cert-date').textContent = extra.date ?? '';
      drawCertificateHeli($('cert-heli'), extra.livery);
    }
    note([status === 'aborted' ? null : extra.teaser, extra.next].filter(Boolean).join(' ') || null);
  }

  // --- Instrument --------------------------------------------------------------------

  /**
   * @param {object} v
   * @param {number} v.h, v.hMax, v.vy, v.time, v.lift (andel), v.power, v.pReq, v.P0
   * @param {number} [v.rotor]   rotorvarvet relativt hovring vid marken
   * @param {number} [v.thrust]  lyftkraften relativt tyngden
   * @param {boolean} v.onGround, v.showRaw
   * @param {number|null} v.replaySpeed
   */
  updateHud(v) {
    const e = this.el;
    this.#setAltitude(fmtM(v.h));
    e.alt.classList.toggle('fast', Math.abs(v.vy) > ODO_ROLL_MAX_MS);
    setText(e.altMax, `${fmtM(v.hMax)} m`);

    const pct = Math.round(v.lift * 100);
    const shown = Math.min(LIFT_GAUGE_MAX, Math.max(0, pct));
    setText(e.liftPct, `${pct} %`);
    e.liftFill.style.strokeDasharray = `${shown} ${LIFT_GAUGE_MAX}`;
    e.liftNeedle.style.transform = `rotate(${(shown / LIFT_GAUGE_MAX) * 180 - 90}deg)`;
    e.liftMeter.setAttribute('aria-valuenow', String(pct));
    e.lift.classList.toggle('good', pct >= 100);
    e.lift.classList.toggle('strong', pct >= 200);
    setText(e.liftHint, v.onGround ? 'På marken: över 100 % lyfter du' : '100 % = håller höjden');

    const vy = Math.abs(v.vy) < 0.05 ? 0 : v.vy;
    setText(e.vario, `${vy > 0 ? '↑' : vy < 0 ? '↓' : '·'} ${Math.abs(vy).toFixed(1).replace('.', ',')} m/s`);
    setText(e.timer, formatClock(v.time));

    e.raw.hidden = !v.showRaw;
    if (v.showRaw) {
      const rotor = v.rotor === undefined ? '' : ` · rotor ${Math.round(v.rotor * 100)} % · lyft ${Math.round(v.thrust * 100)} %`;
      setText(e.raw, `P ${Math.round(v.power)} W · krävs ${Math.round(v.pReq)} W · P0 ${Math.round(v.P0)} W${rotor}`);
    }
    e.replayBadge.hidden = !v.replaySpeed;
    if (v.replaySpeed) setText(e.replayBadge, `Landning ×${Math.max(1, Math.round(v.replaySpeed))}`);
  }

  /**
   * Höjdmätaren: varje siffra är en remsa 0–9 som rullar till rätt läge, som
   * en mekanisk räknare. Remsorna byggs om bara när antalet tecken ändras.
   */
  #setAltitude(text) {
    const el = this.el.alt;
    const shape = text.replace(/\d/g, '0');
    if (shape !== this.altShape) {
      this.altShape = shape;
      const parts = [...text].map((ch) => {
        if (!/\d/.test(ch)) return Object.assign(document.createElement('span'), { className: 'odo-sep', textContent: ch });
        const digit = document.createElement('span');
        digit.className = 'odo-digit';
        const strip = document.createElement('span');
        strip.className = 'odo-strip';
        for (let d = 0; d <= 9; d++) strip.append(Object.assign(document.createElement('span'), { textContent: String(d) }));
        digit.append(strip);
        return digit;
      });
      const unit = Object.assign(document.createElement('span'), { className: 'odo-unit', textContent: ' m' });
      el.replaceChildren(...parts, unit);
    }
    el.setAttribute('aria-label', `${text} meter`);
    const digits = [...text].filter((ch) => /\d/.test(ch));
    el.querySelectorAll('.odo-strip').forEach((strip, i) => {
      const y = `translateY(${-Number(digits[i])}em)`;
      if (strip.style.transform !== y) strip.style.transform = y;
    });
  }

  /** Synliga rutor på startskärmen, så att bergens skyltar inte hamnar under dem. */
  idleRects() {
    const idle = $('screen-idle');
    if (idle.hidden) return [];
    return [...idle.querySelectorAll('.title, .board-panel, .start-cta')].map((el) => el.getBoundingClientRect());
  }

  /**
   * Notis, t.ex. en passerad milstolpe. Köas så att snabba passager inte skriver
   * över varandra; vid lång kö hoppas de äldsta över.
   */
  /** Synliga instrumentpaneler i skärmkoordinater, så att scenen kan undvika dem. */
  hudRects() {
    const els = this.el.hud.hidden
      ? []
      : [document.querySelector('.hud-alt'), this.el.lift, this.el.vario, this.el.timer, this.el.drill];
    // getClientRects() är tom för dolda element (offsetParent duger inte: fixed ger alltid null)
    return els.filter((el) => el && el.getClientRects().length > 0).map((el) => el.getBoundingClientRect());
  }

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

/** Den nya helikoptern på certifikatet, stilla på marken. */
function drawCertificateHeli(canvas, livery) {
  const ctx = canvas.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  const c = { body: v('--heli-body'), glass: v('--heli-glass'), metal: v('--heli-metal'), rotor: v('--heli-rotor') };
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2 + 10, 92);
  ctx.scale(1.3, 1.3);
  drawHelicopter(ctx, { blur: 0, angle: 0.3, tailAngle: 0.5 }, c, livery);
  ctx.restore();
}

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
