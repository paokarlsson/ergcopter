// Kopplar ihop spelet: datakälla → spel (fysik) → rendering och instrument.

import { loadConfig, saveConfig, resetConfig, sanitize, liftPower, CLASSES } from './core/config.js';
import { Game } from './core/game.js';
import { StrokeSmoother } from './core/signal.js';
import { Leaderboard } from './core/leaderboard.js';
import { Progress, dayOf, formatFlightTime } from './core/progress.js';
import { EXERCISES, stepGuides, starText, describeResults } from './core/exercise.js';
import { LESSONS, EXAM, GRADES, FIRST_ALARM, careerState, findProgram } from './core/lessons.js';
import { getHelicopter, INSTRUCTOR_LIVERY } from './core/helicopters.js';
import { autopilot } from './core/autopilot.js';
import { Rotor } from './view/rotor.js';
import { attractFlight } from './view/attract.js';
import { GameRenderer, fmtM, RING_SPEED_PX } from './view/render.js';
import { GameUI, download } from './view/ui.js';
import { Replay, landingTrajectory } from './core/replay.js';
import { RotorSound } from './view/audio.js';
import { now } from '../shared/sources/source.js';
import { MockSource } from '../shared/sources/mock.js';
import { UsbPm5Source } from '../shared/sources/usb.js';
import { Pm5Source } from '../shared/sources/ble.js';
import { mountScreenControls, toggleFullscreen } from '../shared/screen.js';

const SOURCE_KEY = 'skierg.source';

let cfg = loadConfig();
const board = new Leaderboard();
const savedProgress = new Progress();
let anonymousProgress = new Progress(null); // anonyma: bara under passet, delas inte med nästa
const progress = () => (game.player?.anonymous ? anonymousProgress : savedProgress);
const game = new Game(cfg);
const rotor = new Rotor();
const attractRotor = new Rotor(); // startskärmens demotur har en egen rotor; den riktiga följer ergen
const ATTRACT_LIFT = 1.4; // demoturens rotorvarv, som P_smooth/P0
let attractStart = now();
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
let parkedLivery = null; // räddningshelikoptern som väntar vid verkstan tills uppflygningen är klar
const BOARD_ROTATE_MS = 8000;
let boardTab = 0;
let boardTimer = null;

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

