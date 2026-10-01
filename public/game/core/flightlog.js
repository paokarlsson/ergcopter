// Flygloggen (spec §9.1): spelar in en flygning – varje drag med kraftkurvan, hur
// helikoptern svarar och vad instruktören säger – som text att klistra in för analys.
// Ren logik: tiden är flygningens (flight.t), och datum och källa skickas in när
// loggen skrivs ut.
//
// Effekten loggas i % av lyfteffekten P0 utan last, aldrig i watt, så att vikten inte
// går att räkna ut (spec §6). Fysiken räknas relativt P0, så flygningen går ändå att
// spela upp igen (replayLog i sim.js, tools/flightlog.js). P0 i watt tas med bara när
// operatören har slagit på råa watt.

import { starText } from './exercise.js';

export const LOG_TITLE = 'Fjällräddaren flyglogg';
export const LOG_VERSION = 1;
/** Under den här höjden avgörs landningen: där blir spåret tätare. */
export const LOW_M = 25;
const TRACE_EVERY_S = 0.5; // spåret när inget särskilt händer
const TRACE_DENSE_S = 0.1; // nära marken och när farten ändras fort, t.ex. i en hämtning
const DENSE_ACCEL = 2; // m/s²
const HOP_M = 0.1; // samma som physics.js: ett lägre skutt räknas inte som att lyfta
const REVERSAL_MS = 0.5; // farten måste passera ±0,5 m/s för att räknas som en vändning

const PHYSICS_KEYS = ['P_ref', 'm_ref', 'weightMode', 'H_air', 'G', 'g', 'rotorTauS', 'maxSinkRate', 'dt', 'maxStrokeS', 'ceiling'];
const GAME_KEYS = ['countdownS', 'groundEndS', 'idleEndS', 'maxSessionS'];

/** Hur passet slutade (game.js #finish). */
const END_TEXT = {
  landed: 'landade',
  idle: 'inga fler drag',
  time: 'tiden är slut',
  operator: 'avbrutet',
  passed: 'godkänd',
  failed: 'underkänd',
};

const EVENT_TEXT = {
  engineCut: 'motorstopp',
  engineRestart: 'motorn går igen',
  takeover: 'instruktören tar över',
  handback: 'instruktören lämnar tillbaka kontrollen',
  loaded: 'sandsäcken ombord',
};

/** Tal med fast antal decimaler, utan "-0". */
const fix = (x, d) => (Math.abs(x) < 0.5 * 10 ** -d ? 0 : x).toFixed(d);
const dec = (x, d = 1) => fix(x, d).replace('.', ',');
const pct = (x) => `${Math.round(x)} %`;
const m = (h) => `${Math.round(h).toLocaleString('sv-SE')} m`;
const ms = (v) => `${dec(v, 2)} m/s`;
const avg = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;

