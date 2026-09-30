// En enkel pilot för övningarna: headless (tester och tools/exercises.js) och ?demo=<id>.
// Den styr med effekten per drag, precis som en spelare, genom samma motor och rotor.

import { pathHeight } from './exercise.js';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * @param {{ landSpeed?: number }} [opts]
 *   landSpeed:  sjunkhastighet (m/s) piloten siktar på vid sättningen
 */
export function autopilot({ landSpeed = 0.8 } = {}) {
  return ({ flight: f, step }) => {
    const req = (h) => f.requiredPower(h);
    // Håll en höjd: behovet där plus en rättelse mot målet (max ±share · P0).
    const hold = (target, share = 0.3, span = 100) => req(target) + f.P0 * clamp((target - f.h) / span, -share, share);
    // Hämta upp: bromsa hårt, sedan hovra där man är.
    const recover = () => (f.v < -3 ? req() + 1.2 * f.P0 : hold(f.h));
    switch (step.type) {
      case 'climb':
        return req(step.to + 150);
      case 'hover':
      case 'winch':
        return hold(step.at, 0.3, step.tol * 4);
      case 'land': {
        const v = -clamp(f.h / 15, landSpeed, 6);
        return req() + (v * f.P0) / f.cfg.G;
      }
      case 'freefall':
        if (step.phase === 'takeover') return hold(f.h);
        if (step.phase === 'armed') return f.h < step.from ? req(step.from + 100) : null;
        return f.h <= step.gate ? recover() : null;
      case 'engineout':
        if (step.phase === 'restart' || step.phase === 'takeover') return recover();
        return hold(step.at, 0.3, step.tol * 4);
      case 'follow': {
        const ahead = pathHeight(step.path, f.t - step.t0 + 3);
        return hold(ahead, 0.8, 60);
      }
      case 'rings': {
        const next = step.rings[step.outcomes.length] ?? step.rings.at(-1);
        return hold(next.h, 0.8, 60);
      }
    }
    return null;
  };
}
