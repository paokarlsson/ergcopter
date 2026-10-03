import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRescuerFigure } from '../public/game/view/rescuer-figure.js';

test('räddaren strålföljs med fötterna på marken och hjälmen överst', () => {
  const size = 60;
  const fig = renderRescuerFigure(size, 1);
  assert.equal(fig.data.length, fig.width * fig.height * 4);
  let top = fig.height;
  let bottom = -1;
  let opaque = 0;
  for (let y = 0; y < fig.height; y++) {
    for (let x = 0; x < fig.width; x++) {
      if (fig.data[(y * fig.width + x) * 4 + 3] < 128) continue;
      opaque++;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  assert.ok(opaque > size * size * 0.1, 'figuren ska täcka en del av bilden');
  assert.ok(Math.abs(bottom - fig.footY) <= 2, `fötterna ska stå på marken (${bottom} mot ${fig.footY})`);
  assert.ok(Math.abs(fig.footY - top - size) <= 3, 'figuren ska vara ungefär så hög som beställt');
});
