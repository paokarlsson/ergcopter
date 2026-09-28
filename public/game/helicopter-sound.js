/**
 * helicopter-sound.js
 * Syntetiserat helikopterljud med gasreglage. Web Audio API, inga beroenden.
 *
 * Grundanvändning:
 *
 *   import { HelicopterSound } from './helicopter-sound.js';
 *
 *   const heli = new HelicopterSound();
 *
 *   startKnapp.addEventListener('click', async () => {
 *     await heli.start();        // måste ske i en användarhändelse (klick/tryck)
 *     heli.setEngine(true);      // turbinen varvar upp, rotorn börjar snurra
 *   });
 *
 *   gasReglage.addEventListener('input', e => {
 *     heli.setThrottle(e.target.value / 100);   // 0 = tomgång, 1 = hovring, 3 = maxlast
 *   });
 *
 * Gas över 1 är överlast: rotorvarvet ökar bara lite, men bladslag, dunk, luftsus
 * och volym växer så att det låter mer ju hårdare man drar (2 = vanligt, 3 = max).
 *
 *   // Läs av tillståndet, t.ex. för mätare eller animation:
 *   const { rpm, turbine, bladePhase } = heli.state;
 *
 * Alternativ till konstruktorn (alla valfria):
 *   context      Befintlig AudioContext att dela med resten av appen.
 *   destination  AudioNode att koppla ut till (t.ex. appens egen mixer).
 *                Standard är context.destination.
 *   volume       Utvolym 0..1 (standard 0.7).
 *   bladeHz      Bladpassager per sekund vid fullt varv (standard 11, tvåbladig rotor).
 *   tailRatio    Stjärtrotorns fart relativt huvudrotorn (standard 5.2).
 *   maxThrottle  Högsta gas (standard 3). 1 är hovring, allt över är överlast.
 *   autoUpdate   true (standard): modulen uppdaterar sig själv var 20:e ms.
 *                false: anropa heli.update(dt) själv från appens spelloop, dt i sekunder.
 *
 * Tips: pausa ljudet när appen ligger i bakgrunden med heli.context.suspend()
 * och återuppta med heli.context.resume().
 */

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ease = (dt, tau) => 1 - Math.exp(-dt / tau);
const alphaFn = (p, a) => (p / a) * Math.exp(1 - p / a);

// Bygger en periodisk vågform (en puls per period) och returnerar dess medelvärde,
// som läggs på som offset så att gain-kurvan går från ~0 till 1.
function makePulse(ctx, shape, harmonics) {
  const M = 2048, f = new Float32Array(M);
  let mean = 0;
  for (let n = 0; n < M; n++) { f[n] = shape(n / M); mean += f[n]; }
  mean /= M;
  const re = new Float32Array(harmonics + 1), im = new Float32Array(harmonics + 1);
  for (let k = 1; k <= harmonics; k++) {
    let a = 0, b = 0;
    for (let n = 0; n < M; n++) {
      const ph = TAU * k * n / M;
      a += f[n] * Math.cos(ph);
      b += f[n] * Math.sin(ph);
    }
    re[k] = 2 * a / M;
    im[k] = 2 * b / M;
  }
  let wave;
  try { wave = ctx.createPeriodicWave(re, im, { disableNormalization: true }); }
  catch (e) { wave = ctx.createPeriodicWave(re, im); }
  return { wave, mean };
}

// Linjär upp till `knee`, sedan mjukt mot CLIP_CEIL (tanh), så att toppar aldrig klipper.
// WaveShaper tar bara in -1..1, så signalen skalas ner med CLIP_RANGE före kurvan.
const CLIP_RANGE = 4;
const CLIP_CEIL = 0.95; // marginal för översamplingens översläng
function softClipCurve(knee) {
  const M = 8192, c = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    const x = ((i / (M - 1)) * 2 - 1) * CLIP_RANGE;
    const a = Math.abs(x);
    c[i] = Math.sign(x) * (a <= knee ? a : knee + (CLIP_CEIL - knee) * Math.tanh((a - knee) / (CLIP_CEIL - knee)));
  }
  return c;
}

