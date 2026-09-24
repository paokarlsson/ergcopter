// Kopplar ihop spelet: datakälla → spel (fysik) → rendering och instrument.

import { loadConfig, saveConfig, resetConfig, sanitize, liftPower, CLASSES } from './config.js';
import { Game } from './game.js';
import { StrokeSmoother } from './signal.js';
import { Leaderboard } from './leaderboard.js';
import { Rotor } from './rotor.js';
import { GameRenderer, fmtM } from './render.js';
import { GameUI, download } from './ui.js';
import { Replay, landingTrajectory } from './replay.js';
import { RotorSound } from './audio.js';
import { now } from './sources/source.js';
import { MockSource } from './sources/mock.js';
import { UsbPm5Source } from './sources/usb.js';
import { Pm5Source } from './sources/ble.js';

const SOURCE_KEY = 'skierg.source';

let cfg = loadConfig();
const board = new Leaderboard();
const game = new Game(cfg);
const rotor = new Rotor();
const renderer = new GameRenderer(document.getElementById('scene'));
const ui = new GameUI();
const sound = new RotorSound();
sound.setEnabled(cfg.sound);
// Glidande effekt även utanför passet, så att rotorn svarar redan i READY (BLE saknar kraftdata).
const preview = new StrokeSmoother(cfg);

let source = null;
let sourceKind = null;
let replay = null;
let todayBest = null; // dagens rekord i den aktuella deltagarens klass
const BOARD_ROTATE_MS = 8000;
let boardTab = 0;
let boardTimer = null;

// --- Topplista per klass (tillägg §2) ----------------------------------------------

function boardTabs() {
  const tabs = CLASSES.map((c) => ({ label: c.name, klass: c.name }));
  return cfg.showCombinedBoard ? [...tabs, { label: 'Alla', klass: null }] : tabs;
}

function showBoard(i = boardTab) {
  const tabs = boardTabs();
  boardTab = ((i % tabs.length) + tabs.length) % tabs.length;
  const { klass } = tabs[boardTab];
  ui.renderBoardTabs(tabs, boardTab, (j) => {
    showBoard(j);
    startBoardRotation(); // manuellt val: börja om väntetiden
  });
  ui.renderBoard(board.top(10, klass), board.todayBest(Date.now(), klass));
}

/** Startskärmen bläddrar själv mellan klasserna, så att publiken ser alla. */
function startBoardRotation() {
  clearInterval(boardTimer);
  boardTimer = setInterval(() => showBoard(boardTab + 1), BOARD_ROTATE_MS);
}

// --- Datakälla ------------------------------------------------------------------

function createSource(kind) {
  if (kind === 'usb') return new UsbPm5Source();
  if (kind === 'ble') return new Pm5Source();
  return new MockSource({ spm: cfg.mockSpm });
}

function attach(kind) {
  source?.stop();
  sourceKind = kind;
  source = createSource(kind);
  source.on('stroke', (s) => {
    preview.push(s);
    game.stroke(s);
  });
  source.on('force', (samples) => rotor.addForces(samples));
  source.on('status', onStatus);
  source.on('raw', (line) => {
    ui.debug(line);
    if (line.startsWith('[error]')) console.error('[SkiErg]', line);
  });
  source.setTrace?.(ui.debugVisible);
  ui.showMock(kind === 'mock', 0);
  try {
    localStorage.setItem(SOURCE_KEY, kind);
  } catch {}
  return source;
}

/** Från Anslut-knappen (klick krävs för USB- och Bluetooth-väljaren). */
async function connect(kind) {
  const s = attach(kind);
  try {
    await s.start();
  } catch (err) {
    if (s === source) onStatus({ state: 'error', message: err.message });
  }
}

function onStatus(status) {
  ui.setConnStatus(status, source?.name);
  if (status.warning) ui.showWarning(status.warning);
  const lost = status.state === 'reconnecting' || status.state === 'disconnected';
  game.setPaused(lost);
  ui.showDisconnected(lost && ['COUNTDOWN', 'FLYING'].includes(game.state) ? status : null);
}

const connected = () => source?.status.state === 'connected';

