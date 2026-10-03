/* ============================================================
   feeding.js — Événements de nourrissage.

   Toutes les N minutes (réglable, défaut 5) : une pincée de nourriture
   tombe depuis la surface. Les flocons :
   - tailles et vitesses variées ;
   - dérive avec le courant ;
   - ralentissement en traversant les zones denses (frottement pseudo-eau) ;
   - finissent au sol puis se désagrègent lentement.

   L'événement dure 20 à 40 s. Aucun texte, aucun UI : purement visuel.
   Les poissons détectent les flocons via `activeFoods()` (état FEEDING).
   ============================================================ */

import { rng, rand } from './noise.js';
import { settings } from './settings.js';

export class Feeding {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.foods = [];
    this.timer = 8;                 // premier nourrissage après ~10-30 s
    this.phase = 'idle';            // idle | dropping | settling
    this.phaseT = 0;
    this.duration = 0;
    const r = rng(99);
    this.timer = rand(r, 12, 30);   // délai réaliste avant le 1er événement
  }

  updateSize(w, h) {
    const sx = w / this.w, sy = h / this.h;
    this.w = w; this.h = h;
    for (const f of this.foods) { f.x *= sx; f.y *= sy; }
  }

  /** Déclenche un nourrissage (auto ou manuel touche F). */
  start() {
    if (this.phase !== 'idle') return;
    this.phase = 'dropping';
    this.phaseT = 0;
    this.duration = rand(Math.random, 20, 40);
    this.rainEnd = rand(Math.random, 4, 9);       // pluie pendant 4-9 s
    this.spreadX = rand(Math.random, 0.3, 0.7) * this.w;
    this.emitAcc = 0;
  }

  spawnFlake() {
    const r = Math.random;
    const size = 1.4 + r() * r() * 4.6;           // beaucoup de petits, peu de gros
    this.foods.push({
      x: this.spreadX + (r() - 0.5) * this.w * 0.34,
      y: this.h * 0.055 + r() * 8,                // juste sous la surface
      vy: rand(r, 6, 16) * (0.5 + size / 5),      // taille → vitesse de chute
      vx: rand(r, -4, 6),
      size,
      spin: rand(r, 0, Math.PI * 2),
      spinV: rand(r, -1.4, 1.4),
      alpha: rand(r, 0.75, 1),
      eaten: false,
      settled: false,
      seed: r(),
      life: 1,
    });
  }

  activeFoods() {
    return this.foods.filter(f => !f.eaten && !f.settled && f.y > this.h * 0.07);
  }

  update(dt, time, groundY) {
    // --- planification automatique ---
    if (this.phase === 'idle') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.start();
        this.timer = settings.get('feedEvery') * 60 * rand(Math.random, 0.85, 1.15);
      }
    } else {
      this.phaseT += dt;
      if (this.phase === 'dropping' && this.phaseT < this.rainEnd) {
        // pluie de flocons : cadence décroissante
        this.emitAcc += dt * (14 - this.phaseT);
        while (this.emitAcc >= 1) { this.spawnFlake(); this.emitAcc -= 1; }
      }
      if (this.phaseT > this.duration) {
        this.phase = 'idle';
      }
    }

    // --- physique des flocons ---
    const cur = settings.get('current');
    for (let i = this.foods.length - 1; i >= 0; i--) {
      const f = this.foods[i];
      if (f.eaten) {
        // disparaît dans la bouche du poisson
        f.alpha -= dt * 6;
        if (f.alpha <= 0) this.foods.splice(i, 1);
        continue;
      }
      const gy = groundY(f.x);
      if (!f.settled) {
        // chute : gravité contre poussée d'Archimède + traînée
        const drag = 1 / (1 + f.size * 0.25);
        f.vy += (10 * drag - f.vy * 0.8) * dt;
        // ralentit en zone dense (feuillages) : friction locale
        const density = Math.max(0, Math.sin(f.x * 0.01 + f.seed * 9)) *
                        (f.y > gy - this.h * 0.4 ? 1 : 0.3);
        f.vy *= 1 - density * dt * 0.8;
        f.vx += (Math.sin(time * 0.7 + f.seed * 20) * 6 * cur - f.vx) * dt * 0.9;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.spin += f.spinV * dt;
        if (f.y >= gy - 3) { f.settled = true; f.y = gy - 3; }
      } else {
        // au sol : se désagrège lentement
        f.life -= dt * 0.04;
        f.alpha = Math.min(f.alpha, f.life);
        if (f.life <= 0) this.foods.splice(i, 1);
      }
    }
  }

  fillSprites(out) {
    for (const f of this.foods) {
      out.push({
        atlas: 'food',
        texId: -1,
        x: f.x, y: f.y,
        size: f.size * 1.6,
        rot: f.spin,
        alpha: f.alpha,
        tint: [1, 1, 1, f.alpha],
        depth: 0.7,
        procedural: true,
      });
    }
    return out;
  }

  get bursting() {
    // phase active : quelques bulles supplémentaires (demande aux Bubbles)
    return this.phase === 'dropping' && this.phaseT < this.rainEnd + 2;
  }
}
