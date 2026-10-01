// Kopplar ihop spelet: datakälla → spel (fysik) → rendering och instrument.

import { loadConfig, saveConfig, resetConfig, sanitize, liftPower, classForAge, CLASSES, MIN_AGE, MAX_AGE, MIN_MASS, MAX_MASS } from './core/config.js';
import { Game } from './core/game.js';
import { Engine } from './core/engine.js';
import { Leaderboard } from './core/leaderboard.js';
import { Progress, dayOf, formatFlightTime } from './core/progress.js';
import { EXERCISES, stepGuides, starText, starGuide, describeResults } from './core/exercise.js';
import { LESSONS, EXAM, GRADES, FIRST_ALARM, careerState, findProgram } from './core/lessons.js';
import { getHelicopter, INSTRUCTOR_LIVERY } from './core/helicopters.js';
import { peaksAround, heightVerdict, recordKind } from './core/results.js';
import { autopilot } from './core/autopilot.js';
import { Rotor } from './view/rotor.js';
import { attractFlight } from './view/attract.js';
import { GameRenderer, fmtM, RING_SPEED_PX } from './view/render.js';
import { TerrainRenderer } from './view/terrain.js';
import { thumbView } from './view/thumbs.js';
import { GameUI, download } from './view/ui.js';
import { Hud } from './view/hud.js';
import { CareerMenu } from './view/career.js';
import { ResultScreen } from './view/results.js';
import { FlightLogView } from './view/logplayer.js';
import { Replay, landingTrajectory } from './core/replay.js';
import { FlightLogStore } from './core/flightlog.js';
import { RotorSound } from './view/audio.js';
import { now } from '../shared/sources/source.js';
import { MockSource } from '../shared/sources/mock.js';
import { UsbPm5Source } from '../shared/sources/usb.js';
import { Pm5Source } from '../shared/sources/ble.js';
import { mountScreenControls, toggleFullscreen } from '../shared/screen.js';
import { openLive } from '../shared/live.js';

const SOURCE_KEY = 'skierg.source';

let cfg = loadConfig();
const board = new Leaderboard();
const flightLogs = new FlightLogStore(); // de senaste flygningarna, för analys (spec §9.1)
const savedProgress = new Progress();
let anonymousProgress = new Progress(null); // anonyma: bara under passet, delas inte med nästa
const progress = () => (game.player?.anonymous ? anonymousProgress : savedProgress);
const game = new Game(cfg);
const rotor = new Rotor();
const attractRotor = new Rotor(); // startskärmens demotur har en egen rotor; den riktiga följer ergen
const ATTRACT_LIFT = 1.4; // demoturens rotorvarv, som effekt/P0
let attractStart = now();
// 3D-landskapet bakom 2D-scenen, om webbläsaren klarar WebGL2 (annars ritar render.js i 2D).
const terrainCanvas = document.getElementById('terrain');
let terrain = null;
const renderer = new GameRenderer(document.getElementById('scene'));
function setTerrain(on) {
  if (on && !terrain) terrain = TerrainRenderer.create(terrainCanvas);
  renderer.terrain = on ? terrain : null;
  renderer.terrainOff = false;
  terrainCanvas.style.visibility = 'hidden'; // renderer visar den när landskapet är klart
  renderer.terrainShown = null;
}
setTerrain(cfg.terrain3d);
const ui = new GameUI();
const hud = new Hud();
const careerMenu = new CareerMenu();
// Korten i menyn och flygloggarna får bilder av 3D-landskapet när det är igång
careerMenu.photos = (ids) => (renderer.landscape3d ? terrain.snapshots(ids.map(thumbView)) : null);
const resultScreen = new ResultScreen();
const logView = new FlightLogView(() => renderer.colors);
logView.photo = (view) => (renderer.landscape3d ? terrain.snapshots([view])[0] : null);
const sound = new RotorSound();
sound.setEnabled(cfg.sound);
// Motorn även utanför passet, så att rotorn svarar redan i READY (BLE saknar kraftdata).
const preview = new Engine(cfg);
const live = openLive(); // till dashboarden i en annan flik
const screenControls = document.getElementById('screen-controls');

