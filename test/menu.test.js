import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../public/game/core/config.js';
import { Game, STROKE_GRACE_S } from '../public/game/core/game.js';
import { getExercise } from '../public/game/core/exercise.js';
import { Progress } from '../public/game/core/progress.js';

/** Deltagare på 80 kg i MENU, med kontrollerad klocka. */
function inMenu() {
  const game = new Game({ ...DEFAULT_CONFIG });
  const finished = [];
  game.on('finish', (r) => finished.push(r));
  let t = 0;
  let count = 0;
  const clock = {
    advance(seconds) {
      for (let i = 0; i < Math.round(seconds / 0.05); i++) game.tick((t += 0.05));
    },
    /** Drag var 1,5 s med effekten som funktion av flygningen. */
    row(powerOf, seconds) {
      for (let s = 0; s < seconds && game.state === 'FLYING'; s += 1.5) {
        game.stroke({ t, power: powerOf(game.flight), strokeCount: ++count });
        clock.advance(1.5);
      }
    },
  };
  game.tick(t);
  game.openSetup();
  assert.equal(game.submitSetup({ name: 'Aspirant', mass: 80, klass: 'Vuxen' }), null);
  assert.equal(game.state, 'MENU');
  return { game, clock, finished };
}

function takeOff(game, clock) {
  game.startCountdown();
  clock.advance(game.cfg.countdownS + 0.05);
  assert.equal(game.state, 'FLYING');
}

test('en övning flygs med skolhelikoptern', () => {
  const { game, clock } = inMenu();
  game.choose(getExercise('hover'));
  assert.equal(game.state, 'READY');
  assert.equal(game.helicopter.id, 'school');
  takeOff(game, clock);
  assert.equal(game.flight.cfg.maxSinkRate, 0);
  assert.equal(game.flight.cfg.ceiling, 1500);
});

test('fri flygning använder standardhelikoptern', () => {
  const { game, clock } = inMenu();
  game.choose(null);
  takeOff(game, clock);
  assert.equal(game.helicopter, null);
  assert.equal(game.flight.cfg.maxSinkRate, 0);
  assert.equal(game.run, null);
});

test('under en övning avslutas passet inte av tid utan drag eller landning', () => {
  const { game, clock } = inMenu();
  game.choose(getExercise('freefall'));
  takeOff(game, clock);
  clock.row((f) => f.P0 * 1.3, 20);
  clock.advance(game.cfg.idleEndS + 5); // fritt fall, inga drag
  assert.equal(game.state, 'FLYING');
});

test('godkänd hovring avslutar passet med resultatet och går tillbaka till menyn', () => {
  const { game, clock, finished } = inMenu();
  game.choose(getExercise('hover'));
  takeOff(game, clock);
  const hold = (f) => f.requiredPower(300) + f.P0 * Math.max(-0.3, Math.min(0.3, (300 - f.h) / 100));
  clock.row(hold, 200);
  assert.equal(game.state, 'FINISHED');
  assert.equal(finished.length, 1);
  assert.equal(finished[0].exercise.id, 'hover');
  assert.equal(finished[0].exercise.status, 'passed');
  game.dismissResult();
  assert.equal(game.state, 'MENU');
  assert.equal(game.player.name, 'Aspirant', 'deltagaren finns kvar');
});

test('resultatet av en övning går till menyn även efter resultDisplayS', () => {
  const { game, clock } = inMenu();
  game.choose(getExercise('hover'));
  takeOff(game, clock);
  game.escape();
  assert.equal(game.state, 'FINISHED');
  assert.equal(game.result.exercise.status, 'running');
  clock.advance(game.cfg.resultDisplayS + 0.1);
  assert.equal(game.state, 'MENU');
});

test('Esc i READY backar till menyn, Esc i menyn till IDLE', () => {
  const { game } = inMenu();
  game.choose(getExercise('hover'));
  game.escape();
  assert.equal(game.state, 'MENU');
  game.escape();
  assert.equal(game.state, 'IDLE');
  assert.equal(game.player, null);
});

function fakeStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
}

test('godkända övningar sparas per namn, oberoende av skiftläge och mellanslag', () => {
  const storage = fakeStorage();
  const p = new Progress(storage);
  p.markPassed('Kim', 'hover');
  p.markPassed('Kim', 'hover');
  assert.deepEqual([...p.passed(' kim ')], ['hover']);
  assert.deepEqual([...new Progress(storage).passed('KIM')], ['hover']);
  assert.equal(new Progress(storage).passed('Alex').size, 0);
  assert.doesNotMatch(storage.getItem('skierg.progress.v2'), /80|kg/);
});

test('trasig lagring ger tom progress', () => {
  const storage = fakeStorage();
  storage.setItem('skierg.progress.v1', '{trasig');
  assert.equal(new Progress(storage).passed('Kim').size, 0);
  assert.equal(new Progress(null).passed('Kim').size, 0);
});

