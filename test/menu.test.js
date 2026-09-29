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
  assert.doesNotMatch(storage.getItem('skierg.progress.v1'), /80|kg/);
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

test('förslaget är första ej godkända övningen, sedan fri flygning', async () => {
  const { nextExercise } = await import('../public/game/core/progress.js');
  const { EXERCISES } = await import('../public/game/core/exercise.js');
  assert.equal(nextExercise(EXERCISES, new Set()).id, 'first-lift');
  assert.equal(nextExercise(EXERCISES, new Set(['first-lift', 'altitude'])).id, 'hover');
  assert.equal(nextExercise(EXERCISES, new Set(EXERCISES.map((e) => e.id))), null);
});
