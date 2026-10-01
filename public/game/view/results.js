// Resultatskärmen (spec §7): rekordet, maxhöjden, en mening om topparna, siffror och
// passerade fjälltoppar efter fri flygning; godkänt, stjärnor och protokoll efter en
// övning, lektion eller uppflygningen. Watt bara när operatören slagit på råa watt (spec §6).

import { fmtM } from './render.js';
import { clock } from './hud.js';
import { drawHelicopter } from './heli-draw.js';
import { describeResults, starText } from '../core/exercise.js';

const $ = (id) => document.getElementById(id);

const RECORDS = {
  class: 'Nytt rekord i klassen!',
  today: 'Dagens rekord!',
  personal: 'Nytt personligt rekord!',
};

export class ResultScreen {
  constructor() {
    this.el = {
      kicker: $('fin-kicker'),
      kickerText: $('fin-kicker-text'),
      height: $('fin-height'),
      stars: $('fin-stars'),
      verdict: $('fin-verdict'),
      stats: $('fin-stats'),
      peaks: $('fin-peaks'),
      peakList: $('fin-peak-list'),
      list: $('fin-list'),
      certificate: $('certificate'),
      note: $('fin-note'),
      again: $('fin-again'),
      next: $('fin-next'),
      hint: $('fin-hint'),
    };
  }