let source = null;
let sourceKind = null;
let replay = null;
let todayBest = null; // dagens rekord i den aktuella deltagarens klass
let parkedLivery = null; // räddningshelikoptern som väntar vid verkstan tills uppflygningen är klar
const BOARD_ROTATE_MS = 8000;
let boardTab = 0;
let boardTimer = null;
// Startskärmen växlar själv till topplistan när ingen rört spelet på en stund (spec §7).
const IDLE_QUIET_S = 30;
const IDLE_BOARD_S = 20;
const IDLE_MENU_S = 30;
let lastInput = now();

// --- Topplista per klass (spec §12.2) ----------------------------------------------

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

/** Topplistan bläddrar själv mellan klasserna, så att publiken ser alla. */
function startBoardRotation() {
  clearInterval(boardTimer);
  boardTimer = setInterval(() => showBoard(boardTab + 1), BOARD_ROTATE_MS);
}

setInterval(() => {
  if (game.state !== 'IDLE' || logView.isOpen) return;
  const quiet = now() - lastInput;
  if (quiet < IDLE_QUIET_S) return; // någon använder menyn: låt vyn vara
  ui.setIdleView((quiet - IDLE_QUIET_S) % (IDLE_BOARD_S + IDLE_MENU_S) < IDLE_BOARD_S ? 'board' : 'menu');
}, 1000);

// --- Datakälla ------------------------------------------------------------------

const DEMO_SPM = 40;

function createSource(kind) {
  if (kind === 'usb') return new UsbPm5Source();
  if (kind === 'ble') return new Pm5Source();
  return new MockSource({ spm: DEMO_SPM }); // bara för ?demo, finns inte i gränssnittet
}

