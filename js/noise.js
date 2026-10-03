/* ============================================================
   noise.js — Bruit procédural (Simplex 2D/3D + FBM) et RNG déterministe.
   Utilisé pour : courants, oscillation des plantes, caustiques,
   comportements de poissons, placement du décor.
   ============================================================ */

/** PRNG mulberry32 : reproductible via graine (décors stables). */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random dans un intervalle. */
export const rand = (r, min, max) => min + r() * (max - min);

/** Tirage gaussien approximatif (moyenne de 3 uniformes), centré 0. */
export function gauss(r) {
  return (r() + r() + r()) / 1.5 - 1;
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

const grad3 = [
  [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
  [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
  [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]
];

/**
 * Simplex noise 2D/3D classique (Gustavson), permutation mélangée
 * avec une graine pour que chaque instance soit unique mais stable.
 */
export class Noise {
  constructor(seed = 1337) {
    const r = rng(seed);
    this.p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) this.p[i] = i;
    for (let i = 255; i > 0; i--) {           // Fisher-Yates
      const j = Math.floor(r() * (i + 1));
      const t = this.p[i]; this.p[i] = this.p[j]; this.p[j] = t;
    }
    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = this.p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  /** Bruit simplex 2D, retourne ~[-1, 1]. */
  n2(xin, yin) {
    const { perm, permMod12 } = this;
    let n0 = 0, n1 = 0, n2 = 0;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const gi0 = permMod12[ii + perm[jj]];
      t0 *= t0;
      n0 = t0 * t0 * (grad3[gi0][0] * x0 + grad3[gi0][1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const gi1 = permMod12[ii + i1 + perm[jj + j1]];
      t1 *= t1;
      n1 = t1 * t1 * (grad3[gi1][0] * x1 + grad3[gi1][1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const gi2 = permMod12[ii + 1 + perm[jj + 1]];
      t2 *= t2;
      n2 = t2 * t2 * (grad3[gi2][0] * x2 + grad3[gi2][1] * y2);
    }
    return 70 * (n0 + n1 + n2);
  }

  /** Bruit simplex 3D (pour caustiques animées, courant volumétrique). */
  n3(xin, yin, zin) {
    const { perm, permMod12 } = this;
    let n0 = 0, n1 = 0, n2 = 0, n3 = 0;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0)      { i1=1;j1=0;k1=0; i2=1;j2=1;k2=0; }
      else if (x0 >= z0) { i1=1;j1=0;k1=0; i2=1;j2=0;k2=1; }
      else               { i1=0;j1=0;k1=1; i2=1;j2=0;k2=1; }
    } else {
      if (y0 < z0)       { i1=0;j1=0;k1=1; i2=0;j2=1;k2=1; }
      else if (x0 < z0)  { i1=0;j1=1;k1=0; i2=0;j2=1;k2=1; }
      else               { i1=0;j1=1;k1=0; i2=1;j2=1;k2=0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2*G3, y2 = y0 - j2 + 2*G3, z2 = z0 - k2 + 2*G3;
    const x3 = x0 - 1 + 3*G3, y3 = y0 - 1 + 3*G3, z3 = z0 - 1 + 3*G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
    if (t0 >= 0) {
      const gi = permMod12[ii + perm[jj + perm[kk]]];
      t0 *= t0; n0 = t0*t0*(grad3[gi][0]*x0 + grad3[gi][1]*y0 + grad3[gi][2]*z0);
    }
    let tt1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
    if (tt1 >= 0) {
      const gi = permMod12[ii+i1 + perm[jj+j1 + perm[kk+k1]]];
      tt1 *= tt1; n1 = tt1*tt1*(grad3[gi][0]*x1 + grad3[gi][1]*y1 + grad3[gi][2]*z1);
    }
    let tt2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
    if (tt2 >= 0) {
      const gi = permMod12[ii+i2 + perm[jj+j2 + perm[kk+k2]]];
      tt2 *= tt2; n2 = tt2*tt2*(grad3[gi][0]*x2 + grad3[gi][1]*y2 + grad3[gi][2]*z2);
    }
    let tt3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
    if (tt3 >= 0) {
      const gi = permMod12[ii+1 + perm[jj+1 + perm[kk+1]]];
      tt3 *= tt3; n3 = tt3*tt3*(grad3[gi][0]*x3 + grad3[gi][1]*y3 + grad3[gi][2]*z3);
    }
    return 32 * (n0 + n1 + n2 + n3);
  }

  /** Fractional Brownian Motion 2D : superposition d'octaves. */
  fbm2(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 0.5, freq = 1, sum = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.n2(x * freq, y * freq);
      freq *= lacunarity;
      amp *= gain;
    }
    return sum;
  }

  fbm3(x, y, z, octaves = 3, lacunarity = 2, gain = 0.5) {
    let amp = 0.5, freq = 1, sum = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.n3(x * freq, y * freq, z * freq);
      freq *= lacunarity;
      amp *= gain;
    }
    return sum;
  }
}

/** Interpolation lissée (smoothstep 0..1). */
export const smooth = (t) => t * t * (3 - 2 * t);

/** Clamp générique. */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Lerp exponentiel indépendant du framerate (damping naturel). */
export function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}
