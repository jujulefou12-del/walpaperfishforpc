/* ============================================================
   lighting.js — Gestion de la lumière : cycle jour/nuit très lent,
   calcul des uniformes d'éclairage transmis au shader d'environnement.

   Le cycle est extrêmement discret : la "journée" dure plusieurs
   minutes avec des transitions sinusoïdales lissées (jamais brutal).
   ============================================================ */

import { Noise, clamp } from './noise.js';
import { settings } from './settings.js';

const noise = new Noise(90210);

export class Lighting {
  constructor() {
    this.daylight = 1.0;     // 1 = plein jour, 0 = "nuit" (crépuscule chaud)
    this.phase = Math.random() * 1000;
    // Durée d'un cycle complet ~ 12 min : majoritairement jour.
    this.cycleSeconds = 720;
  }

  update(dt, time) {
    if (!settings.get('daynight')) {
      this.daylight = 1.0;
      return;
    }
    // Onde asymétrique : ~70% du temps en journée lumineuse,
    // descente et remontée très progressives vers un éclairage chaud.
    const x = (time / this.cycleSeconds) * Math.PI * 2 + this.phase;
    const base = 0.5 + 0.5 * Math.sin(x);
    const shaped = Math.pow(base, 0.45);            // écrase les bas → plus de jour
    const jitter = 0.03 * noise.n2(time * 0.02, 5.0); // micro-variations d'exposition
    this.daylight = clamp(shaped + jitter, 0.18, 1.0);
  }

  /** Intensité effective envoyée au shader (réglage × cycle). */
  get intensity() {
    const dayFactor = 0.62 + 0.38 * this.daylight;
    return settings.get('light') * dayFactor;
  }
}
