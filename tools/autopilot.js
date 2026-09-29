// En enkel pilot för headless-körning av övningar (tester och tools/exercises.js).
// Den styr med effekten per drag, precis som en spelare, och ser samma
// fördröjning från medelvärdet över dragen.

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Sträckan helikoptern fortsätter nedåt innan trögheten har bromsat farten (spec §5).
const brakeM = (f) => Math.max(0, -f.v) * (f.cfg.inertiaS ?? 0);

/**
 * @param {{ catchLeadM?: number, landSpeed?: number }} [opts]
 *   catchLeadM: hur långt ovanför målet piloten börjar veva igen i fritt fall,
 *               utöver bromssträckan som trögheten ger (ungefär fart · inertiaS)
 *   landSpeed:  sjunkhastighet (m/s) piloten siktar på vid sättningen
 */
export function autopilot({ catchLeadM = 20, landSpeed = 0.8 } = {}) {
  return ({ flight: f, step }) => {
    const req = (h) => f.requiredPower(h);
    const hold = (target) => req(target) + f.P0 * clamp((target - f.h) / 100, -0.3, 0.3);
    switch (step.type) {
      case 'climb':
        return req(step.to + 150);
      case 'hover':
        return hold(step.at);
      case 'land': {
        const v = -clamp(f.h / 15, landSpeed, 6);
        return req() + (v * f.P0) / f.cfg.G;
      }
      case 'freefall':
        if (step.phase === 'armed') return f.h < step.from - step.tol ? req(step.from + 100) : null;
        return f.h <= step.to + catchLeadM + brakeM(f) ? hold(step.to) : null;
    }
    return null;
  };
}