test('ett drag i menyn startar förslaget direkt, men inte under de första sekunderna', () => {
  const { game, clock } = inMenu();
  game.suggest(getExercise('hover'));
  game.stroke({ t: 0, power: 100, strokeCount: 1 });
  assert.equal(game.state, 'MENU', 'för tidigt: man hinner läsa menyn');
  clock.advance(STROKE_GRACE_S + 0.1);
  game.stroke({ t: 0, power: 100, strokeCount: 2 });
  assert.equal(game.state, 'COUNTDOWN');
  assert.equal(game.exercise.id, 'hover');
  assert.equal(game.helicopter.id, 'school');
});

test('utan förslag startar ett drag i menyn fri flygning', () => {
  const { game, clock } = inMenu();
  clock.advance(STROKE_GRACE_S + 0.1);
  game.stroke({ t: 0, power: 100, strokeCount: 1 });
  assert.equal(game.state, 'COUNTDOWN');
  assert.equal(game.exercise, null);
});

test('efter en övning går ett drag tillbaka till menyn, efter en stund', () => {
  const { game, clock } = inMenu();
  game.choose(getExercise('hover'));
  takeOff(game, clock);
  game.escape();
  assert.equal(game.state, 'FINISHED');
  game.stroke({ t: 0, power: 100, strokeCount: 1 });
  assert.equal(game.state, 'FINISHED', 'resultatet hinner synas');
  clock.advance(STROKE_GRACE_S + 0.1);
  game.stroke({ t: 0, power: 100, strokeCount: 2 });
  assert.equal(game.state, 'MENU');
  game.stroke({ t: 0, power: 100, strokeCount: 3 });
  assert.equal(game.state, 'MENU', 'nytt andrum i menyn');
});

test('efter fri flygning gör drag ingenting i resultatet', () => {
  const { game, clock } = inMenu();
  game.choose(null);
  takeOff(game, clock);
  game.escape();
  clock.advance(STROKE_GRACE_S + 0.1);
  game.stroke({ t: 0, power: 100, strokeCount: 1 });
  assert.equal(game.state, 'FINISHED');
});

test('nextExercise: första ej godkända övningen, annars null', async () => {
  const { nextExercise } = await import('../public/game/core/progress.js');
  const { EXERCISES } = await import('../public/game/core/exercise.js');
  assert.equal(nextExercise(EXERCISES, new Set()).id, 'first-lift');
  assert.equal(nextExercise(EXERCISES, new Set(['first-lift', 'altitude'])).id, 'bounce');
  assert.equal(nextExercise(EXERCISES, new Set(EXERCISES.map((e) => e.id))), null);
});

const DAY = 24 * 3600 * 1000;
const MON = new Date(2026, 8, 28, 18).getTime(); // måndag 28 september 2026 kl. 18

/** En avklarad flygning som Progress.record vill ha den. */
function flown(kind, id, moments, status = 'passed', flightS = 600) {
  return { kind, id, status, flightS, moments: moments.map(([mid, stars, score = 0]) => ({ id: mid, name: mid, status: stars ? 'passed' : 'failed', stars, score, summary: '' })) };
}

test('profilen: loggbok, personbästa och lektioner per namn', () => {
  const storage = fakeStorage();
  const p = new Progress(storage);
  let out = p.record('Kim', flown('exercise', 'hover', [['hover', 2, -0.4]]), MON);
  assert.deepEqual(out.bests.map((b) => [b.id, b.stars, b.prev]), [['hover', 2, null]]);
  out = p.record('Kim', flown('exercise', 'hover', [['hover', 2, -0.5]]), MON);
  assert.equal(out.bests.length, 0, 'sämre än förra bästa');
  out = p.record('Kim', flown('exercise', 'hover', [['hover', 2, -0.2]]), MON + DAY);
  assert.equal(out.bests[0].prev.stars, 2, 'samma stjärnor men bättre');
  out = p.record('Kim', flown('lesson', 'lesson-1', [['first-lift', 3], ['bounce', 0], ['hover', 3]]), MON + DAY);
  assert.equal(out.lessonDone, true);
  const prof = new Progress(storage).profile('kim');
  assert.equal(prof.flightS, 2400);
  assert.deepEqual([...prof.passed].sort(), ['first-lift', 'hover']);
  assert.equal(prof.best.hover.stars, 3);
  assert.equal(prof.lessons['lesson-1'], '2026-09-29');
  assert.equal(new Progress(storage).daysThisWeek('Kim', MON + 3 * DAY), 2);
  assert.equal(new Progress(storage).daysThisWeek('Kim', MON + 7 * DAY), 0, 'ny vecka');
});