// ?demo: Mock-källan flyger en demospelare (80 kg) efter en effektprofil, utan erg.
const DEMO_PROFILE = [
  [8, 60],
  [40, 280],
  [60, 230],
  [20, 120],
];
async function runDemo() {
  await connect('mock');
  game.openSetup();
  ui.setupError(game.submitSetup({ name: 'Demo', mass: 80, klass: 'Vuxen' }));
  const start = now();
  setInterval(() => {
    let t = now() - start;
    for (const [s, w] of DEMO_PROFILE) {
      if (t < s) return setMockPower(w);
      t -= s;
    }
    setMockPower(0);
  }, 250);
}

// Återuppta senaste källan utan klick där det går (USB som redan är godkänd, Mock).
if (new URLSearchParams(location.search).has('demo')) runDemo();
else (async () => {
  let last = null;
  try {
    last = localStorage.getItem(SOURCE_KEY);
  } catch {}
  if (last) ui.el.sourceSelect.value = last;
  if (last === 'mock') connect('mock');
  else if (last === 'usb' && UsbPm5Source.supported) {
    const s = attach('usb');
    if (!(await s.resume())) s.setStatus('idle');
  }
})();

// --- Spelhändelser ----------------------------------------------------------------

game.on('state', ({ to }) => {
  ui.showState(to);
  if (to === 'IDLE' || to === 'READY') ui.clearToasts();
  if (to === 'IDLE' || to === 'COUNTDOWN') renderer.clearMountains();
  if (to === 'IDLE') {
    replay = null;
    showBoard();
    startBoardRotation();
  } else if (to === 'SETUP') {
    clearInterval(boardTimer);
    ui.setConnStatus(source?.status ?? { state: 'idle' }, source?.name);
  } else if (to === 'READY') {
    todayBest = board.todayBest(Date.now(), game.player.klass);
    ui.showReady(game.player.name);
    ui.clearSetup();
  }
});

game.on('milestone', (m) => ui.toast(`${m.name} ${fmtM(m.h)} m!`, m.area ?? ''));

game.on('finish', (result) => {
  const { entry } = board.add(result);
  const { rank, total } = board.classRank(entry);
  todayBest = board.todayBest(Date.now(), result.klass);
  // Visa deltagarens klass när vi kommer tillbaka till startskärmen.
  boardTab = Math.max(0, boardTabs().findIndex((t) => t.klass === result.klass));
  replay = result.endH > 0 ? new Replay(landingTrajectory(game.flight), cfg.dt, cfg.replayMaxS) : null;
  ui.showFinished(result, rank, total);
});

// --- Formulär och knappar ---------------------------------------------------------

document.getElementById('start').addEventListener('click', () => game.openSetup());
document.getElementById('setup-cancel').addEventListener('click', () => game.escape());
ui.el.connect.addEventListener('click', () => connect(ui.el.sourceSelect.value));
ui.el.reconnect.addEventListener('click', () => connect(sourceKind));
ui.el.setupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = ui.takeSetup();
  if (!connected()) return ui.setupError('Anslut ergen först');
  ui.setupError(game.submitSetup(data));
});
document.getElementById('screen-finished').addEventListener('click', () => game.dismissResult());

ui.el.mockPower.addEventListener('input', () => setMockPower(Number(ui.el.mockPower.value)));
function setMockPower(watts) {
  if (!(source instanceof MockSource)) return;
  source.setPower(watts);
  ui.setMockPower(source.power);
}

// Inställningar
function openSettings() {
  ui.openSettings(cfg);
}
function applyConfig(next) {
  cfg = sanitize(next);
  saveConfig(cfg);
  game.setConfig(cfg);
  preview.cfg = cfg;
  sound.setEnabled(cfg.sound);
  if (source instanceof MockSource) source.spm = cfg.mockSpm;
  if (game.state === 'IDLE') showBoard(); // t.ex. sammanlagd lista på/av
}
document.getElementById('settings-form').addEventListener('submit', () => applyConfig(ui.readSettings(cfg)));
document.getElementById('settings-close').addEventListener('click', () => ui.closeSettings());
document.getElementById('settings-reset').addEventListener('click', () => {
  applyConfig(resetConfig());
  ui.refreshSettings(cfg);
});
document.getElementById('export-json').addEventListener('click', () =>
  download(`topplista-${dateStamp()}.json`, board.toJSON(), 'application/json')
);
document.getElementById('export-csv').addEventListener('click', () =>
  download(`topplista-${dateStamp()}.csv`, board.toCSV(), 'text/csv')
);
document.getElementById('board-clear').addEventListener('click', () => {
  if (!confirm('Rensa hela topplistan? Det går inte att ångra.')) return;
  board.clear();
  todayBest = null;
  if (game.state === 'IDLE') showBoard();
});

