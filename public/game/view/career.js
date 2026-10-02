// Fjällräddaren-menyn (plan.md §2–3): rubrik med helikoptern, karriärens steg som flikar
// (flygskolan, övningar, uppflygning, räddningsuppdrag), ett rutnät av kort med bild och
// stjärnor på en glaspanel och en sidopanel som beskriver det valda. Ett drag startar förslaget.

import { drawThumb } from './thumbs.js';
import { drawHelicopter } from './heli-draw.js';
import { HeroHeli } from './hero-heli.js';
import { programOf } from '../core/exercise.js';

const $ = (id) => document.getElementById(id);
// Där rubrikens helikopter ryms i sin canvas (andelar): hela flygplanet syns, med luft under medarna
const HERO_RECT = [0.17, 0.09, 0.9, 0.915];

const STEPS = [
  {
    id: 'school',
    label: 'Flygskolan',
    title: 'Flygskola',
    text:
      'Lär dig grunderna i att hantera helikoptern. Här handlar det om precision, kontroll och att hushålla med ' +
      'krafterna – inte bara ren styrka. Lektionerna sätter ihop övningarna till ett pass med instruktören; ' +
      'övningarna kan du flyga när du vill.',
  },
  {
    id: 'exercises',
    label: 'Övningar',
    title: 'Övningar',
    text: 'Öva ett moment i taget. Varje godkänd övning ger 1–3 stjärnor för precisionen, och ditt bästa resultat sparas.',
  },
  {
    id: 'exam',
    label: 'Uppflygning',
    title: 'Uppflygning',
    text: 'Fem moment i ett pass med examinatorn, utan omtag. Klarar du alla blir du junior fjällräddare och får räddningshelikoptern.',
  },
  {
    id: 'missions',
    label: 'Räddningsuppdrag',
    title: 'Räddningsuppdrag',
    text: 'Skarpa larm med patienter, väder och tidsgränser. Uppdragen öppnas efter uppflygningen.',
  },
];

const STATE = {
  done: ['✓ Klar', 'done'],
  next: ['Nästa', 'next'],
  tomorrow: ['I morgon', 'wait'],
  later: ['Låst', 'wait'],
  open: ['Öppen', 'next'],
  passed: ['✓ Godkänd', 'done'],
  retry: ['Omprov i morgon', 'wait'],
};

// Bilden till uppflygningens moment, från övningen som liknar det mest
const EXAM_THUMBS = { 'exam-hover': 'hover', 'exam-freefall': 'freefall', 'exam-engine': 'engine', 'exam-precision': 'hover', 'exam-landing': 'landing' };

export class CareerMenu {
  /** Bilder av 3D-landskapet till korten: (id[]) → canvas[] eller null. Sätts av main.js. */
  photos = null;
  /** 3D-helikoptern (heli3d.js) som ritas in i korten, eller null. Sätts av main.js. */
  heli3d = null;
  /** Hyllan med plattan (hoverpad.js) till plattscenerna, eller null. Sätts av main.js. */
  hoverPad = null;
  #thumbs = []; // korten som visas: { canvas, thumb, livery }
  #photoCache = new Map(); // landskapsbilden per kort, tas en gång
  #art = new Map(); // färdiga kortbilder, så att ett flikbyte inte ritar om helikoptrarna
  #artColors = null;
  #hero; // rubrikens helikopter i 3D

  constructor() {
    this.el = {
      name: $('menu-name'),
      title: $('menu-title'),
      logbook: $('menu-logbook'),
      steps: $('menu-steps'),
      cards: $('menu-cards'),
      sideTitle: $('side-title'),
      sideText: $('side-text'),
      sideGoal: $('side-goal'),
      alarm: $('menu-alarm'),
      pull: $('menu-pull'),
      free: $('menu-free'),
      heli: $('career-heli'),
    };
    this.#hero = new HeroHeli(this.el.heli, (canvas, livery) => drawHeader(canvas, this.m?.colors, livery), HERO_RECT, true);
    this.tab = 'school';
    this.m = null;
    this.onChoose = null;
    this.el.free.addEventListener('click', () => this.onChoose?.(null));
  }

