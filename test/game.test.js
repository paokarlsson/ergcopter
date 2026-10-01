import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../public/game/core/config.js';
import { Game, ANONYMOUS_NAME } from '../public/game/core/game.js';

const cfg = { ...DEFAULT_CONFIG };

/** Spelare på 80 kg (P0 = 100 W) i FLYING, med kontrollerad klocka. */
function flying(overrides = {}) {
  const game = new Game({ ...cfg, ...overrides });
  const events = { state: [], milestone: [], finish: [] };
  for (const k of Object.keys(events)) game.on(k, (e) => events[k].push(e));
  let t = 0;
  let count = 0;
  const clock = {
    advance(seconds) {
      for (let i = 0; i < Math.round(seconds / 0.05); i++) game.tick((t += 0.05));
    },
    stroke(power) {
      game.stroke({ t, power, strokeCount: ++count });
    },
    /** Drag var 1,5 s med given effekt i `seconds` sekunder. */
    row(power, seconds) {
      for (let s = 0; s < seconds; s += 1.5) {
        clock.stroke(power);
        clock.advance(1.5);
      }
    },
  };
  game.tick(t);
  game.openSetup();
  assert.equal(game.submitSetup({ name: 'Testa', mass: 80, klass: 'Vuxen' }), null);
  game.choose(null); // fri flygning
  game.startCountdown();
  clock.advance(game.cfg.countdownS + 0.05);
  assert.equal(game.state, 'FLYING');
  return { game, clock, events };
}

test('flödet IDLE → SETUP → MENU → READY → COUNTDOWN → FLYING', () => {
  const game = new Game(cfg);
  const seen = [];
  game.on('state', ({ to }) => seen.push(to));
  game.openSetup();
  assert.match(game.submitSetup({ name: 'A', mass: 14, klass: 'Barn' }), /15–200/);
  assert.match(game.submitSetup({ name: 'A', mass: 80.5, klass: 'Vuxen' }), /heltal/);
  assert.match(game.submitSetup({ name: 'A', mass: 80, klass: '' }), /klass/);
  assert.match(game.submitSetup({ name: 'A', mass: 80, klass: 'Senior' }), /klass/);
  assert.equal(game.submitSetup({ name: 'A', mass: 80, klass: 'Vuxen' }), null);
  game.stroke({ t: 0, power: 200, strokeCount: 0 }); // drag i menyn startar inget
  assert.equal(game.state, 'MENU');
  game.choose(null);
  game.stroke({ t: 0, power: 200, strokeCount: 1 }); // första draget startar nedräkningen
  for (let t = 0; t <= 3.1; t += 0.05) game.tick(t);
  assert.deepEqual(seen, ['SETUP', 'MENU', 'READY', 'COUNTDOWN', 'FLYING']);
});

test('drag under nedräkningen ignoreras och fysiken nollställs', () => {
  const game = new Game(cfg);
  game.openSetup();
  game.submitSetup({ name: 'A', mass: 80, klass: 'Vuxen' });
  game.choose(null);
  game.tick(0);
  game.startCountdown();
  game.stroke({ t: 0.1, power: 500, strokeCount: 1 });
  for (let t = 0; t <= 3.1; t += 0.05) game.tick(t);
  assert.equal(game.state, 'FLYING');
  assert.equal(game.flight.h, 0);
  assert.equal(game.power, 0);
});

test('slut 1: har flugit och står sedan på marken med P < P0 i 5 s', () => {
  const { game, clock, events } = flying();
  clock.row(250, 30);
  assert.ok(game.flight.h > 0);
  clock.row(20, 400); // för lite för att hålla höjden, men drag hela tiden
  assert.equal(events.finish.length, 1);
  assert.equal(events.finish[0].reason, 'landed');
  assert.ok(events.finish[0].hMax > 0);
});

test('slut 2: inga drag på 10 s', () => {
  const { game, clock, events } = flying();
  clock.advance(9.9);
  assert.equal(game.state, 'FLYING');
  clock.advance(0.2);
  assert.equal(events.finish[0]?.reason, 'idle');
});

test('slut 3: max passlängd', () => {
  const { clock, events } = flying({ maxSessionS: 30 });
  clock.row(150, 45);
  assert.equal(events.finish[0]?.reason, 'time');
  assert.ok(Math.abs(events.finish[0].duration - 30) < 0.06);
});

