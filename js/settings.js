/* ============================================================
   settings.js — Réglages, profils de qualité, persistance, panneau UI.
   Panneau ouvert/fermé avec Ctrl+Shift+A. Sauvegarde localStorage.
   URL: ?ui=0 force l'absence d'interface (mode wallpaper Lively).
   ============================================================ */

import { clamp } from './noise.js';

/** Profils de qualité : densités et effets par palier. */
export const QUALITY_PROFILES = {
  ultra:  { particles: 900, bubbles: 1.4, caustics: 1.3, godRays: 1.25, dof: true,  grain: 0.055, fishMax: 60 },
  high:   { particles: 600, bubbles: 1.0, caustics: 1.0, godRays: 1.0,  dof: true,  grain: 0.05,  fishMax: 48 },
  medium: { particles: 340, bubbles: 0.7, caustics: 0.8, godRays: 0.75, dof: false, grain: 0.045, fishMax: 36 },
  low:    { particles: 150, bubbles: 0.4, caustics: 0.55, godRays: 0.5, dof: false, grain: 0.035, fishMax: 24 },
};

const DEFAULTS = {
  quality: 'auto',            // 'auto' | ultra | high | medium | low
  fishCount: 22,              // priorité absolue : peu mais réalistes
  fishSpeed: 1.0,
  current: 1.0,               // intensité du courant
  light: 1.0,                 // intensité lumineuse globale
  caustics: 1.0,
  bubbles: 1.0,
  particles: 1.0,
  dof: 0.8,                   // profondeur de champ
  feedEvery: 5,               // minutes entre nourrissages
  mouse: true,                // interaction curseur
  daynight: true,             // cycle jour/nuit très lent
  sound: false,               // son désactivé par défaut
};

const KEY = 'aquarium.settings.v1';

class Settings {
  constructor() {
    this.values = { ...DEFAULTS };
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      Object.assign(this.values, saved);
    } catch (_) { /* stockage indisponible → valeurs par défaut */ }
    this.listeners = [];
  }

  get(k) { return this.values[k]; }

  set(k, v) {
    this.values[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(this.values)); } catch (_) {}
    this.listeners.forEach((fn) => fn(k, v));
  }

  onChange(fn) { this.listeners.push(fn); }
}

export const settings = new Settings();

/** Qualité effective (résout 'auto' via le niveau choisi par l'adaptive perf). */
let autoLevel = 'high';
export function setAutoQuality(level) { autoLevel = level; }
export function activeQuality() {
  return settings.get('quality') === 'auto' ? autoLevel : settings.get('quality');
}
export function profile() {
  return QUALITY_PROFILES[activeQuality()] || QUALITY_PROFILES.high;
}

/* ------------------------------------------------------------
   Liaison panneau DOM (le panneau reste caché tant que non ouvert).
   ------------------------------------------------------------ */
const SLIDERS = [
  ['s-fishCount', 'fishCount', v => Math.round(v)],
  ['s-fishSpeed', 'fishSpeed', v => v.toFixed(2)],
  ['s-current',   'current',   v => v.toFixed(2)],
  ['s-light',     'light',     v => v.toFixed(2)],
  ['s-caustics',  'caustics',  v => v.toFixed(2)],
  ['s-bubbles',   'bubbles',   v => v.toFixed(2)],
  ['s-particles', 'particles', v => v.toFixed(2)],
  ['s-dof',       'dof',       v => v.toFixed(2)],
  ['s-feedEvery', 'feedEvery', v => v.toFixed(1)],
];

const CHECKS = [['s-mouse', 'mouse'], ['s-daynight', 'daynight'], ['s-sound', 'sound']];

export function initPanel({ onToggleSound }) {
  const panel = document.getElementById('panel');
  const uiDisabled = new URLSearchParams(location.search).get('ui') === '0';
  if (uiDisabled) document.body.classList.add('no-ui');

  // select qualité
  const q = document.getElementById('s-quality');
  q.value = settings.get('quality');
  q.addEventListener('change', () => settings.set('quality', q.value));

  // sliders
  for (const [id, key, fmt] of SLIDERS) {
    const el = document.getElementById(id);
    const label = el.parentElement.querySelector('b');
    el.value = settings.get(key);
    label.textContent = fmt(parseFloat(el.value));
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      settings.set(key, v);
      label.textContent = fmt(v);
    });
    settings.onChange((k, val) => {
      if (k === key) { el.value = val; label.textContent = fmt(parseFloat(val)); }
    });
  }

  // checkboxes
  for (const [id, key] of CHECKS) {
    const el = document.getElementById(id);
    el.checked = !!settings.get(key);
    el.addEventListener('change', () => {
      settings.set(key, el.checked);
      if (key === 'sound' && onToggleSound) onToggleSound(el.checked);
    });
  }

  // ouverture / fermeture
  const toggle = () => {
    if (uiDisabled) return;
    panel.classList.toggle('open');
    panel.setAttribute('aria-hidden', panel.classList.contains('open') ? 'false' : 'true');
  };
  document.getElementById('panel-close').addEventListener('click', toggle);
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.code === 'KeyA')) { e.preventDefault(); toggle(); }
  });

  return { toggle };
}

/** Met à jour les indicateurs FPS/qualité du panneau. */
export function updateStats(fps, level) {
  const a = document.getElementById('q-active');
  const f = document.getElementById('q-fps');
  if (a) a.textContent = level.toUpperCase();
  if (f) f.textContent = String(Math.round(fps));
}

export { clamp };
