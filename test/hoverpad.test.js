import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hoverHeight, hoverFrame, padProject, padSun, heliSun, PAD_CAM } from '../public/game/view/hoverpad.js';

test('hovringen: helikoptern står på kamerans höjd mitt i bandet och följer avvikelsen', () => {
  assert.equal(hoverHeight(0, 25), PAD_CAM.height);
  assert.ok(hoverHeight(25, 25) > hoverHeight(10, 25));
  assert.ok(hoverHeight(-10, 25) > hoverHeight(-25, 25));
  // Monoton hela vägen, så att helikoptern aldrig hoppar åt fel håll
  let last = -Infinity;
  for (let d = -300; d <= 300; d += 5) {
    const h = hoverHeight(d, 25);
    assert.ok(h >= last, `hoverHeight(${d})`);
    last = h;
  }
});

test('hovringen: långt under bandet sjunker helikoptern aldrig ned i plattan', () => {
  // Mitten sitter 1,55 m över medarna; medarna ska vara ovanför plattan
  assert.ok(hoverHeight(-1000, 25) - 1.55 > 0.5);
  assert.ok(hoverHeight(1000, 25) < PAD_CAM.height + 3);
});

test('hovringen: plattan ligger under horisonten och helikoptern ovanför ringen', () => {
  const f = hoverFrame(1920, 1080);
  const pad = padProject(f, 0, 0, 0);
  assert.ok(pad.y > f.horizon);
  assert.ok(pad.y < 1080);
  assert.equal(Math.round(pad.x), Math.round(f.cx));
  const heli = padProject(f, 0, hoverHeight(0, 25), 0);
  assert.ok(heli.y < pad.y);
  // Längre bort hamnar närmare horisonten
  assert.ok(padProject(f, 0, 0, 10).y < pad.y);
});

test('hovringen: solen står ovanför, och helikopterns sol är spegelvänd i sidled och lite lägre', () => {
  for (const dusk of [0, 1]) {
    const s = padSun(dusk);
    const h = heliSun(dusk);
    assert.ok(Math.abs(Math.hypot(...s) - 1) < 1e-9);
    assert.ok(Math.abs(Math.hypot(...h) - 1) < 1e-9);
    assert.ok(s[1] > 0 && h[1] > 0 && h[1] < s[1]);
    // Samma väderstreck: x spegelvänt, samma riktning framåt
    assert.ok(Math.abs(Math.atan2(-h[0], h[2]) - Math.atan2(s[0], s[2])) < 1e-9);
  }
});