export class HelicopterSound {
  constructor(options = {}) {
    this.opts = {
      volume: 0.7,
      bladeHz: 11,
      tailRatio: 5.2,
      maxThrottle: 3,
      autoUpdate: true,
      ...options,
    };
    this.context = options.context || null;
    this._ownsContext = !options.context;
    this._destination = options.destination || null;

    this.engineOn = false;
    this._throttleTarget = 0;
    this.throttle = 0;   // utjämnad gas 0..maxThrottle, 1 = hovring
    this.load = 0;       // rotorlast, släpar efter gasen
    this.n1 = 0;         // turbinvarv 0..1
    this.rpm = 0;        // rotorvarv 0..1
    this.bladePhase = 0; // 0..1, 0 = bladslag

    this._n = null;
    this._timer = null;
    this._last = 0;
  }

  /** Skapar/återupptar ljudet. Anropa från ett klick eller tryck. */
  async start() {
    if (!this._n) this._build();
    if (this.context.state !== 'running') {
      try { await this.context.resume(); } catch (e) { /* ignoreras */ }
    }
    if (this.opts.autoUpdate && !this._timer) {
      this._last = performance.now();
      this._timer = setInterval(() => {
        const now = performance.now();
        this.update((now - this._last) / 1000);
        this._last = now;
      }, 20);
    }
    return this;
  }

  /** Startar (true) eller stänger av (false) motorn. Rotorn varvar ner långsamt. */
  setEngine(on) { this.engineOn = !!on; }

  /** Gas 0..maxThrottle. 1 = hovring, över 1 = överlast. */
  setThrottle(value) { this._throttleTarget = clamp(Number(value) || 0, 0, this.opts.maxThrottle); }

  /** Utvolym 0..1. */
  setVolume(value) {
    this.opts.volume = clamp(Number(value) || 0, 0, 1);
    if (this._n) this._n.master.gain.setTargetAtTime(this.opts.volume / CLIP_RANGE, this.context.currentTime, 0.05);
  }

  /** Nuvarande tillstånd, t.ex. för mätare eller för att synka grafik med bladslagen. */
  get state() {
    return {
      engineOn: this.engineOn,
      throttle: this.throttle,
      rpm: this.rpm,
      turbine: this.n1,
      load: this.load,
      bladePhase: this.bladePhase,
      rotorRevsPerSecond: (this.opts.bladeHz / 2) * this.rpm,
    };
  }

  /** Stegar fysiken och ljudet framåt dt sekunder. Behövs bara om autoUpdate är false. */
  update(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);

    // Gas, turbin och rotor med tröghet
    this.throttle += (this._throttleTarget - this.throttle) * ease(dt, 0.05);
    const thr = this.engineOn ? this.throttle : 0;
    this.load += (thr - this.load) * ease(dt, 0.35);
    // Upp till hovring styr gasen varvet; överlasten höjer det bara lite.
    const base = Math.min(1, thr), over = Math.max(0, thr - 1);

    const n1T = this.engineOn ? 0.62 + 0.38 * base + 0.05 * over : 0;
    const n1Tau = n1T > this.n1 ? (this.n1 < 0.5 ? 2.4 : 0.9) : (this.engineOn ? 1.4 : 2.2);
    this.n1 += (n1T - this.n1) * ease(dt, n1Tau);
    if (!this.engineOn && this.n1 < 0.001) this.n1 = 0;

    const avail = Math.max(0, (this.n1 - 0.3) / 0.7);
    const rT = this.engineOn ? Math.min(0.36 + 0.64 * base + 0.04 * over, avail) : 0;
    const rTau = rT > this.rpm ? 2.0 : (this.engineOn ? 3.2 : 7.5);
    this.rpm += (rT - this.rpm) * ease(dt, rTau);
    if (!this.engineOn) this.rpm = Math.max(0, this.rpm - dt * 0.012);

