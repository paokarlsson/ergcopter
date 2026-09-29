// Skärmkontroller: helskärm och "håll skärmen vaken" (Screen Wake Lock API).
// Delas av spelet och dashboarden. Inga beroenden.

const AWAKE_KEY = 'skierg.keepAwake';

const ICONS = {
  enter: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  exit: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  awake: '<path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/><circle cx="12" cy="12" r="4"/>',
};
const svg = (d) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

// --- Helskärm ----------------------------------------------------------------------

const root = document.documentElement;
const fsElement = () => document.fullscreenElement ?? document.webkitFullscreenElement ?? null;
export const fullscreenSupported = !!(root.requestFullscreen || root.webkitRequestFullscreen);

export async function toggleFullscreen() {
  try {
    if (fsElement()) await (document.exitFullscreen ?? document.webkitExitFullscreen).call(document);
    else if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    else root.webkitRequestFullscreen();
  } catch (err) {
    console.warn('[SkiErg] helskärm:', err.message);
  }
}

// --- Håll skärmen vaken -----------------------------------------------------------

export const wakeLockSupported = 'wakeLock' in navigator;
let wantAwake = false;
let lock = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

async function acquire() {
  if (!wantAwake || lock || document.visibilityState !== 'visible') return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => {
      lock = null;
      notify();
    });
  } catch (err) {
    console.warn('[SkiErg] håll skärmen vaken:', err.message);
  }
  notify();
}

export function setKeepAwake(on) {
  wantAwake = on && wakeLockSupported;
  try {
    localStorage.setItem(AWAKE_KEY, wantAwake ? '1' : '0');
  } catch {}
  if (wantAwake) acquire();
  else {
    lock?.release();
    lock = null;
    notify();
  }
}

export const keepAwake = () => wantAwake;

// Webbläsaren släpper låset när fliken döljs; ta det igen när den syns.
document.addEventListener('visibilitychange', acquire);

// --- Knappar ------------------------------------------------------------------------

/**
 * Lägger till helskärms- och vakenknapparna i `container`.
 * Knappar för funktioner som webbläsaren saknar visas inte.
 */
export function mountScreenControls(container) {
  const fsBtn = document.createElement('button');
  fsBtn.type = 'button';
  fsBtn.className = 'screen-btn';
  fsBtn.hidden = !fullscreenSupported;
  fsBtn.addEventListener('click', toggleFullscreen);

  const awakeBtn = document.createElement('button');
  awakeBtn.type = 'button';
  awakeBtn.className = 'screen-btn';
  awakeBtn.hidden = !wakeLockSupported;
  awakeBtn.innerHTML = svg(ICONS.awake);
  awakeBtn.addEventListener('click', () => setKeepAwake(!wantAwake));

  function render() {
    const fs = !!fsElement();
    fsBtn.innerHTML = svg(fs ? ICONS.exit : ICONS.enter);
    fsBtn.title = fs ? 'Lämna helskärm (F)' : 'Helskärm (F)';
    fsBtn.setAttribute('aria-label', fs ? 'Lämna helskärm' : 'Helskärm');
    fsBtn.setAttribute('aria-pressed', String(fs));

    awakeBtn.setAttribute('aria-pressed', String(wantAwake));
    awakeBtn.setAttribute('aria-label', 'Håll skärmen på');
    awakeBtn.title = !wantAwake
      ? 'Håll skärmen på: av'
      : lock
        ? 'Håll skärmen på: på'
        : 'Håll skärmen på: väntar (webbläsaren nekade just nu)';
    awakeBtn.dataset.state = !wantAwake ? 'off' : lock ? 'on' : 'pending';
  }

  document.addEventListener('fullscreenchange', render);
  document.addEventListener('webkitfullscreenchange', render);
  listeners.add(render);
  render();
  container.append(fsBtn, awakeBtn);
}

// Senaste valet gäller även nästa gång sidan öppnas.
try {
  if (localStorage.getItem(AWAKE_KEY) === '1') setKeepAwake(true);
} catch {}
