// Live-dashboarden: siffror och kraftkurva från PM via USB (samma datakälla som spelet),
// och höjden och effekten relativt det som krävs från spelet i en annan flik (shared/live.js).
import { le, CMD, PM } from '../shared/csafe.js';
import { StrokeTracker, ForceChart, strokeStats } from './forcecurve.js';
import { UsbPm5Source } from '../shared/sources/usb.js';
import { mountScreenControls } from '../shared/screen.js';
import { openLive } from '../shared/live.js';

const $ = (id) => document.getElementById(id);
const ui = {
  connect: $('connect'),
  disconnect: $('disconnect'),
  status: $('status'),
  unsupported: $('unsupported'),
  log: $('log'),
  logToggle: $('log-toggle'),
  strokes: $('strokes'),
};

mountScreenControls($('screen-controls'));

const tracker = new StrokeTracker({ keep: 8 });
const chart = new ForceChart($('force-chart'), $('force-tip'));
chart.setData({ current: null, previous: [], live: false });

const STROKE_STATES = ['Väntar', 'Väntar på drag', 'Drag', 'Vila efter drag', 'Återföring'];
const WORKOUT_STATES = {
  0: 'Väntar på start',
  1: 'Pass pågår',
  2: 'Nedräkning',
  3: 'Intervallvila',
  4: 'Intervall (tid)',
  5: 'Intervall (distans)',
  6: 'Vila → tid',
  7: 'Vila → distans',
  8: 'Tid → vila',
  9: 'Distans → vila',
  10: 'Pass slut',
  11: 'Avbrutet',
  12: 'Omstart',
};

// --- Anslutning -----------------------------------------------------------

const source = new UsbPm5Source({ metrics: true });
source.on('metrics', render);
source.on('stroke', (s) => countStroke(s.power));
source.on('force', (samples, state) => applyForce(state, samples));
source.on('raw', (text) => logLine(text, text.startsWith('[error]') ? 'error' : text.startsWith('[warn]') ? 'warn' : 'log'));
source.on('status', ({ state, message }) => {
  const kind = { connected: 'ok', error: 'error', reconnecting: 'error' }[state] ?? 'idle';
  const text = {
    connecting: 'Ansluter…',
    connected: `Ansluten: ${message}`,
    reconnecting: `${message ?? 'Frånkopplad'} – försöker återansluta…`,
    error: message,
    idle: 'Inte ansluten',
  }[state];
  setStatus(text ?? state, kind);
  ui.connect.hidden = state === 'connected' || state === 'reconnecting';
  ui.disconnect.hidden = !ui.connect.hidden;
  if (state === 'error') showLog();
});

if (new URLSearchParams(location.search).has('demo')) {
  runDemo();
} else if (!UsbPm5Source.supported) {
  ui.unsupported.hidden = false;
  ui.connect.disabled = true;
} else {
  ui.connect.addEventListener('click', () => source.start().catch(() => {}));
  ui.disconnect.addEventListener('click', () => source.stop());
  source.resume(); // återanslut direkt om PM:en redan är godkänd
}

// --- Drag och spelet --------------------------------------------------------

const strokes = { count: 0, sum: 0, max: 0 };

/** Medel- och maxeffekt och antal drag sedan sidan öppnades. */
function countStroke(power) {
  strokes.count++;
  strokes.sum += power;
  strokes.max = Math.max(strokes.max, power);
  set('stroke-count', strokes.count);
  set('avg-power', `${Math.round(strokes.sum / strokes.count)} W`);
  set('max-power', `${Math.round(strokes.max)} W`);
}

const GAME_STALE_MS = 3000; // utan meddelande så här länge flyger inte spelet längre
let gameTimer = null;

/** Livedata från spelet: höjd, skillnad mot det som krävs, och watt om råa watt är på. */
function showGame(msg) {
  set('game-h', `${Math.round(msg.h).toLocaleString('sv-SE')} m`);
  const pct = Math.round((msg.lift - 1) * 100);
  set('game-diff', `${pct > 0 ? '+' : pct < 0 ? '−' : '±'}${Math.abs(pct)} %`);
  $('game-diff').dataset.sign = pct >= 0 ? 'up' : 'down';
  set('game-req', msg.watts ? `${Math.round(msg.watts.pReq)} W` : '–');
  $('game-hint').hidden = true;
  clearTimeout(gameTimer);
  gameTimer = setTimeout(() => {
    for (const id of ['game-h', 'game-diff', 'game-req']) set(id, '–');
    delete $('game-diff').dataset.sign;
    $('game-hint').hidden = false;
  }, GAME_STALE_MS);
}
openLive()?.addEventListener('message', (e) => showGame(e.data));

// --- Visning ---------------------------------------------------------------

