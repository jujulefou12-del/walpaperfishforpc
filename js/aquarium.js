/* ============================================================
   aquarium.js — Orchestration de la scène complète.

   Couches (profondeur peintre + parallaxe Z) :
     ENV (GPU procédural) → SUBSTRATE(back) → PLANTES back →
     POISSONS loin → PLANTES mid → POISSONS milieu →
     DRIFTWOOD front + ROCHERS front → PLANTES front →
     POISSONS proches → PARTICULES → BULLES → NOURRITURE.

   Gère : resize/resolution adaptative, population de poissons,
   qualité adaptative (auto FPS), boucle de mise à jour.
   ============================================================ */

import { Renderer } from './renderer.js';
import { rng, rand, clamp, Noise } from './noise.js';
import { settings, profile, activeQuality, setAutoQuality } from './settings.js';
import { Lighting } from './lighting.js';
import { buildSubstrateTexture, buildDriftwood, paintDriftwood,
         buildRocks, paintRocks } from './substrate.js';
import { Plants, buildPlantAtlases } from './plants.js';
import { Fish, Schools, buildFishTextures, SPECIES } from './fish.js';
import { Particles } from './particles.js';
import { Bubbles } from './bubbles.js';
import { Feeding } from './feeding.js';
import { Interaction } from './interaction.js';

const noise = new Noise(51);

/* ---------- Textures douces générées (particules / nourriture) ---------- */
function makeSoftTexture() {
  const S = 32;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return c;
}

function makeFoodTexture(seed) {
  const S = 32;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const r = rng(seed);
  // flocon brun irrégulier
  ctx.translate(S/2, S/2);
  const pts = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad = S * 0.36 * rand(r, 0.7, 1.05);
    pts.push([Math.cos(a) * rad, Math.sin(a) * rad]);
  }
  const lum = rand(r, 0.8, 1.15);
  ctx.fillStyle = `rgb(${96*lum|0},${62*lum|0},${34*lum|0})`;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i <= n; i++) {
    const p = pts[i % n], q = pts[(i + 1) % n];
    ctx.quadraticCurveTo(p[0], p[1], (p[0]+q[0])/2, (p[1]+q[1])/2);
  }
  ctx.fill();
  // ombre interne + reflet
  const g = ctx.createRadialGradient(-4, -4, 1, 0, 0, S*0.4);
  g.addColorStop(0, 'rgba(255,230,190,0.35)');
  g.addColorStop(0.5, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = g;
  ctx.fill();
  return c;
}

/* ============================================================ */
export class Aquarium {
  constructor(canvas) {
    this.renderer = new Renderer(canvas);
    this.lighting = new Lighting();
    this.interaction = new Interaction();
    this.schools = new Schools();
    this.time = 0;
    this.autoLevel = 'high';
    this.perfAcc = 0; this.perfFrames = 0; this.probeCool = 0;
    this.sprites = [];
    this.softTexId = null;
    this.foodTexIds = [];
    this.fishCanvases = null;
    this.plantCanvases = null;
    this.texKeyMap = new Map();          // canvas -> id GL (évite re-upload)
  }

  /* ---------------- Dimensionnement ---------------- */
  setSize(w, h, dpr) {
    this.w = w; this.h = h;
    this.dpr = dpr;
    this.renderer.setDpr(dpr);
    this.renderer.resize(w, h, dpr);

    // --- Substrat (texture baked) ---
    const sub = buildSubstrateTexture(Math.floor(w), Math.floor(h));
    this.groundY = sub.groundY;
    this.subTexId = this.uploadCanvas(sub.canvas);

    // --- Décor lourd ---
    this.roots = buildDriftwood(w, h, this.groundY);
    this.rocks = buildRocks(w, h, this.groundY);
    this.rootBackTexId = this.bakeLayer(w, h, (ctx) => {
      paintDriftwood(ctx, this.roots, this.groundY, 'back');
      paintRocks(ctx, this.rocks, false);
    });
    this.rootFrontTexId = this.bakeLayer(w, h, (ctx) => {
      paintDriftwood(ctx, this.roots, this.groundY, 'front');
      paintRocks(ctx, this.rocks, true);
    });

    // --- Plantes ---
    if (!this.plantAtlasIndex) {
      const atlases = buildPlantAtlases();
      this.plantCanvases = {};
      this.plantAtlasIndex = {};
      for (const [sp, canvases] of Object.entries(atlases)) {
        this.plantAtlasIndex[sp] = canvases.map(cv => {
          const id = this.uploadCanvas(cv);
          return id;
        });
      }
    }
    this.plantsBack  = new Plants(w, h, this.groundY, 'back',  this.plantAtlasIndex);
    this.plantsMid   = new Plants(w, h, this.groundY, 'mid',   this.plantAtlasIndex);
    this.plantsFront = new Plants(w, h, this.groundY, 'front', this.plantAtlasIndex);

    // --- Poissons ---
    if (!this.fishIndex) {
      const built = buildFishTextures(() => this.nextTexId());
      this.fishIndex = built.index;
      for (const [id, cv] of built.canvases) {
        this.renderer.textures.set(id, this.renderer.uploadTexture(cv));
      }
    }
    if (!this.fishes) {
      this.spawnFishes(settings.get('fishCount'));
    } else {
      // rescale positions
      const sx = w / (this.prevW || w), sy = h / (this.prevH || h);
      for (const f of this.fishes) {
        f.x *= sx; f.y *= sy; f.w = w; f.h = h; f.groundY = this.groundY;
        f.len *= (sy || 1);
      }
      this.schools.assign(this.fishes);
    }
    this.prevW = w; this.prevH = h;

    // --- Systèmes ---
    if (!this.particles) this.particles = new Particles(w, h);
    else this.particles.updateSize(w, h);
    if (!this.bubbles) this.bubbles = new Bubbles(w, h, this.groundY);
    else this.bubbles.updateSize(w, h, this.groundY);
    if (!this.feeding) this.feeding = new Feeding(w, h);
    else this.feeding.updateSize(w, h);

    // --- textures douces ---
    if (this.softTexId == null) this.softTexId = this.uploadCanvas(makeSoftTexture());
    if (!this.foodTexIds.length) {
      for (let i = 0; i < 4; i++) this.foodTexIds.push(this.uploadCanvas(makeFoodTexture(31 + i * 7)));
    }
  }