/** "2:05" för sekunder. */
export function clock(s) {
  const whole = Math.max(0, Math.floor(s));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export class FlightLog {
  /**
   * @param {object} info
   * @param {object} info.cfg           passets konfiguration, med helikopterns parametrar
   * @param {number} info.P0            lyfteffekten utan last (W): enheten för all effekt i loggen
   * @param {{kind, id, name}|null} info.program  övning, lektion eller uppflygning; null = fri flygning
   * @param {string|null} info.helicopter  helikopterns id, null = standard
   * @param {{name, klass}} info.player
   * @param {boolean} info.showRaw      råa watt påslaget: då tas P0 i watt med
   */
  constructor({ cfg, P0, program = null, helicopter = null, player = {}, showRaw = false }) {
    this.cfg = cfg;
    this.P0 = P0;
    this.program = program;
    this.helicopter = helicopter;
    this.player = player;
    this.showRaw = showRaw;
    this.strokes = []; // { nr, t, p, h, v, lift, vs, note, k0, force }
    this.trace = []; // [t, h, v, lyftkraft/tyngd, motoreffekt %]
    this.events = []; // { t, text }
    this.rands = []; // slumpvärden som övningen drog, för uppspelningen
    this.touchdowns = []; // { t, speed }
    this.segments = []; // steg i övningen: { moment, index, t0, text, type, maxSpeed }
    this.pendingForce = []; // kraftsampel (N) för draget som pågår
    this.forceT = null;
    this.lastTraceT = -Infinity;
    this.lastV = 0;
    this.lastTouchdown = null;
    this.airborne = false;
    this.segKey = null;
    this.instructionShape = null;
    this.result = null;
  }

  /** Effekt i % av P0. */
  #pct(watts) {
    return (watts / this.P0) * 100;
  }

  /** Ett slumpvärde som övningen drog (t.ex. när motorn stannar). Returnerar värdet. */
  rand(x) {
    this.rands.push(x);
    return x;
  }

  event(t, text) {
    this.events.push({ t, text });
  }

  /** Kraftsampel (N) från ergen. De hör till nästa drag som kommer. */
  force(t, samples) {
    if (!samples.length) return;
    if (!this.pendingForce.length) this.forceT = t;
    for (const s of samples) this.pendingForce.push(Math.round(s));
  }

  /**
   * Ett drag under flygningen.
   * @param {{t:number, power:number, strokeCount:number}} stroke  t = flygtiden då motorn fick draget
   * @param {import('./physics.js').Flight} f
   * @param {'ok'|'dubblett'|'paus'|'motorstopp'} note  ok = draget driver motorn
   */
  stroke(stroke, f, note) {
    this.strokes.push({
      nr: stroke.strokeCount,
      t: stroke.t,
      p: this.#pct(stroke.power),
      h: f.h,
      v: f.v,
      lift: f.liftRatio(stroke.power) * 100, // effekten mot det som krävs, % (100 = håller höjden)
      vs: f.targetSpeed(stroke.power), // stigfarten draget leder till
      note,
      k0: this.pendingForce.length ? this.forceT - stroke.t : null,
      force: this.pendingForce,
    });
    this.pendingForce = [];
    this.forceT = null;
  }

  /**
   * Efter varje fysiksteg.
   * @param {import('./physics.js').Flight} f
   * @param {object|null} run      ExerciseRun, null i fri flygning
   * @param {object[]} [events]    övningens händelser i steget (run.takeEvents())
   */
  step(f, run = null, events = []) {
    const touched = f.touchdown !== this.lastTouchdown;
    const dense = (f.h > 0 && f.h < LOW_M) || Math.abs(f.v - this.lastV) >= DENSE_ACCEL * this.cfg.dt;
    this.lastV = f.v;
    if (touched || f.t - this.lastTraceT >= (dense ? TRACE_DENSE_S : TRACE_EVERY_S) - 1e-9) {
      this.trace.push([f.t, f.h, f.v, f.thrustRatio, this.#pct(f.power)]);
      this.lastTraceT = f.t;
    }
    if (touched) {
      this.lastTouchdown = f.touchdown;
      this.airborne = false;
      this.touchdowns.push(f.touchdown);
      this.event(f.touchdown.t, `sättning ${ms(f.touchdown.speed)}`);
    } else if (!this.airborne && f.h >= HOP_M) {
      this.airborne = true;
      this.event(f.t, 'lyfter');
    }
    if (!run) return;

    for (const e of events) {
      if (EVENT_TEXT[e.type]) this.event(f.t, EVENT_TEXT[e.type]);
      else if (e.type === 'moment') {
        const mo = e.moment;
        this.event(f.t, `moment klart: ${mo.name} ${mo.status === 'passed' ? `✓ ${starText(mo.stars)}` : `✗ ${mo.failReason}`}`);
      }
    }
    if (run.status !== 'running') return;
    const text = run.instruction;
    const shape = text.replace(/\d[\d\s,.]*/g, '#'); // samma besked med nya siffror loggas inte
    const key = `${run.momentIndex}:${run.index}`;
    if (key !== this.segKey) {
      this.segKey = key;
      const moments = run.program.moments.length;
      const steps = run.moment.steps.length;
      const where = [moments > 1 ? `moment ${run.momentIndex + 1}/${moments} ${run.moment.name}` : null, `steg ${run.index + 1}/${steps}`];
      this.segments.push({
        moment: run.momentIndex,
        index: run.index,
        t0: this.segments.length ? f.t : 0,
        text,
        type: run.step.type,
        maxSpeed: run.step.maxSpeed,
      });
      this.event(f.t, `${where.filter(Boolean).join(' · ')}: ${text}`);
    } else if (shape !== this.instructionShape) {
      this.event(f.t, `besked: ${text}`);
    }
    this.instructionShape = shape;
  }

  /** Ergen tappades eller kom tillbaka: fysiken står still under tiden. */
  pause(t, paused) {
    this.event(t, paused ? 'paus: anslutningen till ergen bröts' : 'fortsätter');
  }

  /** @param {object} result  spelets resultat (game.js #finish) */
  finish(result) {
    this.result = result;
    this.event(result.duration, `slut: ${END_TEXT[result.reason] ?? result.reason}`);
  }

  /** Resultatet i en rad, t.ex. "underkänd – Hård landning: 3,4 m/s (högst 3,0 m/s)". */
  get outcome() {
    const r = this.result;
    if (!r) return 'pågår';
    const ex = r.exercise;
    if (!ex) return `${END_TEXT[r.reason] ?? r.reason} · maxhöjd ${m(r.hMax)}`;
    if (ex.status === 'running') return 'avbruten';
    if (ex.status === 'failed') return `underkänd – ${ex.failReason}`;
    const stars = ex.moments.reduce((a, x) => a + x.stars, 0);
    return ex.kind === 'exercise' ? `godkänd ${starText(ex.moments[0]?.stars ?? 0)}` : `godkänd, ${stars} av ${ex.plan.length * 3} ★`;
  }

  /** Kort rubrik till listan över loggar. */
  get title() {
    const name = this.program?.name ?? 'Fri flygning';
    const time = this.result ? clock(this.result.duration) : '';
    return [name, this.outcome, time, this.player.name].filter(Boolean).join(' · ');
  }

  /**
   * Loggen som text.
   * @param {{ date?: string, source?: string }} [meta]  när och från vilken källa (sätts utanför core/)
   */
  toText({ date = null, source = null } = {}) {
    const lines = [`${LOG_TITLE} v${LOG_VERSION}`];
    const head = (key, value) => {
      if (value !== null && value !== undefined && value !== '') lines.push(`${key}: ${value}`);
    };
    const p = this.program;
    const pairs = (keys) => keys.filter((k) => this.cfg[k] !== undefined).map((k) => `${k}=${this.cfg[k]}`).join(' ');
    head('datum', date);
    head('källa', source);
    head('pilot', [this.player.name, this.player.klass].filter(Boolean).join(' · '));
    head('flygning', p ? `${p.kind} ${p.id} (${p.name})` : 'free (Fri flygning)');
    head('helikopter', this.helicopter ?? 'standard');
    head('fysik', pairs(PHYSICS_KEYS));
    head('spel', pairs(GAME_KEYS));
    head('effekt', 'p och P i % av lyfteffekten P0 utan last; 100 % håller höjden vid marken');
    head('P0', this.showRaw ? `${fix(this.P0, 2)} W` : null);
    head('slump', this.rands.join(' '));
    head('resultat', this.result ? `${this.outcome} · ${clock(this.result.duration)}` : 'pågår');
    head('slut', this.result ? `${fix(this.result.duration, 2)} ${this.result.reason}` : null);

    lines.push('', '## Sammanfattning', ...this.#summary());
    lines.push('', '## Händelser (t = flygtid i s)', ...this.events.map((e) => `${fix(e.t, 2)} ${e.text}`));
    lines.push(
      '',
      '## Drag (t = flygtid då motorn fick draget, p = effekt %, h m, v m/s, lyft = effekt mot det som krävs %,',
      '## vs = stigfarten draget leder till m/s, anm = ok|dubblett|paus|motorstopp,',
      '## k0 = s från första kraftsampel till t, sedan kraftkurvan i N)',
      'nr t p h v lyft vs anm k0 kraft',
      ...this.strokes.map((s) =>
        [s.nr, fix(s.t, 2), fix(s.p, 2), fix(s.h, 2), fix(s.v, 2), fix(s.lift, 0), fix(s.vs, 1), s.note, s.k0 === null ? '-' : fix(s.k0, 2), ...s.force].join(' ')
      )
    );
    lines.push(
      '',
      `## Spår (var ${dec(TRACE_EVERY_S)} s, var ${dec(TRACE_DENSE_S)} s under ${LOW_M} m och när farten ändras fort;`,
      '## T = lyftkraft mot tyngd, 1 håller farten; P = motoreffekt %)',
      't h v T P',
      ...this.trace.map(([t, h, v, T, P]) => [fix(t, 2), fix(h, 2), fix(v, 2), fix(T, 3), fix(P, 1)].join(' '))
    );
    return `${lines.join('\n')}\n`;
  }

  /** Per moment och steg: tid, utfall, dragen, höjden, vändningar och sättningar. */
  #summary() {
    const r = this.result;
    const end = r?.duration ?? this.trace.at(-1)?.[0] ?? 0;
    const ex = r?.exercise;
    const lines = [];
    if (!this.program) {
      lines.push(`Fri flygning: ${this.outcome}${r ? ` efter ${clock(r.tHMax)}` : ''}`);
      lines.push(`  ${this.#stats(0, Infinity, null)}`);
    } else {
      // Det sista steget tar med allt till slutet.
      const segs = this.segments.map((s, i) => ({ ...s, t1: this.segments[i + 1]?.t0 ?? end, until: this.segments[i + 1]?.t0 ?? Infinity }));
      const plan = ex?.plan ?? [{ name: this.program.name }];
      plan.forEach((item, mi) => {
        const mo = ex?.moments[mi];
        const own = segs.filter((s) => s.moment === mi);
        const status = mo
          ? mo.status === 'passed'
            ? `godkänt ${starText(mo.stars)}`
            : `underkänt – ${mo.failReason}`
          : own.length
            ? 'avbrutet'
            : 'inte flugit';
        lines.push(`${item.name}: ${status}`);
        for (const s of own) {
          let out = 'avbrutet';
          if (mo && s.index < mo.results.length) out = 'klart';
          else if (mo?.status === 'failed') out = 'underkänt';
          lines.push(`  ${s.index + 1}. ${s.text} · ${out} på ${dec(s.t1 - s.t0)} s (${clock(s.t0)}–${clock(s.t1)})`);
          lines.push(`     ${this.#stats(s.t0, s.until, s)}`);
        }
      });
    }
    lines.push(...this.#totals(end));
    return lines;
  }

  #stats(t0, t1, seg) {
    const strokes = this.strokes.filter((s) => s.note === 'ok' && s.t >= t0 - 1e-9 && s.t < t1 - 1e-9);
    const trace = this.trace.filter((x) => x[0] >= t0 - 1e-9 && x[0] <= t1 + 1e-9);
    const parts = [];
    if (strokes.length) {
      const p = strokes.map((s) => s.p);
      const jumps = p.slice(1).map((x, i) => Math.abs(x - p[i]));
      parts.push(
        `${strokes.length} drag, snitt ${pct(avg(p))} (${Math.round(Math.min(...p))}–${pct(Math.max(...p))})` +
          (jumps.length ? `, drag till drag ±${pct(avg(jumps))}` : '')
      );
    } else parts.push('inga drag');
    if (trace.length) {
      const hs = trace.map((x) => x[1]);
      parts.push(`höjd ${Math.round(Math.min(...hs)).toLocaleString('sv-SE')}–${m(Math.max(...hs))}`);
      const turns = reversals(trace.map((x) => x[2]));
      if (turns) parts.push(`${turns} ${turns === 1 ? 'vändning' : 'vändningar'}`);
    }
    const tds = this.touchdowns.filter((td) => td.t > t0 + 1e-9 && td.t <= t1 + 1e-9);
    if (tds.length) parts.push(`${tds.length === 1 ? 'sättning' : 'sättningar'} ${tds.map((td) => ms(td.speed)).join(', ')}`);
    if (seg?.type === 'land') {
      // Nära marken: hur många drag som hade gett en mjuk sättning om de fått stå kvar.
      const low = strokes.filter((s) => s.h < LOW_M);
      const soft = low.filter((s) => s.vs < 0 && s.vs >= -seg.maxSpeed - 1e-9).length;
      const up = low.filter((s) => s.vs >= 0).length;
      if (low.length) {
        parts.push(
          `under ${LOW_M} m: ${soft} av ${low.length} drag mot mjuk sjunk (0–${dec(seg.maxSpeed)} m/s), ` +
            `${up} stiger, ${low.length - soft - up} sjunker för fort`
        );
      }
    }
    return parts.join(' · ');
  }

  #totals(end) {
    const ok = this.strokes.filter((s) => s.note === 'ok');
    const lines = [];
    const span = ok.length > 1 ? ok.at(-1).t - ok[0].t : 0;
    const spm = span > 0 ? ((ok.length - 1) / span) * 60 : 0;
    const skipped = ['motorstopp', 'paus', 'dubblett']
      .map((note) => [note, this.strokes.filter((s) => s.note === note).length])
      .filter(([, n]) => n)
      .map(([note, n]) => `${n} ${note}`)
      .join(', ');
    lines.push(
      `Totalt ${clock(end)} · ${ok.length} drag` +
        (spm > 0 ? `, ${Math.round(spm)} drag/min` : '') +
        (ok.length ? `, snitt ${pct(avg(ok.map((s) => s.p)))}` : '') +
        (skipped ? ` · drev inte motorn: ${skipped}` : '')
    );
    const withForce = ok.filter((s) => s.force.length);
    if (withForce.length) {
      lines.push(
        `Kraftkurva: toppkraft i snitt ${Math.round(avg(withForce.map((s) => Math.max(...s.force))))} N, ` +
          `${Math.round(avg(withForce.map((s) => s.force.length)))} sampel per drag, ` +
          `effekten når motorn i snitt ${dec(avg(withForce.map((s) => -s.k0)), 2)} s efter att kraften börjat`
      );
    }
    return lines;
  }
}

/** Antal gånger farten byter riktning, med hysteres så att små svängningar runt 0 inte räknas. */
export function reversals(speeds) {
  let dir = 0;
  let turns = 0;
  for (const v of speeds) {
    const now = v > REVERSAL_MS ? 1 : v < -REVERSAL_MS ? -1 : 0;
    if (!now) continue;
    if (dir && now !== dir) turns++;
    dir = now;
  }
  return turns;
}

const SECTIONS = { sammanfattning: 'summary', händelser: 'events', drag: 'strokes', spår: 'trace' };

/**
 * Läser en flyglogg (FlightLog.toText), t.ex. inklistrad från spelet. Text före och
 * efter loggen hoppas över. Finns flera loggar läses den första.
 */
export function parseLog(text) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const start = lines.findIndex((l) => l.trim().startsWith(LOG_TITLE));
  if (start < 0) throw new Error('Hittar ingen flyglogg i texten');
  const header = {};
  const log = {
    version: Number(lines[start].trim().slice(LOG_TITLE.length).trim().replace(/^v/, '')),
    header,
    summary: [],
    events: [],
    strokes: [],
    trace: [],
  };
  let section = 'header';
  let sectionHead = false;
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (line.startsWith(LOG_TITLE)) break; // nästa logg
    if (line.startsWith('##')) {
      // Rubriken kan fortsätta på flera ##-rader; bara den första byter avsnitt.
      if (!sectionHead) section = SECTIONS[line.replace(/^#+\s*/, '').split(/[\s(]/)[0].toLowerCase()] ?? 'other';
      sectionHead = true;
      continue;
    }
    sectionHead = false;
    if (!line) continue;
    const f = line.split(/\s+/);
    if (section === 'header') {
      const i = line.indexOf(': ');
      if (i > 0) header[line.slice(0, i)] = line.slice(i + 2);
    } else if (section === 'summary') {
      log.summary.push(raw.trimEnd());
    } else if (section === 'events') {
      const t = Number(f[0]);
      if (Number.isFinite(t)) log.events.push({ t, text: line.slice(f[0].length).trim() });
    } else if (section === 'strokes' && /^\d+$/.test(f[0]) && f.length >= 9) {
      const num = (x) => (x === '-' ? null : Number(x));
      log.strokes.push({
        nr: Number(f[0]),
        t: Number(f[1]),
        p: Number(f[2]),
        h: Number(f[3]),
        v: Number(f[4]),
        lift: Number(f[5]),
        vs: Number(f[6]),
        note: f[7],
        k0: num(f[8]),
        force: f.slice(9).map(Number),
      });
    } else if (section === 'trace') {
      const row = f.map(Number);
      if (row.length >= 5 && row.every(Number.isFinite)) log.trace.push(row);
    }
  }

  const pairs = (s = '') =>
    Object.fromEntries(
      s
        .split(/\s+/)
        .filter((x) => x.includes('='))
        .map((x) => {
          const [k, v] = x.split('=');
          return [k, v !== '' && Number.isFinite(Number(v)) ? Number(v) : v];
        })
    );
  const [kind, id] = (header.flygning ?? 'free').split(/\s+/);
  const pilot = header.pilot ?? '';
  const dot = pilot.lastIndexOf(' · ');
  const [endT, reason] = (header.slut ?? '').split(/\s+/);
  Object.assign(log, {
    program: kind === 'free' ? null : { kind, id },
    helicopter: !header.helikopter || header.helikopter === 'standard' ? null : header.helikopter,
    player: dot < 0 ? { name: pilot, klass: '' } : { name: pilot.slice(0, dot), klass: pilot.slice(dot + 3) },
    cfg: pairs(header.fysik),
    game: pairs(header.spel),
    rands: header.slump ? header.slump.split(/\s+/).map(Number) : [],
    end: endT ? { t: Number(endT), reason } : null,
  });
  return log;
}

/**
 * Det som uppspelningen av en logg ritar: spåret, passerade toppar och sättningar.
 * @param {ReturnType<typeof parseLog>} log
 * @returns {{ trace: {t,h,v,P}[], peaks: {t,name,h}[], touchdowns: {t,speed}[], duration: number, hMax: number }}
 */
export function logTimeline(log) {
  const trace = log.trace.map(([t, h, v, , P]) => ({ t, h, v, P }));
  const matches = (re) => log.events.map((e) => ({ t: e.t, m: re.exec(e.text) })).filter((x) => x.m);
  return {
    trace,
    peaks: matches(/^topp passerad: (.+) (\d+) m$/).map(({ t, m }) => ({ t, name: m[1], h: Number(m[2]) })),
    touchdowns: matches(/^sättning ([\d,]+) m\/s$/).map(({ t, m }) => ({ t, speed: Number(m[1].replace(',', '.')) })),
    duration: log.end?.t ?? trace.at(-1)?.t ?? 0,
    hMax: Math.max(0, ...trace.map((p) => p.h)),
  };
}

/** Höjd och fart vid tiden t, linjärt mellan spårets punkter. */
export function traceAt(trace, t) {
  if (!trace.length) return { h: 0, v: 0 };
  if (t <= trace[0].t) return { h: trace[0].h, v: trace[0].v };
  const i = trace.findIndex((p) => p.t >= t);
  if (i < 0) return { h: trace.at(-1).h, v: trace.at(-1).v };
  const a = trace[i - 1];
  const b = trace[i];
  const u = (t - a.t) / Math.max(1e-9, b.t - a.t);
  return { h: a.h + (b.h - a.h) * u, v: a.v + (b.v - a.v) * u };
}

// --- Sparade loggar ---------------------------------------------------------------

const STORAGE_KEY = 'skierg.flightlog.v1';
export const MAX_LOGS = 10;
const MAX_CHARS = 2_500_000; // localStorage rymmer ungefär 5 miljoner tecken per sida

/**
 * De senaste flygloggarna i webbläsaren, nyast först: { id, ts, title, text }.
 * Blir lagringen full tas de äldsta bort.
 */
export class FlightLogStore {
  /** @param {Storage|null} storage  localStorage i webbläsaren, en fejk i tester, null = bara i minnet */
  constructor(storage = safeStorage()) {
    this.storage = storage;
    this.logs = this.#load();
  }

  /**
   * @param {{ ts: number, title: string, text: string }} entry  ts i ms
   * @returns {object} den sparade posten
   */
  add({ ts, title, text }) {
    const entry = { id: `${ts}-${Math.round(Math.random() * 1e6)}`, ts, title, text };
    this.logs.unshift(entry);
    this.logs = this.logs.slice(0, MAX_LOGS);
    while (this.logs.length > 1 && this.logs.reduce((a, x) => a + x.text.length, 0) > MAX_CHARS) this.logs.pop();
    this.#save();
    return entry;
  }

  get(id) {
    return this.logs.find((x) => x.id === id) ?? null;
  }

  clear() {
    this.logs = [];
    this.#save();
  }

  #load() {
    try {
      const data = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? '[]');
      return Array.isArray(data) ? data.filter((x) => x && typeof x.text === 'string' && typeof x.id === 'string') : [];
    } catch {
      return [];
    }
  }

  #save() {
    // Full lagring: släpp de äldsta tills det får plats. Loggarna finns ändå kvar under sessionen.
    for (let keep = this.logs.length; keep >= 0; keep--) {
      try {
        this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.logs.slice(0, keep)));
        return;
      } catch {}
    }
  }
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