// --- Tangenter ------------------------------------------------------------------------

addEventListener('pointerdown', () => sound.unlock());
addEventListener('keydown', (e) => {
  sound.unlock();
  if (ui.settingsOpen) return; // dialogen sköter Esc själv
  if (e.key === 'Escape') return game.escape();
  if (e.target.closest?.('input, select, textarea')) return; // skriver i ett fält
  if (e.target.closest?.('button') && (e.key === 'Enter' || e.key === ' ')) return; // knappen klickas själv
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === 's') return openSettings();
  if (key === 'd') {
    const on = ui.toggleDebug();
    source?.setTrace?.(on);
    return;
  }
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    if (source instanceof MockSource) {
      e.preventDefault();
      setMockPower(source.power + (key === 'ArrowUp' ? 10 : -10));
    }
    return;
  }
  if (game.state === 'FINISHED' && !['Shift', 'Control', 'Alt', 'Meta'].includes(key)) return game.dismissResult();
  if (key === 'Enter') {
    if (game.state === 'IDLE') game.openSetup();
    else if (game.state === 'READY') game.startCountdown();
  }
});

// --- Loop ---------------------------------------------------------------------------

// Spellogiken drivs av en timer så att passet fortsätter även när fönstret är
// skymt (då pausar webbläsaren requestAnimationFrame). tick() är idempotent i tid,
// så den anropas också från renderingen för jämn interpolering.
setInterval(() => game.tick(now()), 50);

let last = null;
function frame() {
  const t = now();
  const dt = last === null ? 0 : Math.min(0.1, t - last);
  last = t;
  game.tick(t);

  const f = game.flight;
  let h = 0;
  let vy = 0;
  if (f && game.state === 'FLYING') {
    h = game.prevH + (f.h - game.prevH) * Math.min(1, game.alpha);
    vy = f.v;
  } else if (f && game.state === 'FINISHED') {
    if (replay && !replay.done) {
      const before = replay.h;
      replay.advance(dt);
      h = replay.h;
      vy = dt > 0 ? (h - before) / dt / replay.speed : 0;
    } else {
      h = replay ? replay.h : f.h;
    }
  }

  const P0 = f?.P0 ?? (game.player ? liftPower(cfg, game.player.mass) : cfg.P_ref);
  const power = game.state === 'FLYING' ? game.power : preview.value(now());
  rotor.step(dt, power / P0);
  renderer.advance(dt, rotor, h);
  renderer.draw({
    h,
    vy,
    rotor,
    hMax: f?.hMax ?? 0,
    todayBest,
    milestones: cfg.milestones,
    avoid: ui.hudRects(),
    flying: game.state === 'FLYING',
  });
  sound.update(power / P0, rotor.omega);

  if (game.state === 'COUNTDOWN') ui.setCountdown(game.countdownLeft);
  if (f && (game.state === 'FLYING' || game.state === 'FINISHED')) {
    ui.updateHud({
      h,
      hMax: f.hMax,
      vy,
      time: f.t,
      lift: game.state === 'FLYING' ? f.liftRatio(power) : 0,
      onGround: f.onGround,
      power,
      pReq: f.requiredPower(),
      P0: f.P0,
      showRaw: cfg.showRawWatts,
      replaySpeed: game.state === 'FINISHED' && replay && !replay.done ? replay.speed : null,
    });
  } else if (game.state === 'COUNTDOWN') {
    ui.updateHud({ h: 0, hMax: 0, vy: 0, time: 0, lift: 0, onGround: true, power: 0, pReq: P0, P0, showRaw: cfg.showRawWatts, replaySpeed: null });
  }
  requestAnimationFrame(frame);
}

ui.showState(game.state);
showBoard(0);
startBoardRotation();
requestAnimationFrame(frame);

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}
