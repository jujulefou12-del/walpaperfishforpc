/* ============================================================
   particles.js — Particules en suspension (poussière, micro-organismes,
   débris végétaux). Des centaines de points quasi invisibles portés par
   un champ de courant pseudo-volumétrique (bruit simplex 3D).

   Elles sont surtout visibles dans les zones éclairées : l'alpha est
   modulé par la proximité verticale des god-rays (calcul CPU léger
   approximant le champ lumineux du shader).
   ============================================================ */

import { Noise, rng, rand, clamp } from './noise.js';
import { settings } from './settings.js';
import { profile } from './settings.js';

const noise = new Noise(2468);

export class Particles {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.list = [];
    const r = rng(424242);
    const n = profile().particles;
    for (let i = 0; i < n; i++) this.spawn(r, true);
  }

  spawn(r, initial) {
    const kind = r();
    this.list.push({
      x: rand(r, 0, this.w),
      y: rand(r, this.h * 0.05, this.h * 0.97),
      z: rand(r, 0.1, 1),                       // profondeur (taille/voile)
      size: kind < 0.7 ? rand(r, 0.7, 1.8) : rand(r, 2, 3.6),
      alpha: rand(r, 0.05, 0.3),
      // débris végétaux : verdâtre ; poussière : beige-clair
      col: kind > 0.88 ? [0.62, 0.72, 0.5] :
           kind > 0.55 ? [0.85, 0.88, 0.8] : [0.8, 0.72, 0.55],
      vx: 0, vy: 0,
      phase: rand(r, 0, 100),
      organic: kind > 0.9,                      // micro-organisme qui "pulse"
    });
  }

  updateSize(w, h) {
    const sx = w / this.w, sy = h / this.h;
    this.w = w; this.h = h;
    for (const p of this.list) { p.x *= sx; p.y *= sy; }
  }

  /** Ajuste la population au profil de qualité courant. */
  matchBudget() {
    const target = Math.floor(profile().particles * settings.get('particles'));
    const r = Math.random;
    while (this.list.length > target) this.list.pop();
    while (this.list.length < target) this.spawn(r, false);
  }

  update(dt, time) {
    const cur = settings.get('current');
    this.matchBudget();
    for (const p of this.list) {
      // Champ de courant global : bruit lent + dérive horizontale dominante
      const fx = noise.n3(p.x * 0.0012, p.y * 0.0012, time * 0.05) * 10 * cur + 3.5 * cur;
      const fy = noise.n3(p.x * 0.0012 + 90, p.y * 0.0012, time * 0.045) * 6 * cur;
      // micro-propulsion des organismes
      let ox = 0, oy = 0;
      if (p.organic) {
        ox = Math.sin(time * 1.7 + p.phase) * 4;
        oy = Math.cos(time * 1.3 + p.phase * 1.7) * 3;
      }
      // inertie forte : ces particules répondent très lentement
      p.vx += (fx + ox - p.vx) * dt * 0.6;
      p.vy += (fy + oy - p.vy) * dt * 0.6;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // recyclage doux hors-champ
      if (p.x > this.w + 8) p.x = -8;
      if (p.x < -8) p.x = this.w + 8;
      if (p.y < this.h * 0.04) p.y = this.h * 0.97;
      if (p.y > this.h * 0.99) p.y = this.h * 0.05;
    }
  }

  /** Remplit le buffer de sprites (atlas 'soft'). */
  fillSprites(out) {
    for (const p of this.list) {
      // visibilité accrue dans les colonnes lumineuses (approx. des rayons)
      const lit = 0.55 + 0.45 * Math.abs(Math.sin(p.x * 0.004 + p.phase * 0.1));
      out.push({
        atlas: 'soft',
        texId: -1,
        x: p.x, y: p.y,
        size: p.size * (0.7 + p.z * 0.7),
        rot: 0,
        alpha: p.alpha * lit,
        tint: [p.col[0], p.col[1], p.col[2], p.alpha * lit],
        depth: p.z * 0.8,
      });
    }
    return out;
  }
}
