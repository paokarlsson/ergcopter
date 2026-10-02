// Kortbilderna med 3D (plan.md §3): varje övning och lektion får en egen liten scen med egen
// kamera – en bild av 3D-landskapet (terrain.js), ibland hyllan med plattan (hoverpad.js)
// framför, och den belysta 3D-helikoptern (heli3d.js) i en vinkel som visar uppgiften.
// Inga diagram: hovringen syns som en grön ring på plattan, fallet som fartstreck, lasten
// hänger i en lina. thumbs.js väljer den här vägen när landskapet och helikoptern finns.

import { PAD_CAM, padProject, padSun, heliSun, drawHeliShadow, drawDownwash, drawTargetRing } from './hoverpad.js';

export const W = 320;
export const H = 200;
const PLANE_M = 400; // som i terrain.js
const INSTRUCTOR = { body: '#f4f5f7', accent: '#d3302a', trim: '#ffffff' };
// Solen snett bakom kameran (kamerans x åt vänster, y upp, z framåt): sidan vi ser är belyst
const SUN = [-0.55, 0.62, -0.56];
const DUSK_SUN = [-0.7, 0.28, 0.2]; // låg kvällssol från höger, lite bakifrån: varma kanter

/**
 * Scenerna. cam = landskapets kamera: höjd (m), horisont (y i bild), brännvidd (px), läge i
 * sidled (m) och en topp nära kameran (top: där toppen ska stå i bild, z: avstånd i m).
 * pad = hyllan med plattan: horisont, brännvidd och mitt i sidled. draw ritar resten.
 * Motiven håller sig mellan rubriken uppe till vänster och stjärnorna nere i mitten.
 */