  /**
   * @param {object} m
   * @param {string} m.name, m.title, m.logbook
   * @param {{ lesson, state }[]} m.lessons   state: done | next | tomorrow | later
   * @param {{ item, state }} m.exam          state: open | retry | passed
   * @param {{ item, stars: number|null }[]} m.exercises
   * @param {object|null} m.suggested  det ett drag startar, null = fri flygning
   * @param {boolean} m.junior
   * @param {string|null} m.alarm      text om larmen (junior)
   * @param {object} m.colors          scenens färger, till bilderna
   * @param {object} m.school, m.rescue  helikoptrarnas utseende
   * @param {(item: object|null) => void} onChoose
   */
  render(m, onChoose) {
    this.m = m;
    this.onChoose = onChoose;
    const e = this.el;
    e.name.textContent = m.name;
    e.title.textContent = m.title;
    e.logbook.textContent = m.logbook;
    e.alarm.hidden = !m.alarm;
    e.alarm.textContent = m.alarm ?? '';
    e.free.hidden = !m.junior;
    e.pull.replaceChildren('Dra för att starta', Object.assign(document.createElement('strong'), { textContent: m.suggested?.name ?? 'Fri flygning' }));
    this.#hero.show(m.rescue);
    // Fliken där förslaget finns
    const s = m.suggested;
    this.tab = !s ? (m.junior ? 'missions' : 'school') : s.kind === 'exam' ? 'exam' : s.steps ? 'exercises' : 'school';
    this.#render();
  }

  /** Byt flik med siffertangenterna 1–4. */
  showStep(index) {
    if (!this.m || !STEPS[index]) return;
    this.tab = STEPS[index].id;
    this.#render();
  }

  #render() {
    const m = this.m;
    const e = this.el;
    const done = {
      school: m.lessons.every((l) => l.state === 'done'),
      exercises: m.exercises.every((x) => x.stars),
      exam: m.exam.state === 'passed',
      missions: false,
    };
    e.steps.replaceChildren(
      ...STEPS.map((step, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.role = 'tab';
        b.className = `step${step.id === 'missions' && !m.junior ? ' locked' : ''}`;
        b.setAttribute('aria-selected', String(step.id === this.tab));
        b.append(`${i + 1}. ${step.label}`);
        if (done[step.id]) b.append(Object.assign(document.createElement('span'), { className: 'done', textContent: '✓' }));
        b.addEventListener('click', () => {
          this.tab = step.id;
          this.#render();
        });
        return b;
      })
    );
    const step = STEPS.find((x) => x.id === this.tab);
    e.sideTitle.textContent = step.title;
    e.sideText.textContent = step.text;
    e.sideGoal.hidden = true;
    this.#thumbs = [];
    const cards = this.#cards();
    e.cards.replaceChildren(...cards);
    e.cards.scrollTop = 0;
    this.#addPhotos();
  }

  /** Byter kortens ritade bakgrund mot en bild av 3D-landskapet, när det finns. */
  #addPhotos() {
    if (!this.photos) return;
    const missing = [...new Set(this.#thumbs.map((t) => t.thumb))].filter((id) => !this.#photoCache.has(id));
    if (missing.length) {
      const shots = this.photos(missing);
      if (!shots) return;
      missing.forEach((id, i) => this.#photoCache.set(id, shots[i]));
    }
    for (const t of this.#thumbs) this.#paint(t.canvas, t.thumb, t.livery);
  }

  /** Ritar kortets bild, från cachen om den redan är ritad med samma landskap och helikopter. */
  #paint(canvas, thumb, livery) {
    if (this.#artColors !== this.m.colors) {
      this.#art.clear();
      this.#artColors = this.m.colors;
    }
    const photo = this.#photoCache.get(thumb) ?? null;
    const heli = photo && this.heli3d && !this.heli3d.lost ? this.heli3d : null;
    const key = [thumb, livery?.body, livery?.accent, photo ? 1 : 0, heli ? 1 : 0].join('|');
    let art = this.#art.get(key);
    if (!art) {
      art = document.createElement('canvas');
      drawThumb(art, thumb, this.m.colors, livery, photo, heli, this.hoverPad);
      this.#art.set(key, art);
    }
    canvas.width = art.width;
    canvas.height = art.height;
    canvas.getContext('2d').drawImage(art, 0, 0);
  }

  #cards() {
    const m = this.m;
    switch (this.tab) {
      case 'school':
        // Lektionerna först, sedan övningarna de bygger på: hela flygskolan i ett rutnät
        return [
          ...m.lessons.map(({ lesson, state }) =>
            this.#card({
              item: lesson,
              title: `Lektion ${lesson.number}`,
              thumb: lesson.id,
              state,
              goal: `${lesson.name.replace(/^Lektion \d+: /, '')}: ${lesson.goal}.`,
              disabled: ['tomorrow', 'later'].includes(state),
            })
          ),
          ...this.#exerciseCards(),
        ];
      case 'exercises':
        return this.#exerciseCards();
      case 'exam': {
        const exam = m.exam.item;
        const moments = programOf(exam).moments;
        return [
          this.#card({
            item: exam,
            title: 'Uppflygning',
            thumb: 'exam',
            state: m.exam.state,
            goal: `${exam.goal}. Moment: ${moments.map((x) => x.name).join(' · ')}.`,
            disabled: m.exam.state === 'retry',
          }),
          ...moments.map((x, i) => this.#card({ title: `${i + 1}. ${x.name}`, thumb: EXAM_THUMBS[x.id] ?? 'hover', goal: `${x.goal}.`, info: true })),
        ];
      }
      default:
        return [
          this.#card({
            title: 'Första larmet',
            thumb: 'mission',
            state: m.junior ? null : 'later',
            stateText: m.junior ? 'Kommer snart' : null,
            goal: m.alarm ?? 'Skadad skidåkare vid Suljätten, 845 m. Kräver godkänd uppflygning.',
            disabled: true,
            livery: m.rescue,
          }),
        ];
    }
  }

  #exerciseCards() {
    return this.m.exercises.map(({ item, stars }, i) =>
      this.#card({ item, title: `${i + 1}. ${item.name}`, thumb: item.id, stars: stars ?? 0, goal: `${item.goal}.` })
    );
  }

  /**
   * Ett kort med bild, rubrik, stjärnor eller läge. info = bara visning (uppflygningens moment).
   * Fokus eller pekare på kortet visar målet i sidopanelen.
   */
  #card({ item = null, title, thumb, stars = null, state = null, stateText = null, goal, disabled = false, info = false, livery = null }) {
    const m = this.m;
    const li = document.createElement('li');
    const b = document.createElement(info ? 'div' : 'button');
    b.className = `card-btn${info ? '' : ' menu-item'}${item && item === m.suggested ? ' suggested' : ''}`;
    if (!info) {
      b.type = 'button';
      b.disabled = disabled;
      b.addEventListener('click', () => this.onChoose?.(item));
    }
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    this.#paint(canvas, thumb, livery ?? m.school);
    this.#thumbs.push({ canvas, thumb, livery: livery ?? m.school });
    b.append(canvas, Object.assign(document.createElement('span'), { className: 'card-title', textContent: title }));
    if (stars !== null) b.append(starRow(stars));
    if (state || stateText) {
      const [text, cls] = STATE[state] ?? [stateText, 'wait'];
      b.append(Object.assign(document.createElement('span'), { className: `card-state ${cls}`, textContent: stateText ?? text }));
    }
    // Låsta kort behåller färgen under ett mörkt glas, med ett hänglås i mitten
    if (disabled) b.append(lockIcon());
    const show = () => {
      this.el.sideGoal.hidden = false;
      this.el.sideGoal.textContent = goal;
    };
    b.addEventListener('focus', show);
    b.addEventListener('pointerenter', show);
    li.append(b);
    return li;
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const STAR_PATH = 'M12 1.6l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.7l-6.4 3.5 1.4-7.1-5.3-5 7.2-.9z';

