/* ============================================================
   interaction.js — Curseur = perturbation physique dans l'eau.

   Zones d'influence (px) :
     > 250        : aucune réaction
     150 – 250    : vigilance (léger ralentissement, amorce de détour)
      80 – 150    : changement progressif de direction
       < 80       : fuite rapide (état FLEE)

   La force appliquée est continue (jamais de téléportation) et s'amortit.
   Gère aussi :
   - la force transmise au shader pour le ripple/refraction souris ;
   - l'auto-masquage du curseur après inactivité (mode wallpaper).
   ============================================================ */

import { clamp, damp } from './noise.js';
import { settings } from './settings.js';

export class Interaction {
  constructor() {
    this.x = -9999; this.y = -9999;
    this.px = -9999; this.py = -9999;
    this.vx = 0; this.vy = 0;          // vitesse du curseur → intensité remous
    this.strength = 0;                 // 0..1 transmis au shader
    this.lastMove = performance.now();
    this.hidden = false;

    window.addEventListener('mousemove', (e) => {
      this.x = e.clientX; this.y = e.clientY;
      this.lastMove = performance.now();
      if (this.hidden) this.unhideCursor();
    }, { passive: true });

    window.addEventListener('mouseleave', () => {
      // la souris quitte la fenêtre : plus de perturbation
      this.x = -9999; this.y = -9999;
    });

    // Auto-masquage du curseur en mode wallpaper (3 s d'inactivité)
    setInterval(() => {
      const idleMs = performance.now() - this.lastMove;
      const wallpaper = document.body.classList.contains('wallpaper-mode');
      const panelOpen = document.getElementById('panel')?.classList.contains('open');
      if (wallpaper && !panelOpen && idleMs > 3000 && !this.hidden) this.hideCursor();
    }, 500);
  }

  hideCursor() { document.body.classList.add('cursor-hidden'); this.hidden = true; }
  unhideCursor() { document.body.classList.remove('cursor-hidden'); this.hidden = false; }

  update(dt) {
    // vélocité du curseur (lissée) → alimente l'intensité des remous
    const rawvx = (this.x - this.px) / Math.max(dt, 1e-4);
    const rawvy = (this.y - this.py) / Math.max(dt, 1e-4);
    this.px = this.x; this.py = this.y;
    this.vx = damp(this.vx, clamp(rawvx, -3000, 3000), 8, dt);
    this.vy = damp(this.vy, clamp(rawvy, -3000, 3000), 8, dt);
    const speed = Math.hypot(this.vx, this.vy);
    const target = clamp(speed / 900, 0, 1) * (this.x > -1000 ? 1 : 0);
    this.strength = damp(this.strength, target, 3.5, dt);
  }

  /**
   * Applique les paliers de réaction à un poisson (appelé par Fish.update
   * via senseMouse, mais la logique de distance vit ici).
   * Retourne {react: 0..1, flee: bool}.
   */
  static assess(dist) {
    if (!settings.get('mouse')) return { react: 0, flee: false };
    if (dist > 250) return { react: 0, flee: false };
    if (dist > 150) return { react: 0.25 * (1 - (dist - 150) / 100), flee: false };
    if (dist > 80)  return { react: 0.55 + 0.3 * (150 - dist) / 70, flee: false };
    return { react: 1, flee: true };
  }

  /** Force latérale douce pour les poissons en zone de vigilance/détour. */
  applyTo(fish) {
    const on = settings.get('mouse');
    if (!on || this.x < -1000) { fish.mouseDist = Infinity; return null; }
    const dx = fish.x - this.x, dy = fish.y - this.y;
    const dist = Math.hypot(dx, dy);
    fish.mouseDist = dist;
    fish.mouseAng = Math.atan2(dy, dx);
    const a = Interaction.assess(dist);
    if (a.react === 0) return null;
    // direction opposée au curseur
    const nx = dist > 1 ? dx / dist : 1, ny = dist > 1 ? dy / dist : 0;
    return { flee: a.flee, react: a.react, nx, ny };
  }
}
