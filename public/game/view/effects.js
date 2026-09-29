// Fartkänsla och belöningar: fartstreck i luften när man stiger eller faller,
// damm som rotorn blåser upp nära marken och konfetti när man passerar en topp.
// Partiklarna lever i världen (x följer landskapet, höjd i meter) så att de
// stannar kvar vid toppen i stället för att följa med kameran.

const STREAKS = 26;
const MAX_PARTICLES = 400;
const GRAVITY_M = 18; // m/s², partiklarna faller lite fortare än på riktigt – det ser bättre ut

export class Effects {
  constructor() {
    this.streaks = Array.from({ length: STREAKS }, () => ({ x: Math.random(), y: Math.random(), z: 0.4 + Math.random() }));
    this.particles = [];
  }

  clear() {
    this.particles = [];
  }

  /**
   * @param {number} dt
   * @param {number} speed  px/s som landskapet rullar
   */
  update(dt, speed) {
    for (const p of this.particles) {
      p.x += (p.vx - speed) * dt;
      p.alt += p.va * dt;
      p.va -= GRAVITY_M * p.fall * dt;
      p.vx *= 1 - Math.min(1, p.drag * dt);
      p.spin += p.vspin * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  /**
   * Fartstreck. De glider mot helikopterns rörelse: bakåt när vi flyger framåt
   * och nedåt när vi stiger. Syns bara när det går fort upp eller ned.
   * @param {number} vyPx  stighastighet i px/s
   */
  drawStreaks(ctx, W, H, dt, speed, vyPx, intensity, color) {
    if (intensity <= 0.01) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    for (const s of this.streaks) {
      const vx = -speed * 1.6 * s.z;
      const vy = vyPx * 1.4 * s.z;
      s.x = wrap(s.x + (vx * dt) / W);
      s.y = wrap(s.y + (vy * dt) / H);
      const x = s.x * W;
      const y = s.y * H;
      const len = 0.05 * s.z;
      ctx.globalAlpha = intensity * 0.3 * Math.min(1, s.z);
      ctx.lineWidth = 0.8 + 1.2 * s.z;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - vx * len, y - vy * len);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Konfetti och snörök från toppen. */
  burst(x, alt, colors) {
    for (let i = 0; i < 90; i++) {
      const confetti = i % 3 !== 0;
      this.#add({
        x,
        alt,
        vx: (Math.random() - 0.3) * 420,
        va: 8 + Math.random() * 38,
        fall: confetti ? 0.35 : 0.6,
        drag: confetti ? 1.2 : 0.8,
        life: 1.6 + Math.random() * 1.4,
        size: confetti ? 5 + Math.random() * 4 : 3 + Math.random() * 5,
        color: confetti ? colors[i % colors.length] : '#ffffff',
        confetti,
        spin: Math.random() * 6,
        vspin: (Math.random() - 0.5) * 16,
      });
    }
  }

  /** Damm och gräs som rotorvinden blåser åt sidorna vid marken. */
  downwash(dt, x, strength, color) {
    const n = Math.floor(strength * 60 * dt + Math.random());
    for (let i = 0; i < n; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.#add({
        x: x + side * (20 + Math.random() * 40),
        alt: Math.random() * 1.5,
        vx: side * (120 + Math.random() * 260) * strength,
        va: 1 + Math.random() * 5,
        fall: 0.25,
        drag: 1.6,
        life: 0.6 + Math.random() * 0.6,
        size: 2 + Math.random() * 4,
        color,
        confetti: false,
        spin: 0,
        vspin: 0,
      });
    }
  }

  /** @param {(alt:number)=>number} y  höjd → skärm-y */
  drawParticles(ctx, y) {
    for (const p of this.particles) {
      ctx.globalAlpha = Math.min(1, p.life * 1.5);
      ctx.fillStyle = p.color;
      const py = y(p.alt);
      if (p.confetti) {
        ctx.save();
        ctx.translate(p.x, py);
        ctx.rotate(p.spin);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, (p.size / 2) * Math.abs(Math.cos(p.spin * 1.3)) + 1);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, py, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  #add(p) {
    if (this.particles.length < MAX_PARTICLES) this.particles.push(p);
  }
}

const wrap = (u) => u - Math.floor(u);