/** Tre stjärnor som SVG: guld med mörk kant för de tagna, mörkt glas med ljus kant för resten. */
function starRow(stars) {
  const span = Object.assign(document.createElement('span'), { className: 'card-stars' });
  span.setAttribute('role', 'img');
  span.setAttribute('aria-label', `${stars} av 3 stjärnor`);
  for (let i = 0; i < 3; i++) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', i < stars ? 'star on' : 'star');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', STAR_PATH);
    svg.append(path);
    span.append(svg);
  }
  return span;
}

/** Hänglåset på låsta kort. */
function lockIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'card-lock');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of [
    ['path', { d: 'M7.5 10.5V7.8a4.5 4.5 0 0 1 9 0v2.7', class: 'shackle' }],
    ['rect', { x: '4.5', y: '10.5', width: '15', height: '11', rx: '2.4', class: 'body' }],
    ['path', { d: 'M12 14.6v2.8', class: 'hole' }],
  ]) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

/** Reservbild utan WebGL: den platta helikoptern, skalad till canvasen. */
function drawHeader(canvas, c, livery) {
  if (!c) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  const k = Math.min(canvas.width / 320, canvas.height / 130);
  ctx.translate(canvas.width * 0.45, canvas.height * 0.6);
  ctx.rotate(-0.06);
  ctx.scale(1.15 * k, 1.15 * k);
  drawHelicopter(ctx, { blur: 0.6, angle: 0.5, tailAngle: 0.2 }, c, livery);
  ctx.restore();
}
