/* ============================================================
   plants.js — Plantes aquatiques animées de façon organique.

   Chaque plante = une tige découpée en segments ; la flexion est
   calculée par bruit simplex (pas de rotation répétitive). Les
   feuilles sont dessinées dans des atlas de textures générés au
   démarrage (plusieurs variétés, nuances, imperfections, bords
   légèrement abîmés), puis rendues comme sprites WebGL.

   Espèces :
   - Vallisneria : longues lanières fines quasi surface, ondulantes
   - Echinodorus : grandes feuilles ovales lancéolées (milieu)
   - Rotala/Ludwigia : tiges à petites feuilles (haute, moyenne)
   - Anubias : feuilles coriaces sombres basses (fixées sur bois)
   - Gazon (Monte-Carlo) : touffes basses denses
   ============================================================ */

import { Noise, rng, rand } from './noise.js';
import { settings } from './settings.js';

const noise = new Noise(31337);

/* ================= ATLAS DE TEXTURES ================= */

/** Génère une texture feuille 2D (canvas hors-écran). */
function makeLeafTexture(species, variant, seed) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const r = rng(seed * 977 + variant * 31 + species.length);

  // teintes naturelles (jamais néon) : vert foncé → olive, quelques rouges bruns
  const palettes = {
    vallisneria: [[54, 96, 42], [70, 112, 48], [46, 84, 40], [84, 118, 60]],
    echinodorus: [[38, 82, 38], [58, 100, 44], [96, 62, 34], [70, 96, 46]],
    rotala:      [[64, 104, 52], [88, 116, 58], [120, 74, 40], [52, 92, 46]],
    anubias:     [[28, 58, 30], [38, 70, 36], [24, 52, 28]],
    grass:       [[58, 108, 46], [72, 120, 52], [48, 92, 40]],
  };
  const pal = palettes[species] || palettes.grass;
  const base = pal[(r() * pal.length) | 0];
  const jitter = () => (r() - 0.5) * 22;

  ctx.translate(S / 2, S / 2);

  if (species === 'vallisneria' || species === 'grass') {
    // Lanière longue : ruban sinueux effilé
    const wdt = species === 'grass' ? rand(r, 0.10, 0.16) : rand(r, 0.07, 0.13);
    const bend = rand(r, -0.25, 0.25);
    ctx.beginPath();
    const steps = 14;
    const ptsL = [], ptsR = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = S * 0.48 - t * S * 0.96;
      const x = Math.sin(t * 2.4 + bend) * S * 0.06;
      const half = S * wdt * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.62 + 0.22);
      ptsL.push([x - half, y]); ptsR.push([x + half, y]);
    }
    ctx.moveTo(ptsL[0][0], ptsL[0][1]);
    ptsL.forEach(p => ctx.lineTo(p[0], p[1]));
    for (let i = ptsR.length - 1; i >= 0; i--) ctx.lineTo(ptsR[i][0], ptsR[i][1]);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, S/2, 0, -S/2);
    g.addColorStop(0, `rgb(${base[0]*0.6+jitter()},${base[1]*0.6+jitter()},${base[2]*0.6})`);
    g.addColorStop(0.5, `rgb(${base[0]+jitter()},${base[1]+jitter()},${base[2]+jitter()})`);
    g.addColorStop(1, `rgb(${base[0]*1.25},${base[1]*1.3},${base[2]*1.1})`);
    ctx.fillStyle = g;
    ctx.fill();
    // nervure claire centrale
    ctx.strokeStyle = `rgba(${base[0]+40},${base[1]+48},${base[2]+30},0.35)`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = S * 0.48 - t * S * 0.96;
      const x = Math.sin(t * 2.4 + bend) * S * 0.06;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else if (species === 'anubias') {
    // Feuille coriace ovale arrondie, épiderme luisant
    const lw = S * rand(r, 0.30, 0.40), lh = S * rand(r, 0.42, 0.52);
    ctx.beginPath();
    ctx.moveTo(0, lh);
    ctx.bezierCurveTo(-lw * 1.15, lh * 0.4, -lw * 0.95, -lh * 0.75, 0, -lh);
    ctx.bezierCurveTo(lw * 0.95, -lh * 0.75, lw * 1.15, lh * 0.4, 0, lh);
    const g = ctx.createRadialGradient(-lw*0.3, -lh*0.3, 4, 0, 0, lh);
    g.addColorStop(0, `rgb(${base[0]+55},${base[1]+62},${base[2]+40})`);
    g.addColorStop(0.55, `rgb(${base[0]+jitter()},${base[1]+jitter()},${base[2]+jitter()})`);
    g.addColorStop(1, `rgb(${base[0]-14},${base[1]-18},${base[2]-12})`);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = `rgba(${base[0]+60},${base[1]+70},${base[2]+50},0.3)`;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(0, lh * 0.9); ctx.lineTo(0, -lh * 0.9); ctx.stroke();
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * lh * 0.22);
      ctx.quadraticCurveTo(i % 2 ? lw * 0.4 : -lw * 0.4, i * lh * 0.22 + lh * 0.1,
                           i % 2 ? lw * 0.72 : -lw * 0.72, i * lh * 0.22 + lh * 0.02);
      ctx.stroke();
    }
  } else {
    // lanceolé (echinodorus / rotala)
    const lw = S * rand(r, 0.16, 0.26), lh = S * rand(r, 0.40, 0.48);
    ctx.beginPath();
    ctx.moveTo(0, lh);
    ctx.bezierCurveTo(-lw * 1.3, lh * 0.2, -lw * 0.8, -lh * 0.7, 0, -lh);
    ctx.bezierCurveTo(lw * 0.8, -lh * 0.7, lw * 1.3, lh * 0.2, 0, lh);
    const g = ctx.createLinearGradient(0, lh, 0, -lh);
    const red = base[0] > 90 && base[1] < 90; // teinte rouge-brun naturelle
    g.addColorStop(0, `rgb(${base[0]*0.55},${base[1]*0.55},${base[2]*0.5})`);
    g.addColorStop(0.5, `rgb(${base[0]+jitter()},${base[1]+jitter()},${base[2]+jitter()})`);
    g.addColorStop(1, red ? `rgb(${base[0]*1.2},${base[1]*1.1},${base[2]})`
                          : `rgb(${base[0]*1.2+30},${base[1]*1.25},${base[2]*1.1})`);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(220,240,200,0.14)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, lh * 0.85); ctx.lineTo(0, -lh * 0.85); ctx.stroke();
  }

  // Imperfection naturelle : petite morsure / trou sur le bord
  if (r() < 0.55) {
    ctx.globalCompositeOperation = 'destination-out';
    const ang = r() * Math.PI * 2;
    const rad = S * rand(r, 0.25, 0.42);
    ctx.beginPath();
    ctx.arc(Math.cos(ang) * rad, Math.sin(ang) * rad, S * rand(r, 0.03, 0.08), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  return c;
}

/** Construit les atlas : { species -> [canvas...] } */
export function buildPlantAtlases() {
  const atlas = {};
  const defs = [
    ['vallisneria', 5], ['echinodorus', 5], ['rotala', 5],
    ['anubias', 4], ['grass', 4],
  ];
  let seed = 1;
  for (const [sp, n] of defs) {
    atlas[sp] = [];
    for (let v = 0; v < n; v++) atlas[sp].push(makeLeafTexture(sp, v, seed++));
  }
  return atlas;
}

/* ================= PLANTS (simulation) ================= */

const SPECIES_DEF = {
  vallisneria: { height: [0.55, 0.85], segs: 7, sway: 1.25, width: [0.30, 0.46] },
  echinodorus: { height: [0.30, 0.52], segs: 5, sway: 0.85, width: [0.42, 0.62] },
  rotala:      { height: [0.35, 0.62], segs: 6, sway: 0.95, width: [0.26, 0.40] },
  anubias:     { height: [0.10, 0.20], segs: 3, sway: 0.35, width: [0.45, 0.62] },
  grass:       { height: [0.06, 0.13], segs: 3, sway: 0.7,  width: [0.22, 0.34] },
};

/**
 * Ensemble de plantes pour la scène.
 * @param {number} w,@param {number} h dimensions écran
 * @param {(x:number)=>number} groundY ligne de sol
 * @param {string} layer 'back' | 'mid' | 'front'
 */
export class Plants {
  /**
   * @param {number} w,@param {number} h dimensions écran
   * @param {(x:number)=>number} groundY ligne de sol
   * @param {string} layer 'back' | 'mid' | 'front'
   * @param {Object<string, number[]>} textureIndex atlas → [texId...] par espèce/variante
   */
  constructor(w, h, groundY, layer, textureIndex) {
    this.items = [];
    const r = rng(layer === 'back' ? 8001 : layer === 'mid' ? 8002 : 8003);
    const counts = {
      back:  { vallisneria: 16, echinodorus: 10, rotala: 14, anubias: 5, grass: 26 },
      mid:   { vallisneria: 12, echinodorus: 12, rotala: 10, anubias: 6, grass: 34 },
      front: { vallisneria: 6,  echinodorus: 5,  rotala: 4,  anubias: 3, grass: 14 },
    }[layer];

    for (const [sp, n] of Object.entries(counts)) {
      const def = SPECIES_DEF[sp];
      const variants = textureIndex[sp];
      for (let i = 0; i < n; i++) {
        const x = rand(r, -30, w + 30);
        const gy = sp === 'anubias'
          ? groundY(x) - rand(r, 20, 60)            // fixées sur le bois
          : groundY(x) + rand(r, -4, 8);
        const scale = rand(r, def.height[0], def.height[1]) * h;
        const lean = rand(r, -0.5, 0.5);            // orientation initiale
        this.items.push({
          sp, x, y: gy, h: scale, lean,
          segs: def.segs,
          sway: def.sway * rand(r, 0.75, 1.3),
          phase: r() * 100,
          leafW: rand(r, def.width[0], def.width[1]) * h * 0.5,
          texId: variants[(r() * variants.length) | 0],
          depth: layer === 'back' ? 0.35 : layer === 'mid' ? 0.65 : 0.95,
          // léger balancement latéral du pied (réponse au courant)
          curBias: rand(r, -0.3, 0.5),
        });
      }
    }
    // Trier par profondeur (rendu lointain → proche)
    this.items.sort((a, b) => a.depth - b.depth);
  }

  /**
   * Calcule les positions des sprites feuilles pour l'instant `time`.
   * Les quads sont poussés dans `out` (tri ensuite par profondeur).
   */
  computeSprites(time, out) {
    const cur = settings.get('current');
    for (const p of this.items) {
      // Courant local : bruit lent + biais propre à la plante
      const flow = noise.n3(p.x * 0.0016, p.y * 0.0016, time * 0.07 * cur)
                 + 0.4 * noise.n2(time * 0.03 + p.phase, 2.0);
      // Amplitude croît avec la hauteur (les hautes ondulent plus),
      // davantage près de la surface ; normalisée par la hauteur d'écran.
      const ampN = p.sway * cur * (p.h / (p.h + 400)) * 0.9;
      let px = p.x, py = p.y;
      for (let s = 0; s < p.segs; s++) {
        const f = (s + 1) / p.segs;                       // 0..1 le long de la tige
        const segLen = (p.h / p.segs) * 0.92;
        // flexion cumulée : chaque segment hérite de la courbure précédente
        const bend = (flow * 0.55 + Math.sin(time * (0.5 + p.sway * 0.3) + p.phase + s * 0.7) * 0.2)
                   * ampN * f * f + p.curBias * 0.15 * f;
        const ang = -Math.PI / 2 + p.lean * 0.35 + bend * 0.85 + p.lean * f * 0.4;
        px += Math.cos(ang) * segLen;
        py += Math.sin(ang) * segLen;
        // feuille sprite : taille décroît vers la pointe sauf lanières
        const size = p.leafW * (p.sp === 'vallisneria' || p.sp === 'grass'
          ? (1 - f * 0.25) : (p.sp === 'anubias' ? 1 : (0.55 + (1 - f) * 0.6)));
        out.push({
          atlas: 'plants',
          texId: p.texId,
          x: px, y: py,
          size: size * (0.9 + 0.2 * noise.n2(p.phase, s)),
          rot: ang + Math.PI / 2,
          alpha: p.sp === 'grass' ? 0.9 : 1.0,
          tint: [1, 1, 1, 1],
          depth: p.depth,
        });
      }
    }
    return out;
  }
}