function attach(kind) {
  source?.stop();
  sourceKind = kind;
  source = createSource(kind);
  source.on('stroke', (s) => {
    preview.stroke(s);
    game.stroke(s);
  });
  source.on('force', (samples) => {
    if (!game.run?.engineOff) rotor.addForces(samples); // motorstopp: rotorn saktar in
    game.forceSamples(samples);
  });
  source.on('status', onStatus);
  source.on('raw', (line) => {
    ui.debug(line);
    if (line.startsWith('[error]')) console.error('[SkiErg]', line);
  });
  source.setTrace?.(ui.debugVisible);
  if (kind !== 'mock') {
    try {
      localStorage.setItem(SOURCE_KEY, kind);
    } catch {}
  }
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

/** Deltagarens egen helikopter i fri flygning: räddningshelikoptern efter uppflygningen. */
function ownHelicopter(name) {
  const trimmed = String(name ?? '').trim();
  const profile = trimmed ? savedProgress.profile(trimmed) : null;
  return profile && profile.grade !== 'aspirant' ? getHelicopter('rescue') : null;
}

// ?demo: Mock-källan flyger en demospelare (80 kg) utan erg. Fri flygning följer
// en effektprofil; ?demo=<id> (övning, lektion eller exam) flygs av autopiloten.
const DEMO_PROFILE = [
  [8, 60],
  [40, 280],
  [60, 230],
  [20, 120],
];
async function runDemo() {
  await connect('mock');
  const program = findProgram(new URLSearchParams(location.search).get('demo'));
  game.openSetup(program ? 'career' : 'free');
  ui.setupError(game.submitSetup({ name: 'Demo', mass: 80, age: 30 }));
  if (program) game.choose(program);
  const pilot = autopilot();
  const start = now();
  setInterval(() => {
    if (program) {
      // Utanför flygningen drar demospelaren lugnt, så att menyn och resultatet går vidare.
      const run = game.state === 'FLYING' ? game.run : null;
      source.setPower(run?.step ? pilot({ flight: game.flight, run, step: run.step }) ?? 0 : 60);
      return;
    }
    let t = now() - start;
    let watts = 0;
    for (const [s, w] of DEMO_PROFILE) {
      if (t < s) {
        watts = w;
        break;
      }
      t -= s;
    }
    source.setPower(watts);
  }, 250);
}

// Återuppta senaste källan utan klick där det går (USB som redan är godkänd).
if (new URLSearchParams(location.search).has('demo')) runDemo();
else (async () => {
  let last = null;
  try {
    last = localStorage.getItem(SOURCE_KEY);
  } catch {}
  if (last === 'ble' || (last === 'usb' && UsbPm5Source.supported)) ui.el.sourceSelect.value = last;
  else if (!UsbPm5Source.supported) ui.el.sourceSelect.value = 'ble'; // t.ex. Android och iOS saknar WebHID
  if (last === 'usb' && UsbPm5Source.supported) {
    const s = attach('usb');
    if (!(await s.resume())) s.setStatus('idle');
  }
})();

// --- Spelhändelser ----------------------------------------------------------------

game.on('state', ({ from, to }) => {
  ui.showState(to);
  if (to !== 'IDLE') logView.close();
  if (to === 'IDLE' || to === 'READY' || to === 'FINISHED') ui.clearToasts();
  // Demoturens berg och konfetti ska inte ligga kvar när någon tar över.
  if (to === 'IDLE' || to === 'SETUP' || to === 'COUNTDOWN') renderer.clearMountains();
  if (to === 'COUNTDOWN') hud.reset();
  if (to === 'IDLE') {
    attractStart = now();
    replay = null;
    lastInput = now();
    showBoard();
    startBoardRotation();
    // Efter fri flygning visar startskärmen topplistan, annars menyn.
    ui.setIdleView(from === 'FINISHED' ? 'board' : 'menu');
  } else if (to === 'SETUP') {
    ui.setSetupMode(game.mode);
    updateSetupPreview();
    ui.setConnStatus(source?.status ?? { state: 'idle' }, source?.name);
  } else if (to === 'MENU') {
    ui.clearSetup();
    renderMenu();
  } else if (to === 'READY') {
    ui.clearSetup();
    todayBest = game.exercise ? null : board.todayBest(Date.now(), game.player.klass);
    const best = game.exercise ? progress().profile(game.player.name).best[game.exercise.id] ?? null : null;
    ui.showReady(game.player.name, game.exercise, best);
  }
});

/** Skolan (lektioner och uppflygningen) för deltagaren i dag. */
function career() {
  return careerState(progress().profile(game.player.name), dayOf(Date.now()), cfg);
}

/**
 * Fjällräddaren-menyn med ett förslag som startar med ett drag – man ska inte behöva
 * röra skärmen. Efter uppflygningen flyger deltagaren fri flygning med sin räddningshelikopter.
 */
function renderMenu() {
  const name = game.player.name;
  const profile = progress().profile(name);
  const c = career();
  const junior = profile.grade !== 'aspirant';
  game.setOwnHelicopter(junior ? getHelicopter('rescue') : null);
  parkedLivery = junior ? null : getHelicopter('rescue').livery;
  game.suggest(c.suggestion);
  const days = progress().daysThisWeek(name, Date.now());
  careerMenu.render(
    {
      name,
      title: junior ? `${GRADES[profile.grade]} · Basen` : `${GRADES.aspirant} · Flygskolan`,
      logbook: `Loggbok: ${formatFlightTime(profile.flightS)} flygtid · ${
        days ? `flugit ${days} ${days === 1 ? 'dag' : 'dagar'} den här veckan` : 'ingen flygning än den här veckan'
      }`,
      alarm: junior ? `Första larmet kommer snart: ${FIRST_ALARM}` : null,
      lessons: c.lessons,
      exam: { item: EXAM, state: c.exam === 'tomorrow' ? 'retry' : c.exam },
      exercises: EXERCISES.map((item) => ({ item, stars: profile.best[item.id]?.stars ?? null })),
      suggested: c.suggestion,
      junior,
      colors: renderer.colors,
      school: getHelicopter('school').livery,
      rescue: getHelicopter('rescue').livery,
    },
    (item) => game.choose(item)
  );
}

// Under en övning är det instruktionen som gäller – inga notiser om toppar.
game.on('milestone', (m) => {
  if (!game.run) ui.toast(m.name, [`${fmtM(m.h)} m`, m.area].filter(Boolean).join(' · '), 'Topp passerad');
});

// Händelser i övningen: motorstopp, övertagande, last och avklarade moment.
game.on('drill', (e) => {
  const who = game.run?.program.kind === 'exam' ? 'Examinatorn' : 'Instruktören';
  if (e.type === 'engineCut') ui.toast('Motorstopp!', 'Motorn startar om strax – var beredd', who);
  else if (e.type === 'engineRestart') ui.toast('Motorn går igen', 'Hämta upp!', who);
  else if (e.type === 'takeover') ui.toast(`${who} tar över`, 'Dra för att ta tillbaka kontrollen', who);
  else if (e.type === 'loaded') ui.toast('Sandsäcken är ombord', 'Nu är helikoptern tyngre', who);
  // Sista momentet syns på resultatet i stället.
  else if (e.type === 'moment' && game.run?.program.moments.length > 1 && game.run.status === 'running') {
    const m = e.moment;
    ui.toast(`${m.status === 'passed' ? '✓' : '✗'} ${m.name}`, m.status === 'passed' ? starText(m.stars) : m.failReason, who);
  }
});

/** För in flygningen i profilen och loggboken; returnerar det resultatskärmen visar utöver resultatet. */
function recordFlight(result) {
  const ex = result.exercise;
  const out = progress().record(
    result.name,
    {
      kind: ex?.kind ?? 'free',
      id: ex?.id,
      status: ex?.status,
      flightS: result.duration,
      moments: (ex?.moments ?? []).map((m) => ({ ...m, summary: describeResults(m.results) })),
    },
    Date.now()
  );
  if (!ex || ex.kind === 'exercise') return out;
  const c = career();
  let next = null;
  if (ex.kind === 'lesson' && ex.status === 'passed') {
    const upcoming = c.lessons.find((l) => l.state === 'next' || l.state === 'tomorrow');
    if (upcoming?.state === 'tomorrow') next = `Lektion ${upcoming.lesson.number} väntar i morgon.`;
    else if (!upcoming && c.exam === 'open') next = 'Uppflygningen är öppen när du känner dig redo.';
  }
  if (ex.kind === 'exam' && ex.status === 'failed') {
    next = c.exam === 'tomorrow' ? 'Omprov i morgon. Öva under tiden – lektionerna och övningarna är öppna.' : 'Försök igen när du är redo.';
  }
  const rescue = getHelicopter('rescue');
  const program = ex.kind === 'lesson' ? LESSONS.find((l) => l.id === ex.id) : EXAM;
  return {
    ...out,
    teaser: ex.kind === 'lesson' || ex.status === 'passed' ? program?.teaser : null,
    next,
    heliName: rescue.name,
    livery: rescue.livery,
    date: new Date().toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' }),
  };
}

game.on('finish', (result) => {
  flightLogs.add({
    ts: Date.now(),
    title: game.log.title,
    text: game.log.toText({ date: new Date().toLocaleString('sv-SE'), source: source?.name }),
  });
  replay = result.endH > 0 ? new Replay(landingTrajectory(game.flight), cfg.dt, cfg.replayMaxS) : null;
  const extra = recordFlight(result);
  if (result.exercise) {
    resultScreen.showExercise(result, extra);
    if (extra.promoted) renderer.celebrate();
    return; // övningar hamnar inte på topplistan
  }
  const anonymous = game.player.anonymous;
  const { entry } = board.add(result);
  const classRank = board.classRank(entry);
  todayBest = board.todayBest(Date.now(), result.klass);
  // Visa deltagarens klass när vi kommer tillbaka till startskärmen.
  boardTab = Math.max(0, boardTabs().findIndex((t) => t.klass === result.klass));
  resultScreen.showFlight(result, {
    record: recordKind({
      hMax: entry.hMax,
      classRank,
      todayRank: board.todayRank(entry),
      previousBest: anonymous ? null : board.personalBest(result.name, result.klass, entry),
      anonymous,
    }),
    rank: classRank.rank,
    total: classRank.total,
    peaks: peaksAround(result.hMax, cfg.milestones),
    verdict: heightVerdict(result.hMax, cfg.milestones),
    showRaw: cfg.showRawWatts,
  });
});

// --- Formulär och knappar ---------------------------------------------------------

const MENU_ACTIONS = {
  free: () => game.openSetup('free'),
  career: () => game.openSetup('career'),
  settings: () => openSettings(),
  board: () => {
    showBoard();
    ui.setIdleView('board');
  },
  logs: () => openLogs(),
};
document.getElementById('main-menu').addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action) MENU_ACTIONS[action]();
});
document.getElementById('board-back').addEventListener('click', () => ui.setIdleView('menu'));
document.getElementById('setup-cancel').addEventListener('click', () => game.escape());
document.getElementById('menu-cancel').addEventListener('click', () => game.escape());
ui.el.connect.addEventListener('click', () => connect(ui.el.sourceSelect.value));
ui.el.reconnect.addEventListener('click', () => connect(sourceKind));
ui.el.setupForm.addEventListener('input', updateSetupPreview);
ui.el.setupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = ui.takeSetup();
  if (!connected()) return ui.setupError('Anslut ergen först');
  anonymousProgress = new Progress(null);
  game.setOwnHelicopter(ownHelicopter(data.name));
  ui.setupError(game.submitSetup(data));
});