const SHOTS = {
  // Lektion 1: helikoptern står på plattan och väntar, rotorn går långsamt
  'lesson-1': {
    cam: { y: 1250, cy: 58, focal: 620, x: 31000 },
    pad: { horizon: 58, focal: 380, cx: 166 },
    draw(k) {
      k.padBack(1.55, 0.35);
      k.heliOnPad(1.55, { yaw: Math.PI - 0.72, rotor: { angle: 0.5, blur: 0.25 } });
    },
  },
  // Lektion 2: högt över dalen, sedd ovanifrån bakifrån på väg bort mot fjällen
  'lesson-2': {
    cam: { y: 2300, cy: 112, focal: 520, x: 17000, top: [70, 30], z: 5200 },
    draw(k) {
      k.heli({ x: 204, y: 96, px: 9.5, yaw: 0.55, pitch: 0.55, nose: 0.12, roll: -0.08, haze: 0.08 });
    },
  },
  // Lektion 3: fallet sett underifrån, med en brant vägg bakom
  'lesson-3': {
    cam: { y: 420, cy: 182, focal: 300, x: 9000, top: [64, 26], z: 2300 },
    draw(k) {
      k.streaks(210, 50, 44, 0.9);
      k.heli({ x: 206, y: 86, px: 11, yaw: 2.2, pitch: -0.32, nose: 0.3, roll: 0.06 });
    },
  },
  // Lektion 4: lasten i kvällsljus
  'lesson-4': {
    dusk: 1,
    cam: { y: 900, cy: 128, focal: 480, x: 21000, top: [212, 22], z: 4200 },
    draw(k) {
      k.sling(176, 92, 52, 'red');
      k.heli({ x: 176, y: 72, px: 10.5, yaw: 0.75, pitch: 0.18, nose: 0.04 });
    },
  },
  // Första lyftet: precis loss från plattan, dammet virvlar
  'first-lift': {
    cam: { y: 1250, cy: 80, focal: 560, x: 4300 },
    pad: { horizon: 80, focal: 270, cx: 176 },
    draw(k) {
      k.padBack(3.1, 1);
      k.heliOnPad(3.1, { yaw: Math.PI / 2 + 0.5, nose: -0.03 });
      k.padFront(3.1, 1);
    },
  },
  // Studsa: upp och ned över plattan, med ekon av de förra lägena
  bounce: {
    cam: { y: 1250, cy: 76, focal: 600, x: 26500 },
    pad: { horizon: 76, focal: 290, cx: 196 },
    draw(k) {
      k.padBack(3.4, 0.8);
      k.heliOnPad(2.4, { yaw: -Math.PI / 2 - 0.35, alpha: 0.16 });
      k.heliOnPad(3.9, { yaw: -Math.PI / 2 - 0.35, alpha: 0.3 });
      k.heliOnPad(5.5, { yaw: -Math.PI / 2 - 0.35, nose: -0.04 });
      k.padFront(3.4, 0.7);
    },
  },
  // Hovring: rakt framifrån över plattan med den gröna ringen, som i övningen
  hover: {
    cam: { y: 1300, cy: 64, focal: 640, x: 12500 },
    pad: { horizon: 64, focal: 235, cx: 160 },
    draw(k) {
      k.padBack(4.8, 1, true);
      k.heliOnPad(4.8, { yaw: Math.PI + 0.13, discTilt: 0.2 });
      k.padFront(4.8, 1, true);
    },
  },
  // Trappan: lysande steg på väg uppåt, helikoptern på väg mot det översta
  stairs: {
    cam: { y: 760, cy: 128, focal: 460, x: 15800, top: [236, 18], z: 4300 },
    draw(k) {
      k.flatRing(64, 158, 30, 6);
      k.flatRing(140, 128, 25, 5);
      k.flatRing(208, 101, 20, 4);
      k.heli({ x: 250, y: 64, px: 8.5, yaw: 0.95, pitch: 0.22, nose: 0.05, haze: 0.04 });
      k.flatRing(250, 78, 19, 3.8);
    },
  },
  // Höjdflygning: underifrån, upp mot en topp högt över
  altitude: {
    cam: { y: 330, cy: 188, focal: 270, x: 6800, top: [228, 6], z: 2600 },
    draw(k) {
      k.heli({ x: 116, y: 82, px: 10, yaw: 1.9, pitch: -0.28, nose: -0.16, roll: 0.05, haze: 0.06 });
    },
  },
  // Fritt fall: ovanifrån, dalen långt därunder
  freefall: {
    cam: { y: 1750, cy: 16, focal: 280, x: 11200 },
    draw(k) {
      k.streaks(162, 34, 56, 1);
      k.heli({ x: 162, y: 104, px: 10.5, yaw: 2.3, pitch: 0.52, nose: 0.24, roll: -0.05 });
    },
  },
  // Hissen: fall efter fall, i steg nedåt
  elevator: {
    cam: { y: 820, cy: 104, focal: 420, x: 23800, top: [84, 30], z: 4600 },
    draw(k) {
      k.heli({ x: 112, y: 60, px: 9.5, yaw: Math.PI / 2 + 0.2, pitch: 0.1, alpha: 0.18 });
      k.heli({ x: 168, y: 82, px: 9.5, yaw: Math.PI / 2 + 0.2, pitch: 0.1, alpha: 0.36 });
      k.streaks(226, 76, 34, 0.7);
      k.heli({ x: 226, y: 104, px: 9.5, yaw: Math.PI / 2 + 0.2, pitch: 0.1, nose: 0.06 });
    },
  },
  // Sen hämtning: i kvällsljus, tätt över dalbotten, dammet yr
  'late-catch': {
    dusk: 1,
    cam: { y: 240, cy: 64, focal: 300, x: 13700 },
    draw(k) {
      k.dust(170, 168, 70, 0.55);
      k.streaks(170, 46, 50, 0.8);
      k.heli({ x: 168, y: 100, px: 13, yaw: 2.05, pitch: 0.05, nose: -0.2, roll: 0.08 });
    },
  },
  // Sandsäcken: vinschen nere vid plattan, säcken på väg upp
  sandbag: {
    cam: { y: 1300, cy: 118, focal: 560, x: 19600 },
    pad: { horizon: 118, focal: 280, cx: 226 },
    draw(k) {
      k.padBack(8.2, 0.55);
      const p = k.heliOnPad(8.2, { yaw: Math.PI / 2 + 0.28, pitch: 0.02 });
      const bag = padProject(k.f, 0, 1.4, 0);
      k.sling(p.x + 2, p.y + 18, bag.y - p.y - 18, 'sand');
      k.padFront(8.2, 0.4);
    },
  },
  // Motorstopp: rök ur motorn och nosen ned
  engine: {
    cam: { y: 980, cy: 112, focal: 500, x: 28800, top: [66, 34], z: 5000 },
    draw(k) {
      k.smoke(172, 76, 1);
      k.heli({ x: 172, y: 92, px: 12, yaw: -Math.PI / 2 + 0.55, pitch: 0.14, nose: 0.22, roll: -0.12, rotor: { angle: 0.9, blur: 0.45 } });
      k.flash(164, 73);
    },
  },
  // Följ instruktören: instruktörens helikopter nära, skolhelikoptern i nivå bakom
  follow: {
    cam: { y: 880, cy: 116, focal: 500, x: 7600, top: [150, 30], z: 5600 },
    draw(k) {
      k.heli({ x: 88, y: 84, px: 7.5, yaw: Math.PI / 2 + 0.35, pitch: 0.1, haze: 0.12 });
      k.heli({ x: 218, y: 94, px: 12.5, yaw: Math.PI / 2 + 0.42, pitch: 0.1, nose: 0.05, livery: INSTRUCTOR });
    },
  },
  // Molnflygning: in i molnet, helikoptern skymtar genom dimman
  clouds: {
    cam: { y: 760, cy: 110, focal: 460, x: 20400 },
    draw(k) {
      k.cloudBank(0, 132, 1);
      k.heli({ x: 160, y: 92, px: 11, yaw: 2.5, pitch: 0.12, nose: 0.04, haze: 0.18 });
      k.mist(0.28);
      k.cloudBank(1, 176, 0.85);
    },
  },
  // Patrull: i sväng längs en egg
  patrol: {
    cam: { y: 1150, cy: 132, focal: 480, x: 29500, top: [78, 24], z: 3600 },
    draw(k) {
      k.heli({ x: 204, y: 84, px: 10.5, yaw: 1.05, pitch: 0.26, nose: 0.1, roll: 0.38 });
    },
  },
  // Ringbanan: bakifrån, ringarna i rad framför
  rings: {
    cam: { y: 820, cy: 116, focal: 520, x: 10600, top: [262, 20], z: 5400 },
    draw(k) {
      k.hoop(286, 86, 9, 15);
      k.hoop(246, 92, 15, 25);
      k.hoop(186, 100, 25, 41, 'back');
      k.heli({ x: 112, y: 108, px: 10, yaw: 0.42, pitch: 0.22, nose: 0.1, roll: -0.05 });
      k.hoop(186, 100, 25, 41, 'front');
    },
  },
  // Uppflygningen: på plattan i kvällssolen, med medaljen
  exam: {
    dusk: 1,
    cam: { y: 1250, cy: 72, focal: 600, x: 16300 },
    pad: { horizon: 72, focal: 300, cx: 124 },
    draw(k) {
      k.padBack(2.2, 0.5);
      k.heliOnPad(2.2, { yaw: Math.PI / 2 + 0.6, rotor: { angle: 0.6, blur: 0.5 } });
      k.medal(262, 92, 27);
    },
  },
  // Landningen: på väg ned mot plattan, bakifrån
  landing: {
    cam: { y: 1250, cy: 72, focal: 600, x: 8800 },
    pad: { horizon: 72, focal: 250, cx: 168 },
    draw(k) {
      k.padBack(6.4, 0.7, true);
      k.heliOnPad(6.4, { yaw: 0.55, discTilt: 0.08 });
      k.padFront(6.4, 0.6, true);
    },
  },
  // Räddningsuppdraget: vinschen nere mot den skadade på toppen
  mission: {
    dusk: 1,
    cam: { y: 900, cy: 105, focal: 520, x: 14200, top: [236, 122], z: 2800, r: 0.85 },
    draw(k) {
      k.sling(232, 92, 26, 'patient');
      k.heli({ x: 232, y: 72, px: 9.5, yaw: Math.PI / 2 + 0.5, pitch: 0.12 });
    },
  },
  free: {
    cam: { y: 900, cy: 110, focal: 500, x: 18000, top: [96, 26], z: 5000 },
    draw(k) {
      k.heli({ x: 180, y: 96, px: 10, yaw: 2.2, pitch: 0.16, nose: 0.08 });
    },
  },
};

