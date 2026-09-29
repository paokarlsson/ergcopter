// Små färghjälpare för canvasen. Färgerna kommer från CSS-variabler (#rrggbb eller rgb(r g b)).

/** Blandar två färger: t = 0 ger a, t = 1 ger b. */
export function mix(a, b, t) {
  const pa = parseColor(a);
  const pb = parseColor(b);
  return `rgb(${pa.map((x, i) => Math.round(x + (pb[i] - x) * t)).join(' ')})`;
}

/** Samma färg med genomskinlighet. */
export function alpha(color, a) {
  return `rgb(${parseColor(color).join(' ')} / ${a})`;
}

function parseColor(color) {
  if (color.startsWith('#')) {
    const s = color.slice(1);
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
  }
  return color.match(/[\d.]+/g).slice(0, 3).map(Number);
}