/** Klassen efter åldern, och lyfteffekten i watt när råa watt är påslaget (spec §6). */
function updateSetupPreview() {
  const age = Number(ui.el.age.value);
  ui.setKlass(ui.el.age.value.trim() && Number.isInteger(age) && age >= MIN_AGE && age <= MAX_AGE ? CLASSES.find((c) => c.name === classForAge(age)) : null);
  const mass = Number(ui.el.mass.value);
  const valid = ui.el.mass.value.trim() && Number.isInteger(mass) && mass >= MIN_MASS && mass <= MAX_MASS;
  ui.setLiftPower(cfg.showRawWatts ? (valid ? `${Math.round(liftPower(cfg, mass))} W` : '– W') : null);
}

// Resultatet: Flyg igen, Till topplistan/menyn, eller ett tryck på skärmen.
document.getElementById('fin-again').addEventListener('click', (e) => {
  e.stopPropagation();
  game.again();
});
document.getElementById('fin-next').addEventListener('click', (e) => {
  e.stopPropagation();
  game.dismissResult(); // fri flygning: startskärmen med topplistan; övning: menyn
});
document.getElementById('screen-finished').addEventListener('click', () => game.dismissResult());

// Pekskärm: tryck på kortet i READY i stället för Enter, Avbryt i stället för Esc.
document.getElementById('ready-card').addEventListener('click', () => game.startCountdown());
document.getElementById('ready-cancel').addEventListener('click', (e) => {
  e.stopPropagation();
  game.escape();
});

