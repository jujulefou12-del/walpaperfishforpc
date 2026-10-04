/* ============================================================
   bubbles.js — Bulles d'air réalistes.

   - Points d'émission (diffuseurs) placés près du sol ;
   - tailles variées, minuscules → moyennes ;
   - remontée à vitesse dépendante de la taille (physique simplifiée),
     dérive latérale sinueuse (bruit), oscillation de forme ;
   - groupes : certaines émissions libèrent une grappe serrée ;
   - reflet lumineux géré par le shader FS_BUBBLE ;
   - pop en surface : mini-éclaboussure (bulle de surface brève).
   ============================================================ */

import { Noise, rng, rand } from './noise.js';
import { settings, profile } from './settings.js';

const noise = new Noise(1357);

export class Bubbles {
  constructor(w, h, groundY) {
    this.w = w; this.h = h; this.groundY = groundY;
    this.list = [];
    const r = rng(2024);
    // 3 diffuseurs + un point "coin gauche" pour les grappes
    this.emitters = Array.from({ length: 4 }, () => ({
      x: rand(r, 0.08, 0.92) * w,
      rate: rand(r, 0.6, 2.2),            // bulles/seconde (base)
      clusterP: rand(r, 0.06, 0.18),      // probabilité de grappe
      next: 0,
    }));
  }

  updateSize(w, h, groundY) {
    this.w = w; this.h = h; this.groundY = groundY;
    for (const b of this.list) b.x *= w / this.w || 1;
    this.emitters.forEach((e, i) => e.x = [0.15, 0.42, 0.7, 0.9][i] * w);
  }

  emit(e, big) {
    const gy = this.groundY(e.x);
    this.list.push({
      x: e.x + rand(Math.random, -6, 6),
      y: gy - rand(Math.random, 2, 10),
      r: big ? rand(Math.random, 2.6, 5.2) : rand(Math.random, 0.7, 2.2),
      vy: 0,
      wob: Math.random() * 10,
      alpha: rand(Math.random, 0.35, 0.85),
    });
  }

  update(dt, time, extraBurst) {
    const mul = settings.get('bubbles') * profile().bubbles;
    if (mul <= 0 && !extraBurst) { this.list.length = 0; return; }

    // émission par diffuseur
    for (const e of this.emitters) {
      e.next -= dt;
      if (e.next <= 0) {
        e.next = 1 / (e.rate * mul + 1e-6);
        this.emit(e, Math.random() < 0.18);
        // grappe de petites bulles
        if (Math.random() < e.clusterP * mul) {
          const n = 6 + ((Math.random() * 8) | 0);
          for (let i = 0; i < n; i++) {
            this.emit(e, false);
            this.list[this.list.length - 1].y -= i * rand(Math.random, 2, 7);
          }
        }
      }
    }

    // burst supplémentaire (nourrissage)
    if (extraBurst) {
      for (let i = 0; i < 2; i++) {
        this.emit({ x: rand(Math.random, 0.1, 0.9) * this.w }, Math.random() < 0.3);
        this.list[this.list.length - 1].alpha *= 0.7;
      }
    }

    const surfY = this.h * 0.05;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      // vitesse terminale ∝ sqrt(r) (physique des bulles)
      const vterm = 26 + Math.sqrt(b.r) * 34;
      b.vy += (vterm - b.vy) * dt * 2.2;
      b.y -= b.vy * dt;
      // sinuosité : dérive latérale bruitée, plus forte pour les grosses
      b.x += Math.sin(time * 3.1 + b.wob) * (0.6 + b.r * 0.5) * dt * 10
           + noise.n2(b.y * 0.01, time * 0.3) * 12 * dt * settings.get('current');

      if (b.y < surfY) {
        // crève en surface : disparition franche
        this.list.splice(i, 1);
      }
    }
    // plafond de population
    const maxN = Math.floor(260 * Math.max(mul, 0.2));
    if (this.list.length > maxN) this.list.splice(0, this.list.length - maxN);
  }

  fillSprites(out) {
    for (const b of this.list) {
      out.push({
        atlas: 'bubble',
        texId: -1,
        x: b.x, y: b.y,
        size: b.r * 1.35,
        rot: 0,
        alpha: b.alpha,
        tint: [1, 1, 1, b.alpha],
        depth: 0.9,
        procedural: true,
      });
    }
    return out;
  }
}