function render({ std, pm: pmData }) {
  const time = pmData.get(PM.GET_WORKTIME);
  const dist = pmData.get(PM.GET_WORKDISTANCE);
  const pace = std.get(CMD.GETPACE);
  const cadence = std.get(CMD.GETCADENCE);
  const power = std.get(CMD.GETPOWER);
  const cal = std.get(CMD.GETCALORIES);
  const hr = std.get(CMD.GETHRCUR);
  const stroke = pmData.get(PM.GET_STROKESTATE);
  const workout = pmData.get(PM.GET_WORKOUTSTATE);
  const drag = pmData.get(PM.GET_DRAGFACTOR);

  // Tid i hundradelar, distans i decimeter (4 bytes LE + 1 bråkdelsbyte).
  if (time) set('time', formatTime(le(time, 4) / 100));
  if (dist) set('distance', Math.floor(le(dist, 4) / 10));
  // PM rapporterar tempo i s/km – visa som s/500 m.
  if (pace) set('pace', le(pace, 2) ? formatTime(le(pace, 2) / 2) : '–');
  if (cadence) set('cadence', le(cadence, 2) || '–');
  if (power) set('power', le(power, 2) ? `${le(power, 2)} W` : '–');
  if (cal) set('calories', le(cal, 2));
  if (hr) set('hr', hr[0] && hr[0] !== 255 ? hr[0] : '–');
  if (stroke) set('stroke', STROKE_STATES[stroke[0]] ?? stroke[0]);
  if (workout) set('workout', WORKOUT_STATES[workout[0]] ?? workout[0]);
  if (drag) set('drag', drag[0]);
}

/** Nya kraftsampel (N) och aktuell dragfas → kurva och tabell. */
function applyForce(state, samples) {
  const finishedBefore = tracker.history.length;
  if (tracker.update(state, samples)) {
    chart.setData({ current: tracker.current, previous: tracker.previous, live: tracker.isLive });
    if (tracker.history.length !== finishedBefore || !tracker.isLive) renderStrokeTable();
  }
}

function set(id, value) {
  const el = $(id);
  const text = String(value);
  if (el.textContent !== text) el.textContent = text;
}

function formatTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = (totalSeconds % 60).toFixed(1).padStart(4, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function setStatus(text, kind) {
  ui.status.textContent = text;
  ui.status.dataset.kind = kind;
}

function renderStrokeTable() {
  const rows = tracker.history
    .slice()
    .reverse()
    .map((stroke, i) => {
      const st = strokeStats(stroke);
      const tr = document.createElement('tr');
      const cells = [
        i === 0 ? 'Senaste' : `−${i}`,
        Math.round(st.peak),
        Math.round(st.mean),
        `${Math.round(st.peakPos * 100)} %`,
        st.driveMs !== null ? (st.driveMs / 1000).toFixed(2).replace('.', ',') : '–',
      ];
      for (const value of cells) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.append(td);
      }
      return tr;
    });
  ui.strokes.replaceChildren(...rows);
}

// --- Demo (?demo) ---------------------------------------------------------------

/** Påhittade drag, ett var 1,5:e s, med effekt som pendlar 20–160 W på en minut, och en påhittad flygning. */
function runDemo() {
  setStatus('Demoläge – ingen PM ansluten', 'idle');
  ui.connect.disabled = true;
  const started = performance.now();
  const DRIVE_SAMPLES = 36;
  let tick = 0;
  let i = 0;
  setInterval(() => {
    const t = (performance.now() - started) / 1000;
    const watts = 90 - 70 * Math.cos((2 * Math.PI * t) / 60);
    const peak = 250 + watts * 4;
    if (i < DRIVE_SAMPLES) {
      const block = [];
      for (let k = 0; k < 4 && i < DRIVE_SAMPLES; k++, i++) {
        const u = i / (DRIVE_SAMPLES - 1);
        block.push(peak * Math.sin(Math.PI * u ** 0.85) * (0.95 + 0.1 * Math.random()));
      }
      applyForce(2, block);
    } else {
      applyForce(4, []);
    }
    if (++tick % 30 === 0) {
      i = 0; // 30 × 50 ms = 1,5 s per drag
      countStroke(watts);
      set('cadence', 40);
    }
    set('power', `${Math.round(watts)} W`);
    set('time', formatTime(t));
    const lift = 1 + 0.12 * Math.sin(t / 4);
    showGame({ h: 900 + 500 * Math.sin(t / 30), lift, watts: { power: watts, pReq: watts / lift } });
  }, 50);
}

// --- Felsökningslogg --------------------------------------------------------

// Kronologisk, senaste längst ner. Loggar alltid, så den finns när man slår på den.
const MAX_LOG_LINES = 200;
ui.logToggle.addEventListener('change', () => {
  ui.log.hidden = !ui.logToggle.checked;
  source.setTrace(ui.logToggle.checked);
});

/** Skriver till sidans logg och till DevTools-konsolen (level: log | warn | error). */
function logLine(text, level = 'log') {
  console[level](`[SkiErg] ${text}`);
  const lines = `${ui.log.textContent}${text}\n`.split('\n');
  ui.log.textContent = lines.slice(-MAX_LOG_LINES - 1).join('\n');
  ui.log.scrollTop = ui.log.scrollHeight;
}

function showLog() {
  ui.logToggle.checked = true;
  ui.log.hidden = false;
  source.setTrace(true);
  ui.log.scrollTop = ui.log.scrollHeight;
}