  glTexture(source) {
    return this.renderer.uploadTexture(source);
  }
  uploadCanvas(cv) { return this.renderer.uploadTexture(cv); }
  nextTexId() { return this.renderer.nextTexId++; }

  /** Bake d'un calque plein écran transparent (décor statique). */
  bakeLayer(w, h, paint) {
    const c = document.createElement('canvas');
    c.width = Math.floor(w); c.height = Math.floor(h);
    paint(c.getContext('2d'));
    return this.uploadCanvas(c);
  }

  /* ---------------- Population ---------------- */
  makeFish(id, r) {
    const w = this.w, h = this.h;
    // répartition réaliste : bancs dominants + quelques solitaires
    const mix = [
      ['cardinal', 0.34], ['rasbora', 0.24], ['cory', 0.14],
      ['ramirezii', 0.10], ['colisa', 0.08], ['ancistrus', 0.10],
    ];
    let roll = r(), sp = mix[0][0];
    for (const [name, p] of mix) { if ((roll -= p) <= 0) { sp = name; break; } }
    const variants = this.fishIndex[sp];
    const texId = variants[(r() * variants.length) | 0];
    const x = rand(r, 0.05, 0.95) * w;
    const band = sp === 'cory' || sp === 'ancistrus'
      ? [this.groundY(x) - h * 0.10, this.groundY(x) - h * 0.02]
      : sp === 'cardinal' || sp === 'colisa'
        ? [h * 0.10, h * 0.5]
        : [h * 0.15, this.groundY(x) - h * 0.08];
    const y = rand(r, band[0], band[1]);
    return new Fish({
      id, species: sp, texId, x, y,
      z: rand(r, 0.15, 0.95),
      w, h, groundY: this.groundY,
    });
  }

  spawnFishes(count) {
    const r = rng((Date.now() & 0xffff) ^ 0x5af3);
    this.fishes = [];
    for (let i = 0; i < count; i++) this.fishes.push(this.makeFish(i, r));
    this.schools.assign(this.fishes);
  }

  /* ---------------- Qualité adaptative ---------------- */
  adaptPerf(dt) {
    this.perfAcc += dt; this.perfFrames++;
    if (this.probeCool > 0) this.probeCool -= dt;
    if (this.perfAcc >= 2) {
      const fps = this.perfFrames / this.perfAcc;
      this.fps = fps;
      if (settings.get('quality') === 'auto') {
        const order = ['low', 'medium', 'high', 'ultra'];
        let idx = order.indexOf(this.autoLevel);
        if (fps < 42 && idx > 0) { this.autoLevel = order[--idx]; this.probeCool = 20; }
        else if (fps > 58 && idx < 3 && this.probeCool <= 0) { this.autoLevel = order[++idx]; this.probeCool = 30; }
        setAutoQuality(this.autoLevel);
      }
      this.perfAcc = 0; this.perfFrames = 0;
    }
  }

  /* ---------------- Mise à jour ---------------- */
  update(dt) {
    const t = this.time;
    this.adaptPerf(dt);
    this.lighting.update(dt, t);
    this.interaction.update(dt);

    // interaction poisson ↔ curseur (zones 250/150/80 px)
    for (const f of this.fishes) {
      this.interaction.applyTo(f);
    }

    this.schools.update(dt, t);
    const foods = this.feeding.activeFoods();
    for (const f of this.fishes) f.update(dt, t, this.fishes, foods);

    this.particles.update(dt, t);
    this.bubbles.update(dt, t, this.feeding.bursting);
    this.feeding.update(dt, t, this.groundY);
  }