// Inställningar
function openSettings() {
  ui.openSettings(cfg);
}

// Flygloggarna: uppspelning, kopiera och klistra in för analys (spec §9.1).
function openLogs() {
  if (game.state !== 'IDLE') return;
  logView.open(flightLogs.logs, logActions);
}
const logActions = {
  async copy(entry, button) {
    try {
      await navigator.clipboard.writeText(entry.text);
      ui.flashButton(button, 'Kopierad ✓');
    } catch {
      logView.showText(entry.text); // urklippet går inte att använda: markera och kopiera själv
    }
  },
  download(entry) {
    const stamp = new Date(entry.ts).toLocaleString('sv-SE').slice(0, 16).replace(' ', '-').replace(':', ''); // 2026-09-30-1842
    download(`flyglogg-${stamp}.txt`, entry.text, 'text/plain');
  },
};
document.getElementById('logs-close').addEventListener('click', () => logView.close());
document.getElementById('logs-clear').addEventListener('click', () => {
  if (!confirm('Rensa alla flygloggar? Det går inte att ångra.')) return;
  flightLogs.clear();
  logView.open(flightLogs.logs, logActions);
});

function applyConfig(next) {
  cfg = sanitize(next);
  saveConfig(cfg);
  game.setConfig(cfg);
  preview.cfg = cfg;
  sound.setEnabled(cfg.sound);
  sound.unlock(); // sparas med klick/tangent, så ljudet får starta direkt
  if (Boolean(renderer.terrain) !== cfg.terrain3d) setTerrain(cfg.terrain3d);
  renderSoundBtn();
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

/** Piltangenterna flyttar mellan knapparna i en lista, Enter väljer (knappen klickas själv). */
function moveFocus(selector, key) {
  const items = [...document.querySelectorAll(selector)].filter((el) => !el.disabled && el.getClientRects().length > 0);
  const i = items.indexOf(document.activeElement);
  const step = key === 'ArrowDown' || key === 'ArrowRight' ? 1 : -1;
  items[i < 0 ? (step > 0 ? 0 : items.length - 1) : (i + step + items.length) % items.length]?.focus();
}

addEventListener('pointerdown', () => {
  sound.unlock();
  lastInput = now();
});
addEventListener('keydown', (e) => {
  sound.unlock();
  lastInput = now();
  if (ui.settingsOpen) return; // dialogen sköter Esc själv
  if (logView.isOpen) return logKeys(e);
  if (e.key === 'Escape') {
    if (game.state === 'IDLE' && ui.idleView === 'board') return ui.setIdleView('menu');
    return game.escape();
  }
  if (e.target.closest?.('input, select, textarea')) return; // skriver i ett fält
  if (e.target.closest?.('button') && (e.key === 'Enter' || e.key === ' ')) return; // knappen klickas själv
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === 's') return openSettings();
  if (key === 'l') return openLogs();
  if (key === 'f') return toggleFullscreen();
  if (key === 'd') {
    const on = ui.toggleDebug();
    source?.setTrace?.(on);
    return;
  }
  if (game.state === 'FINISHED' && !['Shift', 'Control', 'Alt', 'Meta'].includes(key)) return game.dismissResult();
  if (key.startsWith('Arrow') && (game.state === 'MENU' || game.state === 'IDLE')) {
    moveFocus(game.state === 'MENU' ? '#screen-menu .menu-item' : '#screen-idle .btn', key);
    e.preventDefault();
    return;
  }
  if (game.state === 'MENU' && /^[1-4]$/.test(key)) return careerMenu.showStep(Number(key) - 1);
  if (key === 'Enter') {
    if (game.state === 'MENU') return game.choose(game.suggested);
    if (game.state === 'IDLE') game.openSetup('free');
    else if (game.state === 'READY') game.startCountdown();
  }
});