    this.bladePhase = (this.bladePhase + this.opts.bladeHz * this.rpm * dt) % 1;

    this._applyAudio();
  }

  /** Stänger av allt och frigör resurser. Instansen kan inte användas efteråt. */
  dispose() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._n) {
      for (const s of this._n.sources) { try { s.stop(); } catch (e) {} }
      try { this._n.limiter.disconnect(); } catch (e) {}
      this._n = null;
    }
    if (this._ownsContext && this.context) {
      try { this.context.close(); } catch (e) {}
    }
    this.context = null;
  }

  // ---------------------------------------------------------------------------

  _build() {
    if (!this.context) {
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('Web Audio API stöds inte i den här miljön.');
      this.context = new AC();
    }
    const ctx = this.context;
    const sources = [];

    const sr = ctx.sampleRate, len = Math.floor(sr * 4);
    const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    const noise = off => {
      const s = ctx.createBufferSource();
      s.buffer = buf; s.loop = true; s.start(0, off);
      sources.push(s);
      return s;
    };
    const gain = v => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const filt = (type, f, q) => {
      const b = ctx.createBiquadFilter();
      b.type = type; b.frequency.value = f; b.Q.value = q;
      return b;
    };
    const chain = (...nodes) => { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); };

    // Summering -> ton -> kompressor -> överlast -> utvolym -> mjukbegränsare -> destination.
    // Överlastvolymen ligger efter kompressorn, annars trycks ökningen bort;
    // begränsaren rundar av bladslagens toppar vid hög överlast i stället för att klippa.
    const mix = gain(1);
    const tone = filt('lowpass', 9000, 0.7);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 5;
    comp.attack.value = 0.004; comp.release.value = 0.18;
    const drive = gain(DRIVE_HOVER);
    const master = gain(this.opts.volume / CLIP_RANGE);
    const limiter = ctx.createWaveShaper();
    limiter.curve = softClipCurve(0.6);
    limiter.oversample = '4x';
    chain(mix, tone, comp, drive, master, limiter);
    limiter.connect(this._destination || ctx.destination);

    const slapW = makePulse(ctx, p => Math.pow(alphaFn(p, 0.05), 1.5), 64);
    const crackW = makePulse(ctx, p => Math.pow(alphaFn(p, 0.03), 2.2), 96);
    const tailW = makePulse(ctx, p => Math.exp(-Math.pow((p - 0.5) / 0.13, 2)), 24);

    const osc = w => {
      const o = ctx.createOscillator();
      o.setPeriodicWave(w.wave); o.frequency.value = 0.01;
      sources.push(o);
      return o;
    };
    const slapOsc = osc(slapW), crackOsc = osc(crackW), tailOsc = osc(tailW);

    // Rotorbladens "wop": brus som pulsas i takt med bladen
    const slapLP = filt('lowpass', 500, 0.9), slapVCA = gain(slapW.mean), slapLvl = gain(0);
    chain(noise(0), slapLP, slapVCA, slapLvl, mix);
    slapOsc.connect(slapVCA.gain);

    // Djup dunk under varje bladpassage
    const thumpLP = filt('lowpass', 150, 0.8), thumpLvl = gain(0);
    chain(slapOsc, thumpLP, thumpLvl, mix);

    // Skarpt bladslag vid hög last
    const crackHP = filt('highpass', 1400, 0.7), crackVCA = gain(crackW.mean), crackLvl = gain(0);
    chain(noise(1.3), crackHP, crackVCA, crackLvl, mix);
    crackOsc.connect(crackVCA.gain);

    // Stjärtrotorns surr
    const tailBP = filt('bandpass', 1200, 1.4), tailVCA = gain(tailW.mean), tailLvl = gain(0);
    chain(noise(2.1), tailBP, tailVCA, tailLvl, mix);
    tailOsc.connect(tailVCA.gain);

    // Luftsus, motormuller, turbinväs
    const washLP = filt('lowpass', 900, 0.5), washLvl = gain(0);
    chain(noise(2.9), washLP, washLvl, mix);
    const rumLP = filt('lowpass', 110, 0.9), rumLvl = gain(0);
    chain(noise(3.4), rumLP, rumLvl, mix);
    const hissBP = filt('bandpass', 3000, 0.9), hissLvl = gain(0);
    chain(noise(0.7), hissBP, hissLvl, mix);

    // Turbinens tjut
    const w1 = ctx.createOscillator(); w1.type = 'sine'; w1.frequency.value = 1500;
    const w2 = ctx.createOscillator(); w2.type = 'triangle'; w2.frequency.value = 750;
    sources.push(w1, w2);
    const w2g = gain(0.45), whineLvl = gain(0);
    w1.connect(whineLvl); chain(w2, w2g, whineLvl); whineLvl.connect(mix);

    // Pulsoscillatorerna startas samtidigt så att de håller fas
    const t0 = ctx.currentTime + 0.03;
    [slapOsc, crackOsc, tailOsc, w1, w2].forEach(o => o.start(t0));

    this._n = {
      master, drive, limiter, sources, slapOsc, crackOsc, tailOsc, slapLP, slapLvl, thumpLvl, crackLvl,
      tailBP, tailLvl, washLvl, rumLvl, hissBP, hissLvl, w1, w2, whineLvl,
    };
  }

  _applyAudio() {
    const N = this._n, ctx = this.context;
    if (!N || !ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime, k = 0.04;
    const set = (param, v) => param.setTargetAtTime(v, t, k);

    const r = this.rpm, n1 = this.n1, load = this.load;
    // lb: last upp till hovring, over: överlast (0 vid hovring, 2 vid 300 %)
    const lb = Math.min(1, load), over = Math.max(0, load - 1);
    const bh = Math.max(0.01, this.opts.bladeHz * r);
    const ld = 0.4 + 0.6 * lb;
    const jitter = 1 + (Math.random() - 0.5) * (0.08 + 0.05 * over);

    set(N.slapOsc.frequency, bh);
    set(N.crackOsc.frequency, bh);
    set(N.tailOsc.frequency, bh * this.opts.tailRatio);

    set(N.slapLvl.gain, 1.9 * Math.pow(r, 1.1) * ld * (1 + 0.3 * over) * jitter);
    set(N.slapLP.frequency, 500 + 1200 * r * ld + 700 * over);
    set(N.thumpLvl.gain, 0.6 * Math.pow(r, 1.3) * ld * (1 + 0.45 * over));
    set(N.crackLvl.gain, 0.45 * r * r * r * (lb * lb + 0.9 * over));
    set(N.tailLvl.gain, 0.55 * r * r * (1 + 0.15 * over));
    set(N.tailBP.frequency, 700 + 1100 * r);
    set(N.washLvl.gain, 0.55 * r * r * (1 + 0.6 * over));

    set(N.rumLvl.gain, 1.6 * n1 * (1 + 0.2 * over));
    set(N.hissLvl.gain, 0.09 * n1 * n1 * (1 + 0.5 * over));
    set(N.hissBP.frequency, 1500 + 3000 * n1);
    const wf = 1500 + 3900 * n1;
    set(N.w1.frequency, wf);
    set(N.w2.frequency, wf * 0.5);
    set(N.whineLvl.gain, 0.022 * Math.min(1, n1 * 1.8) * (1 + 0.3 * over));

    set(N.drive.gain, driveGain(over));
  }
}

// Volym efter kompressorn: 1 upp till hovring, sedan stigande med avtagande takt
// så att 200 % hörs tydligt och 300 % ännu mer utan att klippa.
const DRIVE_HOVER = 1;
const DRIVE_MAX = 1.9;
export function driveGain(over) {
  return DRIVE_HOVER + (DRIVE_MAX - DRIVE_HOVER) * (1 - Math.exp(-0.6 * Math.max(0, over))) / (1 - Math.exp(-1.2));
}

export default HelicopterSound;
