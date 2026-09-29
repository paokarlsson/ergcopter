// Aspirantens flygskola (plan.md §3): lektioner som sätter ihop övningar till
// ett längre pass, och uppflygningen som ger graden junior. Lektionerna är
// valfria; uppflygningen krävs. Ren logik: dagen skickas in som 'YYYY-MM-DD'.

import { EXERCISES } from './exercise.js';

/** Det första skarpa uppdraget, som väntar efter uppflygningen (plan.md §5). */
export const FIRST_ALARM = 'skadad skidåkare vid Suljätten, 845 m';

export const GRADES = {
  aspirant: 'Aspirant',
  junior: 'Junior fjällräddare',
};

/**
 * Lektionerna flygs i ordning. `moments` är övningarnas id, `intro` är
 * instruktörens hälsning och `teaser` visas efteråt, så att man vill komma tillbaka.
 */
export const LESSONS = [
  {
    id: 'lesson-1',
    number: 1,
    name: 'Lektion 1: Första lektionen',
    goal: 'Lyfta, studsa och hovra',
    intro: 'Välkommen till flygskolan! I dag lär vi oss att lyfta, sätta ner och hovra.',
    moments: ['first-lift', 'bounce', 'hover'],
    teaser: 'Nästa lektion: trappan, följ instruktören och höjdflygning upp till 1 000 m.',
  },
  {
    id: 'lesson-2',
    number: 2,
    name: 'Lektion 2: Höjd',
    goal: 'Trappan, följ instruktören och höjdflygning',
    intro: 'I dag går vi högre. Hovra på varje trappsteg, följ mig – och sedan upp till 1 000 m.',
    moments: ['stairs', 'follow', 'altitude'],
    teaser: 'Nästa lektion: fritt fall. Då släpper du helikoptern på 1 000 m.',
  },
  {
    id: 'lesson-3',
    number: 3,
    name: 'Lektion 3: Fritt fall',
    goal: 'Fritt fall, hissen och sen hämtning',
    intro: 'I dag faller vi. Vänta tills du passerat gränsen innan du hämtar upp – inte förr!',
    moments: ['freefall', 'elevator', 'late-catch'],
    teaser: 'Nästa lektion hänger vi en sandsäck i vinschen – och så stannar motorn.',
  },
  {
    id: 'lesson-4',
    number: 4,
    name: 'Lektion 4: Last och nödläge',
    goal: 'Sandsäcken, motorstopp, moln och ringbanan',
    intro: 'Sista lektionen. Last i vinschen, ett motorstopp, flygning i moln – och ringbanan som belöning.',
    moments: ['sandbag', 'engine', 'clouds', 'rings'],
    teaser: 'Nu återstår bara uppflygningen. Examinatorn väntar.',
  },
];

/**
 * Uppflygningen: examinatorn bedömer varje moment strängt (inga nya försök)
 * och alla måste vara godkända.
 */
export const EXAM = {
  id: 'exam',
  kind: 'exam',
  name: 'Uppflygning',
  goal: 'Fem moment i ett pass. Alla ska vara godkända för att bli junior fjällräddare',
  intro: 'Jag är din examinator. Fem moment, inga omtag. Lycka till!',
  moments: [
    {
      id: 'exam-hover',
      name: 'Lyft och hovring',
      goal: 'Lyft och håll 150 m ±15 m i 20 s',
      maxS: 180,
      steps: [{ type: 'hover', at: 150, tol: 15, holdS: 20 }],
    },
    {
      id: 'exam-freefall',
      name: 'Fritt fall',
      goal: 'Stig till 800 m och sluta dra. Hämta upp under 550 m men före 400 m',
      maxS: 300,
      steps: [
        { type: 'climb', to: 800 },
        { type: 'freefall', from: 800, gate: 550, floor: 400 },
      ],
    },
    {
      id: 'exam-engine',
      name: 'Motorstopp',
      goal: 'Hovra på 450 m tills motorn stannar. Hämta upp före 230 m när den startar igen',
      maxS: 240,
      steps: [{ type: 'engineout', at: 450, tol: 30, cutAfter: [3, 10], drop: 100, floor: 230 }],
    },
    {
      id: 'exam-precision',
      name: 'Precisionshovring',
      goal: 'Håll 250 m ±15 m i 20 s',
      maxS: 180,
      steps: [{ type: 'hover', at: 250, tol: 15, holdS: 20 }],
    },
    {
      id: 'exam-landing',
      name: 'Landning',
      goal: 'Landa vid verkstan, högst 1,5 m/s',
      maxS: 180,
      steps: [{ type: 'land', maxSpeed: 1.5 }],
    },
  ],
  teaser: `Första larmet: ${FIRST_ALARM}. Snart.`,
};

/** Övning, lektion eller uppflygningen med ett visst id (t.ex. för ?demo=). */
export function findProgram(id) {
  return [...EXERCISES, ...LESSONS, EXAM].find((x) => x.id === id) ?? null;
}

/**
 * Vad som är öppet för en profil i dag.
 *   lessons: [{ lesson, state }]  state: 'done' | 'next' | 'tomorrow' | 'later'
 *   exam:    'open' | 'tomorrow' | 'passed'
 *   suggestion: det ett drag i menyn startar (null = fri flygning)
 * Med `lessonPerDay` blir det en ny lektion per dag och ett försök på uppflygningen per dag.
 * Genomförda lektioner och alla övningar går alltid att flyga.
 * @param {object} profile  från Progress.profile()
 * @param {string} today    'YYYY-MM-DD'
 */
export function careerState(profile, today, { lessonPerDay = true } = {}) {
  const doneToday = Object.values(profile.lessons).includes(today);
  let nextFound = false;
  const lessons = LESSONS.map((lesson) => {
    if (profile.lessons[lesson.id]) return { lesson, state: 'done' };
    if (nextFound) return { lesson, state: 'later' };
    nextFound = true;
    return { lesson, state: lessonPerDay && doneToday ? 'tomorrow' : 'next' };
  });

  const exam =
    profile.grade !== 'aspirant' ? 'passed' : lessonPerDay && profile.exam.lastTry === today ? 'tomorrow' : 'open';

  let suggestion = null;
  if (profile.grade === 'aspirant') {
    const next = lessons.find((l) => l.state === 'next')?.lesson;
    const allLessons = lessons.every((l) => l.state === 'done');
    const exercise = EXERCISES.find((ex) => !profile.passed.has(ex.id));
    suggestion = next ?? (allLessons && exam === 'open' ? EXAM : null) ?? exercise ?? (exam === 'open' ? EXAM : null);
  }
  return { lessons, exam, suggestion };
}