/** Uppspelningen: mellanslag spelar och pausar, pilarna spolar, Esc stänger. */
function logKeys(e) {
  if (e.key === 'Escape') return logView.close();
  if (e.target.closest?.('textarea, button, input')) return;
  if (e.key === ' ') {
    e.preventDefault();
    logView.toggle();
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    logView.seek(logView.t + (e.key === 'ArrowRight' ? 5 : -5));
  }
}

// --- Loop ---------------------------------------------------------------------------

// Spellogiken drivs av en timer så att passet fortsätter även när fönstret är
// skymt (då pausar webbläsaren requestAnimationFrame). tick() är idempotent i tid,
// så den anropas också från renderingen för jämn interpolering.
setInterval(() => game.tick(now()), 50);

// Helikopterns plats i bild och ljuset per skärm: på startskärmen till vänster om menyn
// i kvällssol, vid inmatningen till höger om formuläret, efter flygningen till höger
// om resultatet i kvällssol.
const STAGE = {
  IDLE: { heliX: 0.24, heliY: 0.36, dusk: 1 },
  SETUP: { heliX: 0.68, dusk: 0 },
  MENU: { heliX: 0.5, dusk: 0.6 },
  FINISHED: { heliX: 0.74, dusk: 1 },
};

let last = null;
let lastLive = 0;
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
  const run = game.state === 'FLYING' ? game.run : null;
  const guides = stepGuides(run?.step, f?.t);
  const rings = run?.step?.type === 'rings'; // ringbanan flygs framåt i jämn fart
  const flying = game.state === 'FLYING';
  const power = flying ? game.power : preview.power(now());
  // Under flygningen visar rotorn fysikens varv, annars svarar den på ergen.
  if (flying) rotor.step(dt, f.rotorSpeed, true);
  else rotor.step(dt, power / P0);
  // På startskärmen flyger helikoptern en demotur bakom loggan och menyn.
  const attract = game.state === 'IDLE';
  if (attract) {
    ({ h, vy } = attractFlight(t - attractStart));
    attractRotor.step(dt, ATTRACT_LIFT);
  }
  const shownRotor = attract ? attractRotor : rotor;
  const school = Boolean(game.exercise) && !attract;
  const stage = STAGE[game.state] ?? {};
  const instruments = game.state === 'COUNTDOWN' || flying;
  renderer.advance(dt, shownRotor, h, !school || rings, rings ? RING_SPEED_PX : null);
  renderer.draw({
    h,
    vy,
    rotor: shownRotor,
    hMax: school || attract ? 0 : f?.hMax ?? 0,
    todayBest: attract ? null : todayBest,
    milestones: school ? [] : cfg.milestones,
    avoid: [...(attract ? ui.idleRects() : hud.rects()), screenControls.getBoundingClientRect()],
    flying: game.state === 'FLYING' || attract,
    gauge: instruments,
    heliX: stage.heliX,
    heliY: stage.heliY,
    dusk: stage.dusk,
    guides: guides.lines,
    landingPad: guides.landingPad,
    blind: guides.blind,
    workshop: school,
    // Aspiranten ser räddningshelikoptern som väntar vid verkstan.
    parked: school ? parkedLivery : null,
    buddyLivery: INSTRUCTOR_LIVERY,
    winch: winchInfo(run, f),
    livery: attract ? null : game.helicopter?.livery,
  });
  sound.update(power / P0, rotor.omega);

  if (game.state === 'COUNTDOWN') ui.setCountdown(game.countdownLeft);
  if (instruments) {
    // På marken före lyftet visar effekten P / P0 (spec §8).
    const lift = flying ? f.liftRatio(power) : power / P0;
    const pReq = flying ? f.requiredPower() : P0;
    hud.setAltY(renderer.gaugeY);
    hud.setTitle(...hudTitle(run));
    hud.showVario(!school);
    hud.update({
      h,
      vy,
      time: f?.t ?? 0,
      lift,
      onGround: f?.onGround ?? true,
      side: cfg.showRawWatts
        ? [['Din effekt', `${Math.round(power)} W`], ['Krävd effekt här', `${Math.round(pReq)} W`]]
        : school
          ? null
          : [['Max i passet', `${fmtM(f?.hMax ?? 0)} m`], ['Dagens rekord', todayBest ? `${fmtM(todayBest)} m` : '–']],
      rawLine: cfg.showRawWatts && f ? `P0 ${Math.round(f.P0)} W · rotor ${Math.round(f.rotorSpeed * 100)} % · lyft ${Math.round(f.thrustRatio * 100)} %` : null,
    });
    hud.updateDrill(run?.step ? drillInfo(run, f, h, vy) : null);
  }
  // Dashboarden i en annan flik får höjden och effekten, watt bara med råa watt (spec §6).
  if (live && flying && t - lastLive > 0.25) {
    lastLive = t;
    live.postMessage({
      t: f.t,
      h: f.h,
      hMax: f.hMax,
      lift: f.liftRatio(power),
      watts: cfg.showRawWatts ? { power, pReq: f.requiredPower() } : null,
    });
  }
  requestAnimationFrame(frame);
}