test('profilen: godkänd uppflygning ger graden junior', () => {
  const p = new Progress(null);
  let out = p.record('Kim', flown('exam', 'exam', [['exam-hover', 2], ['exam-freefall', 0]], 'failed'), MON);
  assert.equal(out.promoted, false);
  assert.deepEqual([p.profile('Kim').grade, p.profile('Kim').exam.lastTry, p.profile('Kim').exam.tries], ['aspirant', '2026-09-28', 1]);
  out = p.record('Kim', flown('exam', 'exam', [['exam-hover', 3]], 'passed'), MON + DAY);
  assert.equal(out.promoted, true);
  assert.equal(p.profile('Kim').grade, 'junior');
  assert.equal(p.record('Kim', flown('exam', 'exam', [], 'passed'), MON + 2 * DAY).promoted, false, 'bara en gång');
});

test('profilen: avbruten uppflygning räknas inte som försök', () => {
  const p = new Progress(null);
  p.record('Kim', flown('exam', 'exam', [], 'running'), MON);
  assert.equal(p.profile('Kim').exam.lastTry, null);
});

test('profilen: den första versionen (bara godkända övningar) läses in', () => {
  const storage = fakeStorage();
  storage.setItem('skierg.progress.v1', JSON.stringify({ kim: ['hover', 'altitude'] }));
  const prof = new Progress(storage).profile('Kim');
  assert.deepEqual([...prof.passed], ['hover', 'altitude']);
  assert.equal(prof.grade, 'aspirant');
});

test('karriären: en ny lektion per dag och ett försök på uppflygningen per dag', async () => {
  const { careerState, LESSONS, EXAM } = await import('../public/game/core/lessons.js');
  const p = new Progress(null);
  const today = '2026-09-28';
  let c = careerState(p.profile('Kim'), today);
  assert.deepEqual(c.lessons.map((l) => l.state), ['next', 'later', 'later', 'later']);
  assert.equal(c.suggestion, LESSONS[0]);
  assert.equal(c.exam, 'open', 'lektionerna är valfria');

  p.record('Kim', flown('lesson', 'lesson-1', [['first-lift', 3]]), MON);
  c = careerState(p.profile('Kim'), today);
  assert.deepEqual(c.lessons.map((l) => l.state), ['done', 'tomorrow', 'later', 'later']);
  assert.equal(c.suggestion.id, 'bounce', 'i väntan på nästa lektion: en övning som inte är godkänd');
  assert.equal(careerState(p.profile('Kim'), today, { lessonPerDay: false }).lessons[1].state, 'next');
  assert.equal(careerState(p.profile('Kim'), '2026-09-29').suggestion, LESSONS[1]);

  p.record('Kim', flown('exam', 'exam', [], 'failed'), MON);
  assert.equal(careerState(p.profile('Kim'), today).exam, 'tomorrow');
  assert.equal(careerState(p.profile('Kim'), '2026-09-29').exam, 'open');

  for (const l of LESSONS) p.record('Kim', flown('lesson', l.id, []), MON - DAY);
  assert.equal(careerState(p.profile('Kim'), '2026-09-29').suggestion, EXAM, 'alla lektioner klara: uppflygningen');

  p.record('Kim', flown('exam', 'exam', [], 'passed'), MON + DAY);
  c = careerState(p.profile('Kim'), '2026-09-30');
  assert.deepEqual([c.exam, c.suggestion], ['passed', null]);
});

test('findProgram hittar övningar, lektioner och uppflygningen', async () => {
  const { findProgram } = await import('../public/game/core/lessons.js');
  assert.equal(findProgram('hover').name, 'Hovring');
  assert.equal(findProgram('lesson-2').number, 2);
  assert.equal(findProgram('exam').kind, 'exam');
  assert.equal(findProgram('nope'), null);
});

test('lektion och uppflygning flygs med skolhelikoptern, fri flygning med den egna', async () => {
  const { LESSONS } = await import('../public/game/core/lessons.js');
  const { getHelicopter } = await import('../public/game/core/helicopters.js');
  const { game } = inMenu();
  game.choose(LESSONS[0]);
  assert.equal(game.helicopter.id, 'school');
  game.escape();
  game.setOwnHelicopter(getHelicopter('rescue'));
  game.choose(null);
  assert.equal(game.helicopter.id, 'rescue');
});

test('motorstopp i spelet: dragen räknas inte och effekten är noll', () => {
  const { game, clock } = inMenu();
  game.rand = () => 0;
  game.choose(getExercise('engine'));
  takeOff(game, clock);
  const hold = (f) => f.requiredPower(400) + f.P0 * Math.max(-0.3, Math.min(0.3, (400 - f.h) / 120));
  const events = [];
  game.on('drill', (e) => events.push(e.type));
  for (let i = 0; i < 400 && !game.run.engineOff && game.state === 'FLYING'; i++) clock.row(hold, 1.5);
  assert.equal(game.run.engineOff, true);
  assert.equal(game.power, 0);
  game.stroke({ t: 0, power: 500, strokeCount: 9999 });
  assert.equal(game.power, 0, 'draget gör ingenting');
  assert.ok(events.includes('engineCut'));
});