/** Startskärmen bläddrar själv mellan klasserna, så att publiken ser alla. */
function startBoardRotation() {
  clearInterval(boardTimer);
  boardTimer = setInterval(() => showBoard(boardTab + 1), BOARD_ROTATE_MS);
}

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
    preview.push(s);
    game.stroke(s);
  });
  source.on('force', (samples) => {
    if (!game.run?.engineOff) rotor.addForces(samples); // motorstopp: rotorn saktar in
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
  game.openSetup();
  ui.setupError(game.submitSetup({ name: 'Demo', mass: 80, klass: 'Vuxen' }));
  const program = findProgram(new URLSearchParams(location.search).get('demo'));
  game.choose(program);
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

game.on('state', ({ to }) => {
  ui.showState(to);
  if (to === 'IDLE' || to === 'READY') ui.clearToasts();
  // Demoturens berg och konfetti ska inte ligga kvar när någon tar över.
  if (to === 'IDLE' || to === 'SETUP' || to === 'COUNTDOWN') renderer.clearMountains();
  if (to === 'IDLE') {
    attractStart = now();
    replay = null;
    showBoard();
    startBoardRotation();
  } else if (to === 'SETUP') {
    clearInterval(boardTimer);
    ui.setConnStatus(source?.status ?? { state: 'idle' }, source?.name);
  } else if (to === 'MENU') {
    ui.clearSetup();
    renderMenu();
  } else if (to === 'READY') {
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
 * Menyn med ett förslag som startar med ett drag – man ska inte behöva röra skärmen.
 * Efter uppflygningen flyger deltagaren fri flygning med sin räddningshelikopter.
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
  const school = [
    ...c.lessons.map(({ lesson, state }) => ({ item: lesson, title: `Lektion ${lesson.number}`, sub: lesson.goal, state })),
    { item: EXAM, title: 'Uppflygning', sub: 'Krävs för att bli junior', state: c.exam === 'tomorrow' ? 'retry' : c.exam },
  ];
  ui.renderMenu(
    {
      name,
      title: junior ? `${GRADES[profile.grade]} · Basen` : `${GRADES.aspirant} · Flygskolan`,
      logbook: `Loggbok: ${formatFlightTime(profile.flightS)} flygtid · ${
        days ? `flugit ${days} ${days === 1 ? 'dag' : 'dagar'} den här veckan` : 'ingen flygning än den här veckan'
      }`,
      alarm: junior ? `Första larmet kommer snart: ${FIRST_ALARM}` : null,
      school,
      exercises: EXERCISES.map((item) => ({ item, stars: profile.best[item.id]?.stars ?? null })),
      suggested: c.suggestion,
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
  replay = result.endH > 0 ? new Replay(landingTrajectory(game.flight), cfg.dt, cfg.replayMaxS) : null;
  const extra = recordFlight(result);
  if (result.exercise) {
    ui.showFinished(result, 0, 0, extra);
    if (extra.promoted) renderer.celebrate();
    return; // övningar hamnar inte på topplistan
  }
  const { entry } = board.add(result);
  const { rank, total } = board.classRank(entry);
  todayBest = board.todayBest(Date.now(), result.klass);
  // Visa deltagarens klass när vi kommer tillbaka till startskärmen.
  boardTab = Math.max(0, boardTabs().findIndex((t) => t.klass === result.klass));
  ui.showFinished(result, rank, total);
});

// --- Formulär och knappar ---------------------------------------------------------

document.getElementById('start').addEventListener('click', () => game.openSetup());
document.getElementById('setup-cancel').addEventListener('click', () => game.escape());
document.getElementById('menu-cancel').addEventListener('click', () => game.escape());
ui.el.connect.addEventListener('click', () => connect(ui.el.sourceSelect.value));
ui.el.reconnect.addEventListener('click', () => connect(sourceKind));
ui.el.setupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = ui.takeSetup();
  if (!connected()) return ui.setupError('Anslut ergen först');
  anonymousProgress = new Progress(null);
  ui.setupError(game.submitSetup(data));
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
function applyConfig(next) {
  cfg = sanitize(next);
  saveConfig(cfg);
  game.setConfig(cfg);
  preview.cfg = cfg;
  sound.setEnabled(cfg.sound);
  sound.unlock(); // sparas med klick/tangent, så ljudet får starta direkt
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
  if (key === 'f') return toggleFullscreen();
  if (key === 'd') {
    const on = ui.toggleDebug();
    source?.setTrace?.(on);
    return;
  }
  if (game.state === 'FINISHED' && !['Shift', 'Control', 'Alt', 'Meta'].includes(key)) return game.dismissResult();
  if (game.state === 'MENU' && key.startsWith('Arrow')) {
    // Piltangenterna flyttar mellan valen i menyn, Enter väljer.
    const items = [...document.querySelectorAll('#screen-menu .menu-item:not(:disabled)')];
    const i = items.indexOf(document.activeElement);
    const step = key === 'ArrowDown' || key === 'ArrowRight' ? 1 : -1;
    items[i < 0 ? (step > 0 ? 0 : items.length - 1) : (i + step + items.length) % items.length]?.focus();
    e.preventDefault();
    return;
  }
  if (key === 'Enter') {
    if (game.state === 'MENU') return game.choose(game.suggested);
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
  const run = game.state === 'FLYING' ? game.run : null;
  const guides = stepGuides(run?.step, f?.t);
  const rings = run?.step?.type === 'rings'; // ringbanan flygs framåt i jämn fart
  const power = game.state === 'FLYING' ? game.power : preview.value(now());
  rotor.step(dt, power / P0);
  // På startskärmen flyger helikoptern en demotur bakom titeln och topplistan.
  const attract = game.state === 'IDLE';
  if (attract) {
    ({ h, vy } = attractFlight(t - attractStart));
    attractRotor.step(dt, ATTRACT_LIFT);
  }
  const shownRotor = attract ? attractRotor : rotor;
  const school = Boolean(game.exercise) && !attract;
  renderer.advance(dt, shownRotor, h, !school || rings, rings ? RING_SPEED_PX : null);
  renderer.draw({
    h,
    vy,
    rotor: shownRotor,
    hMax: school || attract ? 0 : f?.hMax ?? 0,
    todayBest: attract ? null : todayBest,
    milestones: school ? [] : cfg.milestones,
    avoid: attract ? ui.idleRects() : ui.hudRects(),
    flying: game.state === 'FLYING' || attract,
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
  ui.updateDrill(run?.step ? drillInfo(run, f) : null);
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

const screenControls = document.getElementById('screen-controls');
screenControls.append(soundBtn, settingsBtn);
mountScreenControls(screenControls);
ui.showState(game.state);
showBoard(0);
startBoardRotation();
requestAnimationFrame(frame);

const NOTE_S = 6; // så länge instruktörens kommentar efter ett moment syns
const INTRO_S = 10; // och hälsningen i början av en lektion

/** Övningspanelens innehåll för det aktuella steget. */
function drillInfo(run, f) {
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
    name: moments > 1 ? `${run.exercise.name.replace(/^Lektion (\d+):.*/, 'Lektion $1')} · ${run.moment.name}` : run.moment.name,
    stepLabel: moments > 1 ? `Moment ${run.momentIndex + 1} av ${moments}` : steps > 1 ? `Steg ${run.index + 1} av ${steps}` : '',
    stepText: run.instruction,
    progress: done === null ? null : Math.min(1, done),
    sink: step.type === 'land' ? { speed: -f.v, max: step.maxSpeed } : null,
    note,
  };
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