// Pekskärmar saknar tangenter: knappar för ljud och inställningar bredvid helskärm.
const ICONS = {
  soundOn: '<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  soundOff: '<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m16 9 6 6M22 9l-6 6"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
const icon = (d) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
function screenButton(label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'screen-btn';
  btn.setAttribute('aria-label', label);
  btn.addEventListener('click', (e) => {
    onClick();
    e.currentTarget.blur(); // annars tar Enter/mellanslag knappen i stället för spelet
  });
  return btn;
}
const soundBtn = screenButton('Rotorljud', () => applyConfig({ ...cfg, sound: !cfg.sound }));
function renderSoundBtn() {
  soundBtn.innerHTML = icon(cfg.sound ? ICONS.soundOn : ICONS.soundOff);
  soundBtn.title = cfg.sound ? 'Rotorljud: på' : 'Rotorljud: av';
  soundBtn.setAttribute('aria-pressed', String(cfg.sound));
  soundBtn.dataset.state = cfg.sound ? 'on' : 'off';
}
const settingsBtn = screenButton('Inställningar', openSettings);
settingsBtn.innerHTML = icon(ICONS.settings);
settingsBtn.title = 'Inställningar (S)';
renderSoundBtn();

screenControls.append(soundBtn, settingsBtn);
mountScreenControls(screenControls);
ui.showState(game.state);
ui.setIdleView('menu');
showBoard(0);
startBoardRotation();
requestAnimationFrame(frame);

const NOTE_S = 6; // så länge instruktörens kommentar efter ett moment syns
const INTRO_S = 10; // och hälsningen i början av en lektion

/** Rubriken uppe till vänster under en övning, t.ex. "Övning 3 – Hovring". */
function hudTitle(run) {
  if (!run) return [null];
  const moments = run.program.moments.length;
  const kind = run.program.kind;
  if (kind === 'exercise') return [`Övning ${EXERCISES.indexOf(run.exercise) + 1} – ${run.exercise.name}`];
  const head = kind === 'exam' ? 'Uppflygning' : `Lektion ${run.exercise.number}`;
  return [`${head} – ${run.moment.name}`, `Moment ${run.momentIndex + 1} av ${moments}`];
}

/** Övningspanelens innehåll för det aktuella steget. */
function drillInfo(run, f, h, vy) {
  const step = run.step;
  const moments = run.program.moments.length;
  const steps = run.moment.steps.length;
  const who = run.program.kind === 'exam' ? 'Examinatorn' : 'Instruktören';
  const last = run.lastMoment;
  let note = null;
  if (last && f.t - last.endT < NOTE_S) {
    note = last.status === 'passed' ? `✓ ${last.name} ${starText(last.stars)}` : `✗ ${last.name}: ${last.failReason}`;
  } else if (moments > 1 && f.t < INTRO_S) note = `${who}: ${run.exercise.intro}`;
  let done = null; // andel av steget, för stapeln
  if (step.type === 'hover' || step.type === 'winch') done = step.held / step.holdS;
  else if (step.type === 'follow') done = step.elapsed / step.path.at(-1)[0];
  else if (step.type === 'rings') done = step.outcomes.length / step.rings.length;
  else if (step.type === 'freefall' && (step.reps ?? 1) > 1) done = step.catches.length / step.reps;
  return {
    step: steps > 1 ? `Steg ${run.index + 1} av ${steps}` : moments > 1 ? `Moment ${run.momentIndex + 1} av ${moments}` : 'Uppgift',
    text: run.instruction,
    note,
    progress: done === null ? null : Math.min(1, done),
    stars: starGuide(step),
    h,
    vy,
    goal: stepGoal(step),
    sink: step.type === 'land' ? { speed: -f.v, max: step.maxSpeed } : null,
  };
}

/** Målet för steget i siffror, till panelen: höjd, band eller hämtzon. */
function stepGoal(step) {
  const m = (h) => `${fmtM(h)} m`;
  switch (step.type) {
    case 'climb':
      return m(step.to);
    case 'hover':
    case 'winch':
      return `${m(step.at)} ±${step.tol}`;
    case 'freefall':
      return `${fmtM(step.floor)}–${m(step.gate)}`;
    case 'engineout':
      return step.phase === 'hover' ? `${m(step.at)} ±${step.tol}` : `över ${m(step.floor)}`;
    case 'land':
      return 'Plattan';
    default:
      return null;
  }
}

/** Vinschen: linan går ned medan man hovrar, sedan hänger sandsäcken under helikoptern. */
function winchInfo(run, f) {
  if (!run || !f) return null;
  if (run.step?.type === 'winch') return { progress: run.step.held / run.step.holdS, loaded: false };
  return f.load > 0 ? { progress: 1, loaded: true } : null;
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}
