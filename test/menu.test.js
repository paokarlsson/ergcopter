import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../public/game/config.js';
import { Game } from '../public/game/game.js';
import { getExercise } from '../public/game/exercise.js';
import { Progress } from '../public/game/progress.js';

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
  assert.equal(game.flight.cfg.maxSinkRate, 10);
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