  /**
   * Fri flygning.
   * @param {object} result  från spelet (game.js #finish)
   * @param {object} info
   * @param {'class'|'today'|'personal'|null} info.record  (results.js recordKind)
   * @param {number} info.rank, info.total  inom klassen
   * @param {{name,h,passed}[]} info.peaks   (results.js peaksAround)
   * @param {string} info.verdict
   * @param {boolean} info.showRaw
   */
  showFlight(result, { record, rank, total, peaks, verdict, showRaw }) {
    const e = this.el;
    this.#reset();
    e.kicker.classList.toggle('record', Boolean(record));
    e.kickerText.textContent = record ? RECORDS[record] : [result.name, result.klass].filter(Boolean).join(' · ');
    e.height.textContent = `${fmtM(result.hMax)} m`;
    e.verdict.textContent = verdict;
    const s = result.stats;
    const effect = (pct) => (showRaw ? `${Math.round((pct / 100) * s.P0)} W` : `${Math.round(pct)} %`);
    this.#stats([
      ['Tid', clock(result.duration)],
      ['Medeleffekt', s.strokes ? effect(s.avgPct) : '–'],
      ['Maxeffekt', s.strokes ? effect(s.maxPct) : '–'],
      ['Antal drag', String(s.strokes)],
      ['Placering', result.klass ? `${rank} av ${total} i klassen` : `${rank} av ${total}`],
    ], showRaw ? null : 'Effekten i procent av din lyfteffekt');
    e.peaks.hidden = false;
    e.peakList.replaceChildren(
      ...(peaks.length
        ? peaks.map((p) => {
            const li = document.createElement('li');
            li.className = p.passed ? 'passed' : 'next';
            li.append(
              Object.assign(document.createElement('span'), { className: 'ok', textContent: p.passed ? '✓' : '' }),
              Object.assign(document.createElement('span'), { textContent: p.name }),
              Object.assign(document.createElement('span'), { className: 'peak-h', textContent: `${fmtM(p.h)} m` }),
              Object.assign(document.createElement('span'), { className: 'ok', textContent: p.passed ? '✓' : '○' })
            );
            return li;
          })
        : [Object.assign(document.createElement('li'), { className: 'empty', textContent: 'Inga toppar i listan' })])
    );
    e.next.textContent = 'Till topplistan';
    e.hint.textContent = 'Tryck valfri tangent';
  }

  /**
   * Övning, lektion eller uppflygning.
   * @param {object} extra  från profilen: { bests, promoted, teaser, next, heliName, livery, date }
   */
  showExercise(result, extra = {}) {
    const e = this.el;
    this.#reset();
    const ex = result.exercise;
    const status = ex.status === 'running' ? 'aborted' : ex.status;
    const exam = ex.kind === 'exam';
    e.kicker.classList.toggle('record', status === 'passed' && Boolean(extra.bests?.some((b) => b.prev)));
    e.kickerText.textContent = ex.kind === 'exercise' ? `Övning: ${ex.name}` : ex.name;
    e.height.dataset.status = status === 'aborted' ? 'aborted' : status;
    e.height.textContent =
      status === 'aborted' ? 'Avbruten' : status === 'failed' ? 'Underkänd' : ex.kind === 'lesson' ? 'Lektionen klar!' : 'Godkänd!';
    if (ex.kind === 'lesson' && status !== 'aborted') e.height.dataset.status = 'passed';

    const stats = [['Tid', clock(result.duration)], ['Antal drag', String(result.stats.strokes)]];
    if (ex.kind === 'exercise') {
      const m = ex.moments[0];
      e.stars.hidden = status !== 'passed';
      e.stars.textContent = m ? starText(m.stars) : '';
      e.verdict.textContent = status === 'failed' ? ex.failReason : describeResults(ex.results) || ex.name;
      const best = extra.bests?.find((b) => b.id === ex.id);
      this.#note(best?.prev ? `Nytt personbästa! Förra bästa: ${starText(best.prev.stars)}${best.prev.summary ? ` – ${best.prev.summary}` : ''}` : null);
      this.#stats(stats);
    } else {
      // Lektion eller uppflygning: ett protokoll med alla moment.
      const stars = ex.moments.reduce((a, m) => a + m.stars, 0);
      e.stars.hidden = exam || status === 'aborted';
      e.stars.textContent = `${stars} av ${ex.plan.length * 3} ★`;
      e.verdict.textContent = exam && status === 'failed' ? ex.failReason : '';
      this.#stats([...stats, ['Moment klara', `${ex.moments.filter((m) => m.status === 'passed').length} av ${ex.plan.length}`]]);
      e.list.hidden = false;
      e.list.replaceChildren(
        ...ex.plan.map((p) => {
          const m = ex.moments.find((x) => x.id === p.id);
          const li = document.createElement('li');
          li.dataset.status = m?.status ?? 'skipped';
          const head = Object.assign(document.createElement('span'), {
            className: 'fin-moment',
            textContent: `${m ? (m.status === 'passed' ? '✓' : '✗') : '–'} ${p.name}`,
          });
          const detail = Object.assign(document.createElement('span'), {
            className: 'fin-detail',
            textContent: !m ? 'inte flugen' : m.status === 'passed' ? `${starText(m.stars)} ${describeResults(m.results)}` : m.failReason,
          });
          if (extra.bests?.some((b) => b.id === p.id && b.prev)) detail.textContent += ' · nytt personbästa!';
          li.append(head, detail);
          return li;
        })
      );
      if (exam && status === 'passed' && extra.promoted) {
        e.list.hidden = true;
        e.certificate.hidden = false;
        $('cert-name').textContent = result.name;
        $('cert-heli-name').textContent = extra.heliName ?? '';
        $('cert-date').textContent = extra.date ?? '';
        drawCertificateHeli($('cert-heli'), extra.livery);
      }
      this.#note([status === 'aborted' ? null : extra.teaser, extra.next].filter(Boolean).join(' ') || null);
    }
    e.next.textContent = 'Till menyn';
    e.hint.textContent = 'Dra för att fortsätta';
  }

  #reset() {
    const e = this.el;
    delete e.height.dataset.status;
    e.stars.hidden = true;
    e.peaks.hidden = true;
    e.list.hidden = true;
    e.certificate.hidden = true;
    e.note.hidden = true;
  }

  #stats(rows, note = null) {
    const parts = rows.flatMap(([label, value]) => [
      Object.assign(document.createElement('dt'), { textContent: label }),
      Object.assign(document.createElement('dd'), { textContent: value }),
    ]);
    if (note) parts.push(Object.assign(document.createElement('div'), { className: 'note', textContent: note }));
    this.el.stats.replaceChildren(...parts);
  }

  #note(text) {
    this.el.note.hidden = !text;
    this.el.note.textContent = text ?? '';
  }
}

/** Den nya helikoptern på certifikatet, stilla på marken. */
function drawCertificateHeli(canvas, livery) {
  const ctx = canvas.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  const c = { body: v('--heli-body'), accent: v('--heli-accent'), glass: v('--heli-glass'), metal: v('--heli-metal'), rotor: v('--heli-rotor') };
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2 + 10, 92);
  ctx.scale(1.3, 1.3);
  drawHelicopter(ctx, { blur: 0, angle: 0.3, tailAngle: 0.5 }, c, livery);
  ctx.restore();
}