/** Lektionerna och uppflygningens moment har egna scener eller lånar en övnings. */
export function shotOf(id) {
  return SHOTS[id] ?? SHOTS.free;
}

export const hasShot = (id) => id in SHOTS;

/** Landskapets kamera för scenen (terrain.js snapshots). */
export function shotView(id) {
  const s = shotOf(id);
  const c = s.cam;
  const dusk = s.dusk ?? 0;
  const view = {
    width: W,
    height: H,
    scale: 2,
    cx: s.pad?.cx ?? W / 2,
    cy: c.cy,
    focal: c.focal,
    camX: c.x,
    camY: c.y,
    dusk,
    thin: c.y / 9000,
    sun: { x: 0.84, y: 0.16 },
    time: 30,
    pad: null,
    peaks: [],
  };
  if (c.top) {
    // En topp nära kameran, med spetsen där scenen vill ha den i bild
    const [tx, ty] = c.top;
    const h = c.y + ((c.cy - ty) * c.z) / c.focal;
    view.peaks = [{ x: c.x + ((tx - view.cx) * c.z) / c.focal, z: c.z, h, r: (c.r ?? 0.62) * h + 300 }];
  }
  return view;
}

/**
 * Ritar scenen ovanpå landskapsbilden (som redan ligger i ctx).
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} id
 * @param {object} heli3d     Heli3D
 * @param {object|null} hoverPad  HoverPad, eller null (då hoppar plattscenerna över hyllan)
 * @param {object} livery
 * @param {(ctx, ledge: number|null) => void} [grade]  färgsättningen av bakgrunden, när landskapet och
 *   hyllan ligger i bild; ledge = hyllans horisont (y) eller null
 */