test('slut 4: Esc under flygning sparar resultatet', () => {
  const { game, clock, events } = flying();
  clock.row(300, 15);
  game.escape();
  assert.equal(events.finish[0]?.reason, 'operator');
  assert.ok(events.finish[0].endH > 0);
});

test('står kvar på marken utan att passet tar slut innan man flugit', () => {
  const { game, clock } = flying();
  clock.row(50, 60); // under P0 (60 W vid 80 kg) men drar hela tiden
  assert.equal(game.state, 'FLYING');
  assert.equal(game.flight.hMax, 0);
});

test('milstolpar skickas en gång när de passeras', () => {
  const { clock, events } = flying({ milestones: [{ name: 'Låg', h: 50 }, { name: 'Hög', h: 100000 }] });
  clock.row(300, 30);
  assert.deepEqual(events.milestone.map((m) => m.name), ['Låg']);
});

test('paus stoppar klockan och fysiken', () => {
  const { game, clock } = flying();
  clock.row(300, 6);
  const h = game.flight.h;
  const t = game.flight.t;
  game.setPaused(true);
  clock.advance(20);
  assert.equal(game.flight.h, h);
  assert.equal(game.flight.t, t);
  assert.equal(game.state, 'FLYING');
});

test('resultatet visas resultDisplayS och går sedan till IDLE', () => {
  const { game, clock } = flying();
  game.escape();
  assert.equal(game.state, 'FINISHED');
  clock.advance(14.9);
  assert.equal(game.state, 'FINISHED');
  clock.advance(0.2);
  assert.equal(game.state, 'IDLE');
});

test('ett långt glapp (datorn sov) räknas som högst 2 s', () => {
  const { game, clock } = flying();
  clock.stroke(300);
  const t = game.flight.t;
  game.tick(game.lastT + 30);
  assert.ok(game.flight.t - t <= 2 + 1e-9);
});

test('namnet är valfritt: tomt namn blir Anonym', () => {
  const game = new Game(cfg);
  game.openSetup();
  assert.equal(game.submitSetup({ name: '  ', mass: 80, klass: 'Vuxen' }), null);
  assert.equal(game.state, 'MENU');
  assert.equal(game.player.name, ANONYMOUS_NAME);
  assert.equal(game.player.anonymous, true);
});

test('åldern ger klassen och sparas inte', () => {
  const setup = (age) => {
    const game = new Game(cfg);
    game.openSetup();
    return { game, error: game.submitSetup({ name: 'A', mass: 40, age }) };
  };
  assert.equal(setup(12).game.player.klass, 'Barn');
  assert.equal(setup('13').game.player.klass, 'Ungdom');
  assert.equal(setup(17).game.player.klass, 'Ungdom');
  assert.equal(setup(18).game.player.klass, 'Vuxen');
  assert.equal('age' in setup(40).game.player, false);
  assert.match(setup('').error, /Åldern/);
  assert.match(setup(12.5).error, /heltal/);
  assert.match(setup(0).error, /1–120/);
});

test('så högt som möjligt går från inmatningen direkt till READY med egen helikopter', () => {
  const game = new Game(cfg);
  const seen = [];
  game.on('state', ({ to }) => seen.push(to));
  const own = { id: 'rescue', ceiling: 0 };
  game.setOwnHelicopter(own);
  game.openSetup('free');
  assert.equal(game.submitSetup({ name: 'A', mass: 80, age: 30 }), null);
  assert.deepEqual(seen, ['SETUP', 'READY']);
  assert.equal(game.exercise, null);
  assert.equal(game.helicopter, own);
  game.escape(); // ingen meny i det här läget: tillbaka till startskärmen
  assert.equal(game.state, 'IDLE');
});

test('flyg igen: samma deltagare tillbaka till READY, och resultatet har dragen', () => {
  const { game, clock } = flying();
  clock.row(150, 30);
  game.escape();
  assert.equal(game.state, 'FINISHED');
  const stats = game.result.stats;
  assert.equal(stats.strokes, 20);
  assert.equal(Math.round(stats.avgPct), 250); // 150 W av P0 = 60 W
  assert.equal(Math.round(stats.maxPct), 250);
  assert.equal(stats.P0, 60);
  game.again();
  assert.equal(game.state, 'READY');
  assert.equal(game.player.name, 'Testa');
  assert.equal(game.result, null);
});
