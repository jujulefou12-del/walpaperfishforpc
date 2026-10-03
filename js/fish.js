/* ============================================================
   fish.js — Poissons tropicaux : textures réalistes + IA de comportement.

   Réalisme prioritaire sur la quantité (consigne n°27). Chaque poisson :
   - est un objet animé indépendant (pas une image qui glisse) ;
   - possède position X/Y/Z, vitesse, direction, accélération, état
     comportemental, taille, profondeur, personnalité ;
   - ondule le corps (bend visuel), inclinaison selon la trajectoire,
     effet de parallaxe Z, teinte atténuée en profondeur.

   États : IDLE, CRUISING, TURN, ACCELERATION, FLEE, SCHOOL, FEEDING, REST.
   Le déplacement est piloté par des forces (steering + damping), jamais
   linéaire ni mécanique.
   ============================================================ */

import { Noise, rng, rand, gauss, clamp, damp } from './noise.js';
import { settings } from './settings.js';

const noise = new Noise(777);

/* ================= ESPÈCES ================= */
/* body: fonction de dessin dans un espace normalisé [-1..1] x [-0.5..0.5],
   pointe de la tête vers +x. Les variantes ajoutent barres/taches. */

const SPECIES = {
  /* Néon cardinal : petit, rouge/bleu-vert naturel, bancs denses */
  cardinal: {
    size: [9, 14], schoolSize: 9, speed: 1.15, agility: 1.4,
    band: true,
    paint(ctx, r) {
      bodyShape(ctx, 1.0, 0.36);
      // flanc bleu-vert iridescent (naturel, pas néon)
      gradStripe(ctx, -0.10, 0.16, ['#284a52', '#3f6d6a', '#274a45'], 0.9);
      // ventre clair
      belly(ctx);
      // bandeau rouge postérieur
      ctx.save();
      clipBody(ctx, 1.0, 0.36);
      const g = ctx.createLinearGradient(0.1, 0, 1.0, 0);
      g.addColorStop(0, 'rgba(120,32,26,0)');
      g.addColorStop(0.25, `rgba(${140+r()*40|0},42,32,0.85)`);
      g.addColorStop(1, 'rgba(96,26,20,0.9)');
      ctx.fillStyle = g;
      ctx.fillRect(0.05, -0.05, 1.0, 0.45);
      ctx.restore();
      eyeSpot(ctx, 0.78, -0.06, 0.075);
      finsBasic(ctx, r, '#31423f');
      tailFork(ctx, r, '#5a322c', 0.5);
    },
  },
  /* Rasbora arlequin : argenté-bronze, triangle sombre */
  rasbora: {
    size: [11, 16], schoolSize: 7, speed: 1.05, agility: 1.3,
    paint(ctx, r) {
      bodyShape(ctx, 1.0, 0.34);
      silverBody(ctx, r, ['#8b8a76', '#b9b8a4', '#77786a']);
      ctx.save();
      clipBody(ctx, 1.0, 0.34);
      // large triangle noir caractéristique
      ctx.fillStyle = 'rgba(28,26,20,0.85)';
      ctx.beginPath();
      ctx.moveTo(-0.25, -0.02);
      ctx.lineTo(0.42, -0.34);
      ctx.lineTo(0.42, 0.06);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      eyeSpot(ctx, 0.74, -0.05, 0.07);
      finsBasic(ctx, r, '#6d6c5c');
      tailFork(ctx, r, '#7d7c6a', 0.55);
    },
  },
  /* Corydoras : poisson de fond, trapu, moustaches, bronze */
  cory: {
    size: [13, 19], schoolSize: 5, speed: 0.55, agility: 0.8, bottom: true,
    paint(ctx, r) {
      bodyShape(ctx, 0.9, 0.5, -0.06);       // dos voûté
      silverBody(ctx, r, ['#7a6a52', '#a99a7e', '#5f5240']);
      ctx.save();
      clipBody(ctx, 0.9, 0.5, -0.06);
      // plaques osseuses : damier subtil
      ctx.fillStyle = 'rgba(60,48,34,0.22)';
      for (let i = -3; i < 4; i++)
        for (let j = -1; j < 3; j++)
          if ((i + j) % 2 === 0)
            ctx.fillRect(i * 0.16 - 0.08, j * 0.13 - 0.16, 0.15, 0.12);
      ctx.restore();
      // barbillons (moustaches)
      ctx.strokeStyle = 'rgba(40,32,22,0.7)';
      ctx.lineWidth = 0.02;
      ctx.beginPath();
      ctx.moveTo(0.42, 0.14); ctx.lineTo(0.58, 0.24);
      ctx.moveTo(0.40, 0.16); ctx.lineTo(0.52, 0.30);
      ctx.stroke();
      eyeSpot(ctx, 0.3, -0.12, 0.06);
      dorsalSpine(ctx, r);
      finsBasic(ctx, r, '#6b5c46', 0.8);
      tailRound(ctx, r, '#6b5c46');
    },
  },
  /* Ancistrus : laveur de verre brun-moucheté, posé près du sol */
  ancistrus: {
    size: [16, 24], schoolSize: 1, speed: 0.35, agility: 0.5, bottom: true, solo: true,
    paint(ctx, r) {
      // corps aplati vu de profil, tête large
      ctx.beginPath();
      ctx.moveTo(0.55, 0.05);
      ctx.bezierCurveTo(0.62, -0.12, 0.4, -0.34, 0.05, -0.36);
      ctx.bezierCurveTo(-0.4, -0.36, -0.62, -0.1, -0.5, 0.12);
      ctx.bezierCurveTo(-0.2, 0.2, 0.3, 0.2, 0.55, 0.05);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, -0.36, 0, 0.2);
      g.addColorStop(0, '#3f3226');
      g.addColorStop(1, '#241c14');
      ctx.fillStyle = g; ctx.fill();
      // mouchetures claires
      ctx.save(); ctx.clip();
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgba(200,180,140,${rand(r, 0.08, 0.3)})`;
        ctx.beginPath();
        ctx.arc(rand(r, -0.55, 0.5), rand(r, -0.34, 0.16), rand(r, 0.01, 0.03), 0, 7);
        ctx.fill();
      }
      ctx.restore();
      // nageoire dorsale dressée
      ctx.fillStyle = 'rgba(45,36,26,0.9)';
      ctx.beginPath();
      ctx.moveTo(-0.1, -0.34);
      ctx.quadraticCurveTo(0.02, -0.62, 0.16, -0.34);
      ctx.closePath(); ctx.fill();
      eyeSpot(ctx, 0.4, -0.16, 0.05);
      // queue éventail
      fanTail(ctx, r, '#33291e');
    },
  },
  /* Ramirezi : petit cichlidé mauve-rouge orangé, couple */
  ramirezii: {
    size: [12, 17], schoolSize: 2, speed: 0.85, agility: 1.0, pair: true,
    paint(ctx, r) {
      bodyShape(ctx, 0.85, 0.52);
      const g = ctx.createLinearGradient(0, -0.5, 0.2, 0.5);
      g.addColorStop(0, '#5d4661');
      g.addColorStop(0.5, `rgb(${150+r()*30|0},${60+r()*20|0},${66})`);
      g.addColorStop(1, '#c88a4a');
      ctx.fillStyle = g;
      pathBody(ctx, 0.85, 0.52);
      ctx.fill();
      ctx.save();
      clipBody(ctx, 0.85, 0.52);
      // point noir latéral + ocelle
      ctx.fillStyle = 'rgba(20,16,14,0.8)';
      ctx.beginPath(); ctx.arc(-0.05, 0.02, 0.07, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(230,170,60,0.55)';
      ctx.beginPath(); ctx.arc(0.18, 0.12, 0.05, 0, 7); ctx.fill();
      shimmer(ctx, r);
      ctx.restore();
      eyeSpot(ctx, 0.6, -0.12, 0.075, '#d8a24a');
      finsBasic(ctx, r, '#7a5a6a', 1.1);
      tailRound(ctx, r, '#8a5a52');
    },
  },
  /* Colisa lalia : gourami nain, corps haut, rayures verticales */
  colisa: {
    size: [12, 17], schoolSize: 1, speed: 0.7, agility: 0.9, solo: true,
    paint(ctx, r) {
      bodyShape(ctx, 0.8, 0.62);
      const g = ctx.createLinearGradient(0, -0.6, 0, 0.6);
      g.addColorStop(0, '#8fae9a');
      g.addColorStop(0.5, '#b7c8ac');
      g.addColorStop(1, '#87734f');
      ctx.fillStyle = g;
      pathBody(ctx, 0.8, 0.62); ctx.fill();
      ctx.save();
      clipBody(ctx, 0.8, 0.62);
      ctx.strokeStyle = 'rgba(140,60,50,0.5)';
      ctx.lineWidth = 0.045;
      for (let i = -2; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 0.16, -0.6); ctx.lineTo(i * 0.16 - 0.06, 0.6);
        ctx.stroke();
      }
      shimmer(ctx, r);
      ctx.restore();
      eyeSpot(ctx, 0.52, -0.16, 0.07);
      // nageoires ventrales filamenteuses orange (gouramis)
      ctx.strokeStyle = 'rgba(200,120,50,0.8)';
      ctx.lineWidth = 0.025;
      ctx.beginPath();
      ctx.moveTo(0.1, 0.3); ctx.quadraticCurveTo(0.0, 0.75, -0.15, 0.85);
      ctx.stroke();
      finsBasic(ctx, r, '#93a58b', 1.0);
      tailRound(ctx, r, '#9aa88e');
    },
  },
};

/* ---------- Primitives de dessin ---------- */
function pathBody(ctx, len, ht, yoff = 0) {
  ctx.beginPath();
  ctx.moveTo(len * 0.62, yoff);                       // museau
  ctx.bezierCurveTo(len * 0.5, yoff - ht * 0.85, -len * 0.1, yoff - ht, -len * 0.55, yoff - ht * 0.32);
  ctx.bezierCurveTo(-len * 0.62, yoff - ht * 0.1, -len * 0.62, yoff + ht * 0.1, -len * 0.55, yoff + ht * 0.32);
  ctx.bezierCurveTo(-len * 0.1, yoff + ht, len * 0.5, yoff + ht * 0.85, len * 0.62, yoff);
  ctx.closePath();
}
function bodyShape(ctx, len, ht, yoff = 0) {
  pathBody(ctx, len, ht, yoff);
  ctx.fillStyle = '#6f7a6a';
  ctx.fill();
}
function clipBody(ctx, len, ht, yoff = 0) {
  pathBody(ctx, len, ht, yoff);
  ctx.clip();
}
function silverBody(ctx, r, tones) {
  const g = ctx.createLinearGradient(0, -0.4, 0, 0.4);
  g.addColorStop(0, tones[0]);
  g.addColorStop(0.45, tones[1]);
  g.addColorStop(1, tones[2]);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  shimmer(ctx, r);
  ctx.restore();
}
function belly(ctx) {
  ctx.save();
  const g = ctx.createLinearGradient(0, 0.05, 0, 0.4);
  g.addColorStop(0, 'rgba(220,225,210,0)');
  g.addColorStop(1, 'rgba(225,228,214,0.75)');
  ctx.fillStyle = g;
  ctx.fillRect(-1, 0.02, 2, 0.5);
  ctx.restore();
}
function gradStripe(ctx, y0, y1, colors, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  colors.forEach((c, i) => g.addColorStop(i / (colors.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(-1, y0, 2, y1 - y0);
  ctx.restore();
}
/** Reflets métalliques : fines lignes diagonales brillantes. */
function shimmer(ctx, r) {
  for (let i = 0; i < 7; i++) {
    ctx.strokeStyle = `rgba(255,255,245,${rand(r, 0.05, 0.16)})`;
    ctx.lineWidth = rand(r, 0.015, 0.04);
    const x = rand(r, -0.4, 0.45);
    ctx.beginPath();
    ctx.moveTo(x, -0.4);
    ctx.quadraticCurveTo(x + 0.08, 0, x - 0.02, 0.4);
    ctx.stroke();
  }
  // écailles : quadrillage discret
  ctx.strokeStyle = 'rgba(30,35,30,0.10)';
  ctx.lineWidth = 0.012;
  for (let row = -3; row <= 3; row++) {
    ctx.beginPath();
    for (let x = -0.5; x <= 0.5; x += 0.09) {
      const y = row * 0.1 + Math.sin(x * 20) * 0.012;
      x === -0.5 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
function eyeSpot(ctx, x, y, rad, iris = '#c9c2a8') {
  // cercle externe sombre
  ctx.fillStyle = 'rgba(15,15,12,0.9)';
  ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
  // iris
  ctx.fillStyle = iris;
  ctx.beginPath(); ctx.arc(x, y, rad * 0.72, 0, 7); ctx.fill();
  // pupille
  ctx.fillStyle = '#0a0a08';
  ctx.beginPath(); ctx.arc(x, y, rad * 0.42, 0, 7); ctx.fill();
  // reflet spéculaire (œil vivant)
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.arc(x - rad * 0.28, y - rad * 0.3, rad * 0.16, 0, 7); ctx.fill();
}
/** Nageoires transparentes : membrane voileuse + rayons. */
function translucentFin(ctx, pts, color, r, rays = 6) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1], p1 = pts[i];
    ctx.quadraticCurveTo((p0[0]+p1[0])/2 + gauss(r)*0.03, (p0[1]+p1[1])/2 + gauss(r)*0.03, p1[0], p1[1]);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.fill();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 0.012;
  const base = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    ctx.beginPath();
    ctx.moveTo(base[0], base[1]);
    ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
function finsBasic(ctx, r, color, scale = 1) {
  // dorsale
  translucentFin(ctx, [[0.28, -0.3], [0.1, -0.55 * scale], [-0.18, -0.42 * scale], [-0.3, -0.2]],
                  color, r, 7);
  // anale
  translucentFin(ctx, [[0.12, 0.3], [-0.05, 0.5 * scale], [-0.3, 0.36]], color, r, 5);
  // pectorale (proche caméra, battante à l'animation)
  ctx.save();
  ctx.translate(0.34, 0.1);
  ctx.rotate(0.5 + gauss(r) * 0.2);
  translucentFin(ctx, [[0, 0], [-0.12, 0.3], [-0.3, 0.22], [-0.16, 0.02]], color, r, 5);
  ctx.restore();
}
function dorsalSpine(ctx, r) {
  translucentFin(ctx, [[0.2, -0.3], [0.05, -0.66], [-0.25, -0.5], [-0.35, -0.28]], '#5c4e3a', r, 8);
}
function tailFork(ctx, r, color, spread) {
  ctx.save();
  ctx.translate(-0.55, 0);
  translucentFin(ctx, [[0.05, 0], [-0.35, -spread], [-0.18, 0], [-0.35, spread]], color, r, 8);
  ctx.restore();
}
function tailRound(ctx, r, color) {
  ctx.save();
  ctx.translate(-0.55, 0);
  translucentFin(ctx, [[0.05, -0.1], [-0.3, -0.32], [-0.4, 0], [-0.3, 0.32], [0.05, 0.1]], color, r, 9);
  ctx.restore();
}
function fanTail(ctx, r, color) {
  ctx.save();
  ctx.translate(-0.5, 0);
  translucentFin(ctx, [[0.02, -0.05], [-0.32, -0.3], [-0.42, -0.05], [-0.3, 0.22], [0.02, 0.1]], color, r, 10);
  ctx.restore();
}

/* ---------- Génération des textures ---------- */
const TEX_W = 192, TEX_H = 96;

/**
 * Construit toutes les textures de poissons.
 * @returns {{ index: Object<string, number[]>, canvases: Map<number, HTMLCanvasElement> }}
 */
export function buildFishTextures(nextTexId) {
  const index = {};
  const canvases = new Map();
  let seed = 1;
  for (const [name, sp] of Object.entries(SPECIES)) {
    index[name] = [];
    for (let v = 0; v < 4; v++) {           // 4 variantes par espèce
      const c = document.createElement('canvas');
      c.width = TEX_W; c.height = TEX_H;
      const ctx = c.getContext('2d');
      ctx.translate(TEX_W * 0.52, TEX_H / 2);
      const s = TEX_H * 0.86;
      ctx.scale(s, s);
      const r = rng(seed++ * 6151 + v * 101);
      sp.paint(ctx, r);
      const id = nextTexId();
      canvases.set(id, c);
      index[name].push(id);
    }
  }
  return { index, canvases };
}

/* ================= COMPORTEMENTS ================= */
export const STATE = {
  IDLE: 'IDLE', CRUISING: 'CRUISING', TURN: 'TURN', ACCEL: 'ACCELERATION',
  FLEE: 'FLEE', SCHOOL: 'SCHOOL', FEEDING: 'FEEDING', REST: 'REST',
};

const PERSONALITY_KEYS = ['boldness', 'curiosity', 'pace'];

export class Fish {
  /**
   * @param {object} opts { species, texId, x,y,z, w,h, groundY, id }
   */
  constructor(opts) {
    const r = rng(opts.id * 7919 + 13);
    this.id = opts.id;
    this.species = opts.species;
    this.def = SPECIES[opts.species];
    this.texId = opts.texId;
    this.w = opts.w; this.h = opts.h;
    this.groundY = opts.groundY;

    // Taille individuelle (±20% d'imperfection naturelle)
    const [sMin, sMax] = this.def.size;
    this.len = rand(r, sMin, sMax) * (opts.h / 1080) * 2.6;

    // Position & profondeur Z (0 = loin, 1 = très proche caméra)
    this.x = opts.x; this.y = opts.y;
    this.z = opts.z;
    this.baseSpeed = rand(r, 26, 40) * this.def.speed;   // px/s à z moyen

    // Vélocité initiale aléatoire
    const a0 = rand(r, 0, Math.PI * 2);
    this.vx = Math.cos(a0) * this.baseSpeed;
    this.vy = Math.sin(a0) * this.baseSpeed * 0.3;

    // Personnalité unique (empêche deux poissons identiques)
    this.boldness = r();
    this.curiosity = r();
    this.pace = rand(r, 0.8, 1.25);
    this.phase = r() * 100;
    this.tailFreq = rand(r, 4.2, 6.0);

    // État comportemental
    this.state = STATE.CRUISING;
    this.stateT = 0;
    this.nextChange = rand(r, 4, 12);
    this.targetAngle = Math.atan2(this.vy, this.vx);
    this.school = null;              // référence au banc
    this.foodTarget = null;          // particule de nourriture visée
    this.fleeTimer = 0;
    this.startle = 0;                // 0..1 excitation (accélère puis retombe)

    // Préférence verticale selon espèce [yHaut, yBas]
    if (this.def.bottom) {
      this.yBand = [this.groundY(opts.x) - this.h * 0.14, this.groundY(opts.x) - this.len * 0.5];
    } else if (opts.species === 'colisa' || opts.species === 'cardinal') {
      this.yBand = [this.h * 0.12, this.h * 0.55];
    } else {
      this.yBand = [this.h * 0.18, this.groundY(opts.x) - this.h * 0.12];
    }
  }

  /* ---------- Réorganisation après resize (positions à l'échelle) ---------- */
  rescale(sx, sy, newGroundY) {
    this.x *= sx; this.y *= sy;
    this.w = this.w; // géré par le caller via updateSize
    this.groundY = newGroundY;
    if (this.def.bottom) {
      this.yBand = [newGroundY(this.x) - this.h * 0.14, newGroundY(this.x) - this.len * 0.5];
    }
  }

  /* ---------- Détection curseur (interaction.js appelle ceci) ---------- */
  senseMouse(mx, my, enabled) {
    if (!enabled) { this.mouseDist = Infinity; return; }
    const dx = this.x - mx, dy = this.y - my;
    this.mouseDist = Math.hypot(dx, dy);
    this.mouseAng = Math.atan2(dy, dx);
  }

  /* ---------- Mise à jour principale ---------- */
  update(dt, time, fishes, foods) {
    this.stateT += dt;
    const speedMul = settings.get('fishSpeed') * this.pace;
    const cur = settings.get('current');

    // Courant : dérive douce + turbulence organique
    const turbX = noise.n3(this.x * 0.002, this.y * 0.002, time * 0.15) * 14 * cur;
    const turbY = noise.n3(this.x * 0.002 + 40, this.y * 0.002, time * 0.13) * 8 * cur;

    /* --- Machine à états --- */
    const md = this.mouseDist ?? Infinity;
    const mouseOn = settings.get('mouse');

    if (mouseOn && md < 80) {
      // Fuite même pour les solitaires : réflexe de tout poisson vivant
      this.enterState(STATE.FLEE);
    } else if (foods && foods.length) {
      // FEEDING : vise la particule comestible la plus proche
      let best = null, bd = 1e9;
      for (const f of foods) {
        if (f.eaten) continue;
        const d = Math.hypot(f.x - this.x, f.y - this.y);
        if (d < bd) { bd = d; best = f; }
      }
      if (best && bd < 320 * (0.6 + this.curiosity)) {
        this.foodTarget = best;
        this.enterState(STATE.FEEDING);
      } else if (this.state !== STATE.CRUISING && this.stateT > this.nextChange) {
        this.pickNextState(time);
      }
    } else if (this.stateT > this.nextChange) {
      this.pickNextState(time);
    }

    /* --- Forces directrices selon l'état --- */
    let desiredVx = this.vx, desiredVy = this.vy;
    let speedTarget = this.baseSpeed * speedMul;

    switch (this.state) {
      case STATE.IDLE:
        speedTarget *= 0.35;
        desiredVy += Math.sin(time * 0.6 + this.phase) * 4;
        break;

      case STATE.CRUISING:
        // légère oscillation verticale naturelle (pas de ligne droite)
        desiredVy = Math.sin(time * 0.35 + this.phase) * this.baseSpeed * 0.22;
        break;

      case STATE.TURN: {
        const prog = clamp(this.stateT / 1.6, 0, 1);
        const da = wrapAngle(this.targetAngle - Math.atan2(this.vy, this.vx));
        const ang = Math.atan2(this.vy, this.vx) + da * smoothTurn(prog);
        speedTarget *= 0.7 + 0.3 * Math.sin(prog * Math.PI);
        desiredVx = Math.cos(ang) * speedTarget;
        desiredVy = Math.sin(ang) * speedTarget;
        if (prog >= 1) this.enterState(STATE.CRUISING);
        break;
      }

      case STATE.ACCEL:
        speedTarget *= 2.1;
        break;

      case STATE.FLEE: {
        speedTarget *= this.def.speed * 3.4 * (0.7 + this.boldness * 0.1);
        // fuite : opposé au curseur ; les poissons de fond longent le sol,
        // les pélagiques plongent légèrement s'ils sont près de la surface
        const away = this.mouseAng ?? 0;
        let avx = Math.cos(away), avy = Math.sin(away) * 0.7;
        if (this.def.bottom) { avy = 0; avx = Math.abs(avx) > 0.2 ? Math.sign(avx) : (Math.random() < 0.5 ? -1 : 1); }
        else if (this.y < this.h * 0.2) avy += 0.8;
        desiredVx = avx * speedTarget;
        desiredVy = avy * speedTarget + 12;
        this.fleeTimer = 0.9;
        break;
      }

      case STATE.SCHOOL: {
        const sc = this.school;
        if (sc && sc.leader && sc.leader !== this) {
          const lx = sc.leader.x + sc.offset[this.id]?.dx ?? sc.leader.x;
          const ly = sc.leader.y + sc.offset[this.id]?.dy ?? sc.leader.y;
          const d = Math.hypot(lx - this.x, ly - this.y);
          const ang = Math.atan2(ly - this.y, lx - this.x);
          const k = clamp(d / 120, 0, 1);
          desiredVx = lerp(Math.cos(sc.leader.heading) * speedTarget, Math.cos(ang) * speedTarget * 1.15, k);
          desiredVy = lerp(Math.sin(sc.leader.heading) * speedTarget, Math.sin(ang) * speedTarget, k);
          speedTarget *= 1 + clamp(d / 300, 0, 0.5);
        } else this.enterState(STATE.CRUISING);
        break;
      }

      case STATE.FEEDING: {
        const f = this.foodTarget;
        if (!f || f.eaten || f.y > this.groundY(this.x) - 6) {
          this.foodTarget = null;
          this.enterState(STATE.CRUISING);
          break;
        }
        const d = Math.hypot(f.x - this.x, f.y - this.y);
        const ang = Math.atan2(f.y - this.y, f.x - this.x);
        // accélère vers la nourriture puis ralentit à l'approche (précision)
        const approach = d > 60 ? 2.0 : clamp(d / 60, 0.15, 1) * 2.0;
        speedTarget = this.baseSpeed * speedMul * approach * 1.6;
        desiredVx = Math.cos(ang) * speedTarget;
        desiredVy = Math.sin(ang) * speedTarget;
        if (d < this.len * 0.5) { f.eaten = true; this.enterState(STATE.ACCEL); this.stateT = -0.4; }
        break;
      }

      case STATE.REST:
        speedTarget *= 0.12;
        desiredVy += Math.sin(time * 0.3 + this.phase) * 2;
        break;
    }

    // Fin de sursaut : retour progressif au calme
    if (this.fleeTimer > 0) this.fleeTimer -= dt;
    else if (this.state === STATE.FLEE) this.enterState(STATE.ACCEL);
    if (this.state === STATE.ACCEL && this.stateT > rand(0.5, 1, 1)) this.enterState(STATE.CRUISING);

    // Répulsion douce hors de la bande verticale préférée de l'espèce
    const [bandLo, bandHi] = this.yBand;   // lo = haut (petit y), hi = bas
    if (this.state !== STATE.FEEDING && this.state !== STATE.FLEE) {
      if (this.y < bandLo) desiredVy += (bandLo - this.y) * 0.9;
      if (this.y > bandHi) desiredVy -= (this.y - bandHi) * 0.9;
    }

    /* --- Répulsion des bords (zone tampon, jamais de rebond net) --- */
    const margin = this.w * 0.10;
    if (this.x < margin) desiredVx += (margin - this.x) * 2.2;
    if (this.x > this.w - margin) desiredVx -= (this.x - (this.w - margin)) * 2.2;
    const topLimit = this.h * 0.075, botLimit = this.groundY(this.x) - this.len * 0.7;
    if (this.y < topLimit) desiredVy += (topLimit - this.y) * 3.0;
    if (this.y > botLimit) desiredVy -= (this.y - botLimit) * 3.4;

    /* --- Répulsion entre poissons (éviter les chevauchements) --- */
    for (const other of fishes) {
      if (other === this) continue;
      const dx = this.x - other.x, dy = this.y - other.y;
      const d2 = dx * dx + dy * dy;
      const minD = (this.len + other.len) * 0.55;
      if (d2 < minD * minD && d2 > 1) {
        const d = Math.sqrt(d2);
        const push = (minD - d) * 3.0;
        desiredVx += (dx / d) * push;
        desiredVy += (dy / d) * push;
      }
    }

    /* --- Application des forces : acceleration/damping naturels --- */
    const responsiveness = (this.def.agility ?? 1) * (this.state === STATE.FLEE ? 9 : 2.2);
    this.vx = damp(this.vx, desiredVx + turbX, responsiveness, dt);
    this.vy = damp(this.vy, desiredVy + turbY, responsiveness, dt);

    // Limitation de vitesse (plafond dépend de l'état)
    const vmax = speedTarget * 1.15 + 10;
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > vmax) { this.vx *= vmax / sp; this.vy *= vmax / sp; }

    // Intégration position
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Profondeur Z : dérive lente (le poisson "change de voie" en 3D)
    this.z = clamp(this.z + noise.n2(time * 0.05 + this.phase, this.id) * dt * 0.02, 0.05, 1);

    // Garde-fou dur (hors écran → retour doux progressif)
    if (this.x < -60) this.x = -60;
    if (this.x > this.w + 60) this.x = this.w + 60;
    if (this.y < 10) this.y = 10;
    const gy = this.groundY(clamp(this.x, 0, this.w));
    if (this.y > gy - this.len * 0.35) this.y = gy - this.len * 0.35;
  }

  enterState(s) {
    if (this.state === s) return;
    this.state = s;
    this.stateT = 0;
    if (s === STATE.TURN) {
      const maxTurn = rand(0.5, 1, 2.4) * (0.5 + this.boldness);
      const cur = Math.atan2(this.vy, this.vx);
      this.targetAngle = cur + (Math.random() < 0.5 ? maxTurn : -maxTurn);
    }
    if (s === STATE.ACCEL) this.accelDir = Math.atan2(this.vy, this.vx);
    this.nextChange = rand(0.5, 4, 14) * (s === STATE.REST ? 2.2 : 1);
  }

  pickNextState(time) {
    const roll = Math.random();
    const r = roll;
    if (this.school && r < 0.42) this.enterState(STATE.SCHOOL);
    else if (r < 0.12) this.enterState(STATE.IDLE);
    else if (r < 0.18) this.enterState(STATE.REST);
    else if (r < 0.42) this.enterState(STATE.TURN);
    else if (r < 0.55) this.enterState(STATE.ACCEL);
    else this.enterState(STATE.CRUISING);
    this.nextChange = rand(0.5, 3.5, 11);
  }

  /** Données de rendu pour le sprite shader. */
  renderData(time) {
    const heading = Math.atan2(this.vy, this.vx);
    const sp = Math.hypot(this.vx, this.vy);
    // ondulation du corps : fréquence ∝ vitesse (natation réaliste)
    const wiggle = Math.sin(time * this.tailFreq * (0.4 + sp / this.baseSpeed) + this.phase);
    // bend visuel : léger lacet du aux battements
    const rot = heading + wiggle * 0.05;
    const facingLeft = Math.abs(normalizeRad(heading)) > Math.PI / 2;
    // échelle profondeur : z=0 loin (petit, terne) → z=1 proche (grand)
    const depthScale = 0.62 + this.z * 0.62;
    const size = this.len * depthScale;
    // voile de distance : loin = désaturé vers le bleu-vert de l'eau
    const veil = clamp((0.55 - this.z) * 1.3, 0, 0.5);
    const tintR = 1 - veil * 0.55, tintG = 1 - veil * 0.25, tintB = 1 - veil * 0.05;
    const alpha = 1 - veil * 0.25;
    // parallaxe : les poissons éloignés sont décalés vers le centre-fond
    return {
      atlas: 'fish',
      texId: this.texId,
      x: this.x, y: this.y,
      size,
      rot,
      flipY: facingLeft,
      alpha,
      tint: [tintR, tintG, tintB, alpha],
      depth: this.z,
      wiggle,
    };
  }
}

/* ---------- utilitaires ---------- */
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function normalizeRad(a) { return wrapAngle(a); }
function smoothTurn(t) { return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }

/* ---------- Gestion des bancs ---------- */
export class Schools {
  constructor() { this.list = []; }

  /** Forme les bancs à partir de la population (par espèce grégaire). */
  assign(fishes) {
    this.list = [];
    const bySpecies = {};
    for (const f of fishes) {
      if (f.def.solo) continue;
      (bySpecies[f.species] ||= []).push(f);
    }
    for (const [sp, arr] of Object.entries(bySpecies)) {
      const def = SPECIES[sp];
      const need = def.schoolSize || 1;
      for (let i = 0; i + need <= arr.length; i += need) {
        const members = arr.slice(i, i + need);
        const school = {
          species: sp,
          leader: members[0],
          members,
          offset: {},
          wanderPhase: Math.random() * 100,
        };
        members.forEach((m, k) => {
          m.school = school;
          school.offset[m.id] = {
            dx: (k === 0 ? 0 : rand(() => Math.random(), -70, 70) - 30),
            dy: (k === 0 ? 0 : rand(() => Math.random(), -40, 40)),
          };
        });
        this.list.push(school);
      }
    }
  }

  /** Le meneur choisit une trajectoire errante ; les membres suivent (état SCHOOL). */
  update(dt, time) {
    for (const s of this.list) {
      const L = s.leader;
      s.wanderPhase += dt * 0.15;
      // cap du meneur piloté par bruit → banc cohérent mais jamais rigide
      const wa = noise.n2(s.wanderPhase, time * 0.02) * Math.PI * 1.4;
      const curH = Math.atan2(L.vy, L.vx);
      if (L.state === STATE.FLEE || L.state === STATE.FEEDING) {
        L.heading = curH;                 // le meneur a autre chose à faire
      } else {
        L.heading = curH + wrapAngle(wa - curH) * clamp(dt * 0.6, 0, 0.12);
        // léger rappel du meneur vers son cap d'errance
        const dh = wrapAngle(L.heading - curH);
        L.vy += Math.sin(curH + dh) * Math.abs(dh) * 40 * dt;
      }
      // les membres restent en SCHOOL tant que proches du meneur
      for (const m of s.members) {
        if (m === L) continue;
        const d = Math.hypot(m.x - L.x, m.y - L.y);
        if (d > 260 && m.state !== STATE.FLEE && m.state !== STATE.FEEDING) {
          m.enterState(STATE.SCHOOL);
        }
      }
    }
  }
}

export { SPECIES };
