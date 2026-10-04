/* ============================================================
   substrate.js — Substrat : texture de sable/gravier générée en
   Canvas2D (noise + grains multi-tailles), rochers, feuilles mortes,
   débris végétaux, ombres portées. Rendu une seule fois dans une
   texture WebGL, redessinée uniquement au resize.

   La ligne de sol est ondulante (relief naturel), jamais plate.
   ============================================================ */

import { Noise, rng, rand, clamp } from './noise.js';

const noise = new Noise(4242);
const SEED = 777;

/**
 * Génère la texture du substrat sur un canvas hors-écran.
 * @param {number} w largeur px, @param {number} h hauteur px
 * @returns {{canvas: HTMLCanvasElement, groundY: (x:number)=>number}}
 */
export function buildSubstrateTexture(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const r = rng(SEED);

  // --- Ligne de sol ondulante (hauteur relative ~0.86..0.93) ---
  const baseLevel = 0.855;
  const groundY = (x) => {
    const nx = x / w;
    return h * (baseLevel
      + 0.030 * noise.n2(nx * 2.2, 1.7)
      + 0.014 * noise.n2(nx * 6.5, 9.2));
  };

  // --- Corps de sable : dégradé beige profond ---
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 4) ctx.lineTo(x, groundY(x));
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.clip();

  const g = ctx.createLinearGradient(0, h * baseLevel, 0, h);
  g.addColorStop(0, '#b9a37f');
  g.addColorStop(0.35, '#a78e6b');
  g.addColorStop(1, '#6e5a41');
  ctx.fillStyle = g;
  ctx.fillRect(0, h * (baseLevel - 0.06), w, h * 0.16);

  // Ondulations de surface du sable (rides douces)
  for (let i = 0; i < 26; i++) {
    const x0 = rand(r, -50, w + 50);
    const y0 = groundY(x0) + rand(r, 2, h * 0.10);
    const len = rand(r, 60, 260);
    ctx.strokeStyle = `rgba(${150 + r()*40|0},${125 + r()*35|0},90,${rand(r,0.05,0.16)})`;
    ctx.lineWidth = rand(r, 1.5, 5);
    ctx.beginPath();
    for (let s = 0; s <= 1; s += 0.1) {
      const px = x0 + len * s;
      const py = y0 + Math.sin(s * Math.PI * 2 + i) * rand(r, 1.5, 5);
      s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // --- Grains : milliers de points multi-tailles et multi-teintes ---
  const grainCount = Math.floor(w * h * 0.02);
  const tones = [
    [210, 190, 155], [190, 168, 130], [168, 145, 110],
    [225, 210, 180], [150, 130, 100], [120, 105, 82],
  ];
  for (let i = 0; i < grainCount; i++) {
    const x = r() * w;
    const gy = groundY(x);
    const y = gy + Math.pow(r(), 0.7) * (h - gy);
    const t = tones[(r() * tones.length) | 0];
    const v = (r() - 0.5) * 30;
    const sz = r() < 0.92 ? rand(r, 0.6, 1.6) : rand(r, 1.8, 3.4);
    ctx.fillStyle = `rgba(${t[0]+v|0},${t[1]+v|0},${t[2]+v|0},${rand(r,0.12,0.5)})`;
    ctx.fillRect(x, y, sz, sz * rand(r, 0.7, 1.2));
  }

  // --- Cailloux épars (ombres + relief) ---
  for (let i = 0; i < 34; i++) {
    const x = r() * w;
    const y = groundY(x) + rand(r, 4, h * 0.11);
    const rx = rand(r, 3, 14), ry = rx * rand(r, 0.55, 0.8);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rand(r, -0.4, 0.4));
    // ombre douce
    ctx.fillStyle = 'rgba(20,15,8,0.30)';
    ctx.beginPath(); ctx.ellipse(1.5, 2.5, rx, ry * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    const gg = ctx.createRadialGradient(-rx*0.3, -ry*0.4, 1, 0, 0, rx);
    const light = 120 + r() * 70;
    gg.addColorStop(0, `rgb(${light+25|0},${light+15|0},${light})`);
    gg.addColorStop(1, `rgb(${light*0.55|0},${light*0.5|0},${light*0.45|0})`);
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // --- Feuilles mortes & débris végétaux ---
  for (let i = 0; i < 16; i++) {
    const x = r() * w;
    const y = groundY(x) + rand(r, 3, h * 0.09);
    drawDeadLeaf(ctx, x, y, rand(r, 0.5, 1.1), rand(r, -0.6, 0.6), r);
  }
  ctx.restore();

  // --- Ombre générale sous les plantes/racines (bandeau sombre diffus) ---
  ctx.save();
  const sh = ctx.createLinearGradient(0, h * baseLevel - 20, 0, h * baseLevel + 46);
  sh.addColorStop(0, 'rgba(10,18,12,0)');
  sh.addColorStop(0.5, 'rgba(10,18,12,0.35)');
  sh.addColorStop(1, 'rgba(10,18,12,0)');
  ctx.fillStyle = sh;
  ctx.fillRect(0, h * baseLevel - 20, w, 70);
  ctx.restore();

  return { canvas: c, groundY };
}

/** Petite feuille morte brunie, nervure centrale, bords irréguliers. */
function drawDeadLeaf(ctx, x, y, scale, rot, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(scale, scale * rand(r, 0.4, 0.6));
  const hue = rand(r, 18, 38);
  ctx.fillStyle = `hsla(${hue}, 45%, ${rand(r, 18, 30)}%, ${rand(r, 0.5, 0.85)})`;
  ctx.beginPath();
  ctx.moveTo(-10, 0);
  ctx.bezierCurveTo(-4, -7, 6, -6, 12, 0);
  ctx.bezierCurveTo(6, 5, -4, 6, -10, 0);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.7;
  ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(11, 0); ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------
   Grandes racines en bois (driftwood) : courbes épaisses sombres,
   texturées, partiellement enfouies, mousse par endroits.
   ------------------------------------------------------------ */
export function buildDriftwood(w, h, groundY) {
  const r = rng(1234);
  const roots = [];
  const count = 3 + ((w / 1920) | 0);
  for (let i = 0; i < count; i++) {
    const cx = rand(r, 0.08, 0.92) * w;
    const gy = groundY(cx);
    const pts = [];
    let px = cx - rand(r, 60, 200), py = gy + rand(r, -6, 14);
    const segs = 5 + (r() * 3 | 0);
    for (let s = 0; s <= segs; s++) {
      pts.push({ x: px, y: py });
      px += rand(r, 40, 110);
      py += rand(r, -55, 25) - s * 4;
      if (s > 1 && r() < 0.5) py += rand(r, 20, 45); // cassures naturelles
    }
    roots.push({
      pts,
      width: rand(r, 10, 26) * (0.7 + 0.6 * r()),
      mossSeed: r() * 10,
      branches: Array.from({ length: 2 + (r() * 3 | 0) }, () => ({
        at: rand(r, 0.2, 0.85),
        dx: rand(r, -90, 90),
        dy: rand(r, -120, -10),
        w: rand(r, 3, 8),
      })),
    });
  }
  return roots;
}

/** Dessine les racines dans un contexte 2D (pour baking texture). */
export function paintDriftwood(ctx, roots, groundY, layer /* 'back'|'front' */) {
  roots.forEach((root, idx) => {
    const isFront = idx % 2 === 0;
    if ((layer === 'front') !== isFront) return;
    drawRoot(ctx, root);
  });
}

function drawRoot(ctx, root) {
  const { pts, width } = root;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // ombre portée douce
  ctx.strokeStyle = 'rgba(5,10,6,0.4)';
  ctx.lineWidth = width * 1.5;
  strokePath(ctx, pts, 6, 8);

  // corps du bois : dégradé brun très sombre
  const grad = ctx.createLinearGradient(pts[0].x, pts[0].y - 40, pts[pts.length-1].x, pts[pts.length-1].y + 20);
  grad.addColorStop(0, '#4a3826');
  grad.addColorStop(0.5, '#33261a');
  grad.addColorStop(1, '#241a12');
  ctx.strokeStyle = grad;
  ctx.lineWidth = width;
  strokePath(ctx, pts, 0, 0);

  // texture : striures longitudinales (RNG déterministe par souche)
  const tr = rng(root.mossSeed * 7777 | 0);
  ctx.strokeStyle = 'rgba(90,70,48,0.35)';
  for (let k = 0; k < 5; k++) {
    ctx.lineWidth = rand(tr, 0.6, 1.6);
    strokePath(ctx, pts.map(p => ({ x: p.x + (tr()-0.5)*width*0.5,
                                    y: p.y + (tr()-0.5)*width*0.4 })), 0, 0);
  }
  // highlight supérieur
  ctx.strokeStyle = 'rgba(150,120,85,0.18)';
  ctx.lineWidth = Math.max(2, width * 0.22);
  strokePath(ctx, pts.map(p => ({ x: p.x, y: p.y - width * 0.28 })), 0, 0);

  // ramifications
  root.branches.forEach(b => {
    const i = Math.floor(b.at * (pts.length - 1));
    const p = pts[i];
    ctx.strokeStyle = '#2c2016';
    ctx.lineWidth = b.w;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.quadraticCurveTo(p.x + b.dx * 0.4, p.y + b.dy * 0.55, p.x + b.dx, p.y + b.dy);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,95,65,0.2)';
    ctx.lineWidth = Math.max(1, b.w * 0.3);
    ctx.stroke();
  });

  // mousse par endroits (petits amas verts sombres)
  const mr = rng(1000 + root.mossSeed * 100);
  for (let k = 0; k < 14; k++) {
    const i = Math.floor(mr() * (pts.length - 1));
    const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)];
    const tt = mr();
    const mx = p.x + (q.x - p.x) * tt + (mr() - 0.5) * width;
    const my = p.y + (q.y - p.y) * tt - width * 0.3 * mr();
    ctx.fillStyle = `rgba(${30 + mr()*25|0}, ${60 + mr()*40|0}, ${28 + mr()*20|0}, ${rand(mr, 0.25, 0.5)})`;
    ctx.beginPath();
    ctx.arc(mx, my, rand(mr, 2, 6), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function strokePath(ctx, pts, ox, oy) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x + ox, pts[0].y + oy);
  for (let i = 1; i < pts.length - 1; i++) {
    const xc = (pts[i].x + pts[i + 1].x) / 2 + ox;
    const yc = (pts[i].y + pts[i + 1].y) / 2 + oy;
    ctx.quadraticCurveTo(pts[i].x + ox, pts[i].y + oy, xc, yc);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x + ox, last.y + oy);
  ctx.stroke();
}

/* ------------------------------------------------------------
   Rochers naturels : bancs de pierre avec mousses.
   ------------------------------------------------------------ */
export function buildRocks(w, h, groundY) {
  const r = rng(555);
  const rocks = [];
  const clusters = 3;
  for (let c = 0; c < clusters; c++) {
    const cx = rand(r, 0.12, 0.88) * w;
    const n = 2 + (r() * 4 | 0);
    for (let i = 0; i < n; i++) {
      const size = rand(r, 18, 70) * (i === 0 ? 1.5 : 1);
      const x = cx + rand(r, -110, 110);
      const y = groundY(x) + rand(r, -size * 0.35, size * 0.15);
      rocks.push({
        x, y, size,
        squash: rand(r, 0.55, 0.85),
        rot: rand(r, -0.35, 0.35),
        seed: r() * 100,
        gray: rand(r, 92, 150),
        front: r() < 0.4,
      });
    }
  }
  return rocks;
}

export function paintRocks(ctx, rocks, front) {
  rocks.forEach((rk) => {
    if (rk.front !== front) return;
    const r = rng(9000 + rk.seed * 13);
    ctx.save();
    ctx.translate(rk.x, rk.y);
    ctx.rotate(rk.rot);
    // silhouette polygonale irrégulière
    const pts = [];
    const sides = 7 + (r() * 4 | 0);
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const rad = rk.size * rand(r, 0.72, 1.0);
      pts.push([Math.cos(a) * rad, Math.sin(a) * rad * rk.squash]);
    }
    // ombre
    ctx.save();
    ctx.translate(4, 7);
    ctx.fillStyle = 'rgba(6,12,8,0.45)';
    poly(ctx, pts); ctx.fill();
    ctx.restore();
    // corps avec dégradé directionnel (lumière venant d'en haut)
    const gg = ctx.createLinearGradient(0, -rk.size, 0, rk.size * rk.squash);
    const gr = rk.gray;
    gg.addColorStop(0, `rgb(${gr+38|0},${gr+30|0},${gr+18|0})`);
    gg.addColorStop(0.55, `rgb(${gr},${gr-6},${gr-16})`);
    gg.addColorStop(1, `rgb(${gr*0.45|0},${gr*0.45|0},${gr*0.42|0})`);
    ctx.fillStyle = gg;
    poly(ctx, pts); ctx.fill();
    // micro-texture : éclats minéraux
    for (let i = 0; i < 26; i++) {
      const px = rand(r, -rk.size, rk.size), py = rand(r, -rk.size*0.6, rk.size*0.6);
      ctx.fillStyle = `rgba(${r()<0.5?255:0},${r()<0.5?255:0},${r()<0.5?255:0},${rand(r,0.02,0.08)})`;
      ctx.fillRect(px, py, rand(r, 1, 3), rand(r, 1, 2));
    }
    // lichen/mousse sur le dessus
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = `rgba(${40+r()*30|0},${75+r()*45|0},${38+r()*20|0},${rand(r,0.15,0.4)})`;
      ctx.beginPath();
      ctx.arc(rand(r, -rk.size*0.7, rk.size*0.7), -rk.size * rand(r, 0.35, 0.6),
              rand(r, 2, rk.size*0.16), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
}

function poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}