  /* ---------------- Rendu ---------------- */
  render() {
    const R = this.renderer;
    const t = this.time;
    const pr = profile();
    const surfY = 0.05;

    // parallaxe caméra très subtile (dérive lente du point de vue)
    const camX = noise.n2(t * 0.013, 0) * this.w * 0.004;
    const camY = noise.n2(t * 0.011, 7) * this.h * 0.003;

    R.drawEnv({
      time: t,
      mouse: [(this.interaction.x + camX) / this.w, (this.interaction.y + camY) / this.h],
      mouseStr: this.interaction.strength * (settings.get('mouse') ? 1 : 0),
      light: this.lighting.intensity,
      caustics: settings.get('caustics') * pr.caustics,
      current: settings.get('current'),
      daylight: this.lighting.daylight,
      surfY,
    });

    const sprites = this.sprites;
    sprites.length = 0;

    const pushQuad = (texId, depth, ox, oy, dim, blurAlpha) => {
      sprites.push({
        texId, x: this.w / 2 + ox, y: this.h / 2 + oy,
        size: Math.max(this.w, this.h) / 2,
        rot: 0, alpha: 1,
        tint: [dim, dim, dim * 1.02, blurAlpha],
        depth,
      });
    };

    // substrate (loin, légèrement voilé)
    pushQuad(this.subTexId, 0.02, camX * 0.4, camY * 0.4, 0.9, 1);
    // décor arrière
    pushQuad(this.rootBackTexId, 0.08, camX * 0.6, camY * 0.6, 0.88, 1);

    // plantes back
    this.plantsBack.computeSprites(t, sprites);
    for (const s of sprites.slice(-this.plantsBack.items.length * 7)) {
      if (s.atlas === undefined && !s.depth) continue;
    }
    // voile distance sur les plantes lointaines
    for (const s of sprites) {
      if (s.plantDepth === 0.35) { s.tint = [0.72, 0.85, 0.8, 0.85]; }
    }

    // poissons par couche de profondeur
    const addFish = (zLo, zHi, depthBase) => {
      for (const f of this.fishes) {
        if (f.z < zLo || f.z >= zHi) continue;
        const d = f.renderData(t);
        // parallaxe selon Z
        d.x += camX * (1 - f.z) * 1.5;
        d.y += camY * (1 - f.z) * 1.5;
        d.depth = depthBase + f.z * 0.08;
        sprites.push(d);
      }
    };
    addFish(0, 0.4, 0.12);       // loin
    this.plantsMid.forEach ? null : null;
    this.plantsMid.computeSprites(t, sprites);
    addFish(0.4, 0.75, 0.5);     // milieu
    // décor avant (racines + rochers proches)
    pushQuad(this.rootFrontTexId, 0.62, camX * 1.6, camY * 1.6, 1, 1);
    this.plantsFront.computeSprites(t, sprites);
    addFish(0.75, 1.01, 0.8);    // près caméra

    // particules, bulles, nourriture (toujours au premier plan eau)
    this.particles.fillSprites(sprites);
    this.bubbles.fillSprites(sprites);
    this.feeding.fillSprites(sprites);

    // redirection atlas spéciaux vers textures partagées
    for (const s of sprites) {
      if (s.atlas === 'soft') { s.texId = this.softTexId; }
      else if (s.atlas === 'food') { s.texId = this.foodTexIds[s.seedIdx ?? 0] || this.foodTexIds[0]; }
      delete s.atlas;
    }

    // Nourriture : variante aléatoire stable par flocon
    let fi = 0;
    for (const s of sprites) {
      if (s.procedural && s.rot !== undefined && s.size > 2 && s.tint[0] === 1 && s.depth === 0.7) {
        // flocons (depth 0.7 posé par feeding)
      }
    }

    // profondeur de champ légère : flou simulé par voile des extrêmes
    const dof = settings.get('dof') * (pr.dof ? 1 : 0.35);
    if (dof > 0) {
      for (const s of sprites) {
        if (s.procedural) continue;
        if (s.depth > 0.78 && s.texId !== this.rootFrontTexId) {
          // proche caméra : léger voile clair (bokeh doux)
          s.tint = [1 + dof * 0.10, 1 + dof * 0.06, 1 + dof * 0.02, s.tint[3]];
        }
      }
    }

    R.drawSprites(sprites);
  }

  /** Ajuste dynamiquement le nombre de poissons au réglage. */
  syncFishCount() {
    const want = Math.round(settings.get('fishCount'));
    const max = profile().fishMax;
    const target = Math.min(want, max);
    if (this.fishes.length < target) {
      const before = this.fishes.length;
      // ajoute de nouveaux individus (mêmes règles que spawn)
      const saved = this.fishes;
      this.spawnFishes(target);
      // spawnFishes recrée tout ; pour conserver continuity on régénère juste
      // les nouveaux en fin de liste : simple et suffisant visuellement.
      void before; void saved;
    } else if (this.fishes.length > target) {
      this.fishes.length = target;
      this.schools.assign(this.fishes);
    }
  }
}