export function drawShot(ctx, id, heli3d, hoverPad, livery, grade = null) {
  const s = shotOf(id);
  const k = kit(ctx, s, heli3d, hoverPad, livery);
  if (s.pad && hoverPad && !hoverPad.lost) {
    const img = hoverPad.render({
      width: W,
      height: H - s.pad.horizon,
      cx: s.pad.cx,
      focal: s.pad.focal,
      scale: 2,
      sun: padSun(k.dusk),
      dusk: k.dusk,
    });
    if (img) ctx.drawImage(img, 0, s.pad.horizon, W, H - s.pad.horizon);
    k.hasPad = Boolean(img);
  }
  grade?.(ctx, k.hasPad ? s.pad.horizon : null);
  s.draw(k);
}

let tint = null; // en canvas för att tona helikoptern mot himlens dis
let cloudLayer = null; // molnbanken ritas här och läggs sedan mjukt i bilden

/** Verktygen som scenerna ritar med. */
function kit(ctx, s, heli3d, hoverPad, livery) {
  const dusk = s.dusk ?? 0;
  const f = s.pad ? { cx: s.pad.cx, horizon: s.pad.horizon, focal: s.pad.focal, pxPerM: s.pad.focal / PAD_CAM.dist } : null;
  const haze = dusk ? [222, 160, 132] : [176, 202, 236];
  const k = {
    dusk,
    f,
    hasPad: false,
    /** Helikoptern med mitten på (x, y), px CSS-pixlar per meter. */
    heli(o) {
      const out = heli3d.render({
        pxPerM: o.px,
        dpr: 2,
        yaw: o.yaw,
        pitch: o.pitch ?? 0.15,
        dist: o.dist ?? 26,
        nose: o.nose ?? 0,
        roll: o.roll ?? 0,
        discTilt: o.discTilt ?? 0.06,
        sun: o.sun ?? (dusk ? DUSK_SUN : SUN),
        rotor: o.rotor ?? { angle: 0.6, blur: 0.85 },
        livery: o.livery ?? livery,
        dusk,
        time: 0.05, // blinkljuset tänt
      });
      if (!out) return { x: o.x, y: o.y };
      const a = o.alpha ?? 1;
      const x = o.x + out.x0;
      const y = o.y + out.y0;
      if (o.haze || a < 1) {
        // Luftperspektiv: helikoptern längre bort tar lite av himlens färg, ekon blir genomskinliga
        tint ??= document.createElement('canvas');
        tint.width = out.canvas.width;
        tint.height = out.canvas.height;
        const t = tint.getContext('2d');
        t.drawImage(out.canvas, 0, 0);
        if (o.haze) {
          t.globalCompositeOperation = 'source-atop';
          t.fillStyle = `rgb(${haze.join(' ')} / ${o.haze})`;
          t.fillRect(0, 0, tint.width, tint.height);
          t.globalCompositeOperation = 'source-over';
        }
        ctx.globalAlpha = a;
        ctx.drawImage(tint, x, y, out.w, out.h);
        ctx.globalAlpha = 1;
      } else {
        ctx.drawImage(out.canvas, x, y, out.w, out.h);
      }
      return { x: o.x, y: o.y };
    },
    /** Helikoptern över plattan: mitten hh m över den, sedd från plattans kamera. */
    heliOnPad(hh, o = {}) {
      if (!f) return k.heli({ x: W / 2, y: H / 2, px: 10, yaw: 2.2, ...o });
      const c = padProject(f, 0, hh, 0);
      return k.heli({
        x: c.x,
        y: c.y,
        px: f.pxPerM,
        dist: PAD_CAM.dist,
        pitch: Math.atan2(PAD_CAM.height - hh, PAD_CAM.dist),
        sun: heliSun(dusk),
        ...o,
      });
    },
    /** Skuggan, damm och ringens bakre halva på plattan. */
    padBack(hh, wash, ring = false) {
      if (!k.hasPad) return;
      drawHeliShadow(ctx, f, hh, padSun(dusk), 1);
      if (ring) drawTargetRing(ctx, f, true, 0.4, 1, 'back');
      if (wash) drawDownwash(ctx, f, hh, 0.7, wash, 'back');
    },
    padFront(hh, wash, ring = false) {
      if (!k.hasPad) return;
      if (wash) drawDownwash(ctx, f, hh, 0.7, wash, 'front');
      if (ring) drawTargetRing(ctx, f, true, 0.4, 1, 'front');
    },
    streaks: (x, y, len, a) => streaks(ctx, x, y, len, a),
    /** En vågrät lysande ring i luften: ett trappsteg. */
    flatRing(x, y, rx, ry) {
      // Skenet på luften runt ringen, sedan ringen
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx * 1.25);
      g.addColorStop(0.5, 'rgb(60 255 120 / 0)');
      g.addColorStop(0.8, 'rgb(60 255 120 / 0.2)');
      g.addColorStop(1, 'rgb(60 255 120 / 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rx * 1.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ring(ctx, x, y, rx, ry, 0, Math.PI * 2, 'rgb(60 230 110)', 'rgb(40 255 100 / 0.9)', Math.max(1.6, rx / 12));
    },
    /** En stående ring i banan, sedd snett: halvan bakom helikoptern eller framför. */
    hoop(x, y, rx, ry, part) {
      const [a0, a1] = part === 'back' ? [-Math.PI / 2, Math.PI / 2] : part === 'front' ? [Math.PI / 2, Math.PI * 1.5] : [0, Math.PI * 2];
      ring(ctx, x, y, rx, ry, a0, a1, 'rgb(255 196 64)', 'rgb(255 170 40 / 0.9)', Math.max(1.8, ry / 9));
    },
    /** Lina från helikoptern med last: röd säck, sandsäck eller en skadad på bår. */
    sling(x, y, len, kind) {
      ctx.save();
      ctx.strokeStyle = 'rgb(30 34 40 / 0.9)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + len);
      ctx.stroke();
      const by = y + len;
      if (kind === 'patient') {
        // Räddaren och båren: en orange figur och en ljus bår
        ctx.fillStyle = '#ff7a1a';
        ctx.beginPath();
        ctx.roundRect(x - 2.5, by - 1, 5, 9, 2);
        ctx.fill();
        ctx.fillStyle = '#f2d2b0';
        ctx.beginPath();
        ctx.arc(x, by - 3, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#d7263d';
        ctx.fillRect(x - 9, by + 8, 18, 3);
      } else {
        const sand = kind === 'sand';
        const w = sand ? 15 : 18;
        const h = sand ? 13 : 15;
        const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
        const [lit, mid, dark] = sand ? ['#e2c38a', '#b8955a', '#6e5430'] : ['#ff5a4a', '#cf2630', '#6e0f16'];
        g.addColorStop(0, dark);
        g.addColorStop(0.45, lit);
        g.addColorStop(1, mid);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.roundRect(x - w / 2, by, w, h, 4);
        ctx.fill();
        ctx.strokeStyle = 'rgb(0 0 0 / 0.35)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.fillStyle = sand ? 'rgb(80 60 30 / 0.5)' : 'rgb(255 255 255 / 0.8)';
        ctx.fillRect(x - w / 2, by + h * 0.45, w, 2);
      }
      ctx.restore();
    },
    /** Rök från motorn, bakåt och uppåt i vinden. */
    smoke(x, y, a) {
      for (let i = 9; i >= 0; i--) {
        const t = i / 9;
        const px = x + 14 + t * 120;
        const py = y - 4 - t * 46 - Math.sin(t * 5) * 6;
        const r = 5 + t * 26;
        const g = ctx.createRadialGradient(px, py, 0, px, py, r);
        const al = a * (0.62 - t * 0.5);
        g.addColorStop(0, `rgb(48 50 56 / ${al})`);
        g.addColorStop(0.6, `rgb(70 72 80 / ${al * 0.6})`);
        g.addColorStop(1, 'rgb(90 92 100 / 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    /** Ett orange sken vid motorn. */
    flash(x, y) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, 9);
      g.addColorStop(0, 'rgb(255 220 140 / 0.95)');
      g.addColorStop(0.35, 'rgb(255 120 30 / 0.6)');
      g.addColorStop(1, 'rgb(255 80 0 / 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 9, y - 9, 18, 18);
    },
    /** Damm som yr upp från marken. */
    dust(x, y, r, a) {
      for (let i = 0; i < 7; i++) {
        const dx = (i - 3) * r * 0.32 + Math.sin(i * 7.3) * 6;
        const rr = r * (0.35 + 0.15 * Math.cos(i * 3.1));
        const g = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, rr);
        g.addColorStop(0, `rgb(236 200 160 / ${a * 0.5})`);
        g.addColorStop(1, 'rgb(236 200 160 / 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - rr, y - rr, rr * 2, rr * 2);
      }
    },
    /** En molnbank: många mjuka bollar, ljusa ovanpå och blågrå under, lite suddiga. */
    cloudBank(seed, y, a) {
      cloudLayer ??= document.createElement('canvas');
      cloudLayer.width = W;
      cloudLayer.height = H;
      const c = cloudLayer.getContext('2d');
      c.clearRect(0, 0, W, H);
      const rnd = (i, n) => {
        const v = Math.sin((i + 1) * (n + 1) * 12.9898 + seed * 78.233) * 43758.5453;
        return v - Math.floor(v);
      };
      // Formen: mjuka vita bollar utan kanter, och en fylld botten
      c.fillStyle = '#fff';
      c.fillRect(0, y + 14, W, H - y);
      for (let i = 0; i < 60; i++) {
        const cx = -20 + rnd(i, 1) * (W + 40);
        const r = 10 + rnd(i, 2) ** 2 * 34;
        const cy = y + 14 - rnd(i, 3) * 30 * (1 - r / 60) + r * 0.2;
        const g = c.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
        g.addColorStop(0, 'rgb(255 255 255)');
        g.addColorStop(1, 'rgb(255 255 255 / 0)');
        c.fillStyle = g;
        c.beginPath();
        c.arc(cx, cy, r, 0, Math.PI * 2);
        c.fill();
      }
      // Ljuset: vita toppar i solen, blågrå skugga längre ned
      c.globalCompositeOperation = 'source-atop';
      const shade = c.createLinearGradient(0, y - 30, 0, y + 50);
      shade.addColorStop(0, 'rgb(255 255 255)');
      shade.addColorStop(0.45, 'rgb(226 234 246)');
      shade.addColorStop(1, 'rgb(150 168 198)');
      c.fillStyle = shade;
      c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.globalAlpha = a;
      ctx.filter = 'blur(0.8px)';
      ctx.drawImage(cloudLayer, 0, 0);
      ctx.restore();
    },
    /** Dis över hela bilden, tätast nedtill. */
    mist(a) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, `rgb(220 230 244 / ${a * 0.4})`);
      g.addColorStop(1, `rgb(230 238 248 / ${a})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    },
    /** Guldmedaljen med stjärna och band. */
    medal(x, y, r) {
      ctx.save();
      ctx.fillStyle = '#1f5fbf';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.75, y - r * 2.1);
      ctx.lineTo(x - r * 0.15, y - r * 2.1);
      ctx.lineTo(x + r * 0.1, y - r * 0.6);
      ctx.lineTo(x - r * 0.5, y - r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#c8262f';
      ctx.beginPath();
      ctx.moveTo(x + r * 0.75, y - r * 2.1);
      ctx.lineTo(x + r * 0.15, y - r * 2.1);
      ctx.lineTo(x - r * 0.1, y - r * 0.6);
      ctx.lineTo(x + r * 0.5, y - r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.shadowColor = 'rgb(0 0 0 / 0.5)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 3;
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
      g.addColorStop(0, '#fff3b8');
      g.addColorStop(0.45, '#f6c744');
      g.addColorStop(1, '#a87410');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = '#8a5a08';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.78, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#9a6a0c';
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.25 : r * 0.58;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
  };
  return k;
}

/** En glödande ring (eller en del av den): sken, rör och ljus kärna. */
function ring(ctx, x, y, rx, ry, a0, a1, color, glow, width) {
  ctx.save();
  ctx.lineCap = 'butt';
  const arc = (w) => {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, a0, a1);
    ctx.stroke();
  };
  ctx.shadowColor = glow;
  ctx.shadowBlur = width * 3;
  ctx.strokeStyle = color;
  arc(width);
  ctx.shadowBlur = width;
  ctx.strokeStyle = 'rgb(255 255 240 / 0.95)';
  arc(width * 0.4);
  ctx.restore();
}

/** Fartstreck ovanför helikoptern: den faller. */
function streaks(ctx, x, y, len, a = 1) {
  ctx.save();
  ctx.lineCap = 'round';
  for (const [dx, dy, k] of [[-52, 10, 0.7], [-30, -2, 1], [-8, 6, 0.85], [14, -6, 1], [34, 4, 0.8], [56, 12, 0.6]]) {
    const g = ctx.createLinearGradient(0, y + dy - len * k, 0, y + dy);
    g.addColorStop(0, 'rgb(255 255 255 / 0)');
    g.addColorStop(1, `rgb(255 255 255 / ${0.6 * a})`);
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x + dx, y + dy - len * k);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();
  }
  ctx.restore();
}
