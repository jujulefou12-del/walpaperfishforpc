/* ============================================================
   shaders/water.glsl.js — Sources GLSL du pipeline WebGL.

   Architecture GPU :
   1. quad plein écran → environnement procédural (eau, fond,
      végétation lointaine, caustiques, god-rays, surface,
      distorsion souris, vignette, grain).
   Les entités (poissons/plantes/bulles/particules) sont rendues via
   des sprites texturés générés en Canvas2D + shader de sprite.
   ============================================================ */

/* ---------- Vertex commun : quad NDC ---------- */
export const VS_QUAD = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/* ---------- Fragment : environnement aquatique complet ---------- */
export const FS_ENV = `
precision highp float;
varying vec2 v_uv;

uniform vec2  u_res;        // résolution px
uniform float u_time;       // secondes
uniform vec2  u_mouse;      // position souris (uv, y=0 en haut)
uniform float u_mouseStr;   // force d'interaction 0..1
uniform float u_light;      // intensité lumineuse globale
uniform float u_caustics;   // amplitude caustiques
uniform float u_current;    // vitesse du courant
uniform float u_daylight;   // 1 = jour, 0 = nuit (teinte plus chaude)
uniform float u_surfY;      // profondeur de la surface (depuis le haut, uv)

/* ---- Bruit simplex 2D (Ashima, domaine public) ---- */
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec2 mod289(vec2 x){return x-floor(x*(1.0/289.0))*289.0;}
vec3 permute(vec3 x){return mod289(((x*34.0)+1.0)*x);}
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187,0.366025403784439,
                     -0.757772289193388,0.243521988299477);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0,i1.y,1.0)) + i.x + vec3(0.0,i1.x,1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373473090289 * (a0*a0 + h*h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for(int i=0;i<4;i++){ s += a*snoise(p); p*=2.03; a*=0.5; }
  return s;
}

void main(){
  vec2 uv = v_uv;                       // uv.y = 0 bas ; on travaille avec yy = haut->bas
  float aspect = u_res.x / u_res.y;
  float yy = 1.0 - uv.y;                // 0 = surface (haut), 1 = sol
  vec2 p = vec2(uv.x * aspect, yy);
  float t = u_time;

  /* --- Distorsion locale autour du curseur (remous discrets) --- */
  vec2 d = vec2((uv.x - u_mouse.x) * aspect, uv.y - (1.0 - u_mouse.y));
  float r = length(d);
  float infl = smoothstep(0.24, 0.0, r) * u_mouseStr;
  float rip = sin(r * 90.0 - t * 6.0) * 0.0035 * infl;
  vec2 dir = r > 1e-5 ? d / r : vec2(0.0);
  vec2 warp = dir * (rip + infl * 0.006 * sin(t * 2.2 + r * 40.0));
  vec2 wp = vec2((uv.x + warp.x / aspect) * aspect, yy + warp.y);

  /* --- Fond : dégradé vertical profond --- */
  vec3 colHigh = vec3(0.075, 0.200, 0.185);
  vec3 colMid  = vec3(0.045, 0.135, 0.135);
  vec3 colDeep = vec3(0.020, 0.062, 0.070);
  vec3 bg = mix(colDeep, colMid, smoothstep(1.0, 0.45, yy));
  bg = mix(bg, colHigh, smoothstep(0.55, 0.0, yy));

  /* --- Végétation lointaine : masses sombres floues --- */
  float far = fbm(vec2(wp.x*2.3, wp.y*1.15) + vec2(t*0.012*u_current, 0.0));
  float stalks = fbm(vec2(wp.x*7.0, wp.y*2.2));
  float vegFar = smoothstep(-0.1, 0.65, far*0.7 + stalks*0.45) *
                 smoothstep(0.98, 0.45, yy);
  bg = mix(bg, bg*0.62 + vec3(0.012,0.035,0.020), vegFar*0.85);

  /* --- Brume volumétrique : dense près du sol et au fond --- */
  float haze = smoothstep(0.55, 1.0, yy);
  bg = mix(bg, vec3(0.050, 0.105, 0.105), haze * 0.20);

  /* --- Caustiques : couches de bruit déformé, dérive lente --- */
  float cAmp = u_caustics * u_light;
  vec2 q1 = wp*3.1 + vec2(t*0.05*u_current, -t*0.02);
  vec2 q2 = wp*5.7 - vec2(t*0.035, t*0.045*u_current);
  float defl = fbm(q1*0.8 + t*0.05);
  float ca1 = snoise(q1 + defl*0.9);
  float ca2 = snoise(q2 + fbm(q2*0.6 - t*0.04)*0.7);
  float caustic = pow(max(ca1*0.5+0.5, 0.0), 3.0) * 0.75 +
                  pow(max(ca2*0.5+0.5, 0.0), 4.0) * 0.55;
  float caMask = smoothstep(0.55, 0.94, yy) * 0.9 + 0.16;   // vit sur le sol
  bg += vec3(0.16, 0.24, 0.17) * caustic * 0.16 * cAmp * caMask;

  /* --- God-rays : faisceaux descendants depuis la surface --- */
  float rayX = wp.x * 1.4;
  float rays = 0.0;
  rays += smoothstep(0.55, 1.0, snoise(vec2(rayX*1.9, t*0.05*u_current)));
  rays += smoothstep(0.68, 1.0, snoise(vec2(rayX*0.9 + 13.0, t*0.033)));
  float fall = pow(smoothstep(0.95, 0.05, yy), 1.6);
  float shimmer = 0.75 + 0.25*sin(t*0.7 + wp.x*22.0 + snoise(vec2(wp.y*3.0,t*0.2))*4.0);
  bg += vec3(0.30, 0.42, 0.30) * rays * 0.055 * u_light * fall * shimmer;

  /* --- Surface de l'eau : bandeau supérieur ondulants + scintillement --- */
  float nearSurf = smoothstep(u_surfY + 0.10, u_surfY - 0.015, yy);
  if (nearSurf > 0.001) {
    float wave = snoise(vec2(wp.x*9.0, t*0.55)) * 0.5 +
                 snoise(vec2(wp.x*23.0 + 7.0, t*0.9)) * 0.25;
    float sparkle = pow(max(sin(wp.x*40.0 + wave*6.0 + t*1.3) * 0.5 + 0.5, 0.0), 12.0);
    bg += vec3(0.10, 0.16, 0.13) * nearSurf * u_light * 0.8;
    bg += vec3(0.35, 0.45, 0.35) * sparkle * nearSurf * 0.10 * u_light;
    bg = mix(bg, vec3(0.150, 0.285, 0.240), nearSurf*nearSurf*0.28);
  }

  /* --- Teinte jour/nuit : lumière plus chaude progressivement --- */
  float warm = 1.0 - u_daylight;
  bg = mix(bg, bg * vec3(1.06, 0.97, 0.86) + vec3(0.010, 0.003, 0.0), warm * 0.55);

  /* --- Exposition légèrement variable (respiration de la caméra) --- */
  float expo = 1.0 + 0.02*sin(t*0.11) + 0.015*snoise(vec2(t*0.05, 3.0));
  bg *= expo * u_light;

  /* --- Vignettage optique discret + grain capteur très fin --- */
  vec2 vc = uv - 0.5;
  bg *= 1.0 - dot(vc, vc) * 0.55;
  float grain = fract(sin(dot(uv*u_res, vec2(12.9898,78.233)) + t) * 43758.5453);
  bg += (grain - 0.5) * 0.018;

  gl_FragColor = vec4(bg, 1.0);
}`;

/* ---------- Vertex : sprites (bulles, particules, nourriture, plantes, poissons) ----------
   Chaque sprite est un quad positionné en pixels écran (y vers le bas),
   avec taille, rotation, alpha et teinte passés en attributs instanciés
   émulés par re-tessellation CPU (faible coût : quelques centaines max). */
export const VS_SPRITE = `
attribute vec2 a_corner;     // coin du quad (-1..1)
attribute vec2 a_pos;        // centre en px (espace écran, y bas)
attribute float a_size;      // demi-largeur en px
attribute float a_rot;       // rotation radians
attribute float a_alpha;
attribute vec4 a_tint;       // rgba multiplié sur la texture
uniform vec2 u_res;
varying vec2 v_c;
varying vec4 v_tint;
void main(){
  v_c = a_corner;
  v_tint = a_tint;
  float cs = cos(a_rot), sn = sin(a_rot);
  vec2 off = vec2(a_corner.x*cs - a_corner.y*sn,
                  a_corner.x*sn + a_corner.y*cs) * a_size;
  vec2 px = a_pos + off;                      // espace écran
  vec2 ndc = (px / u_res) * 2.0 - 1.0;
  ndc.y = -ndc.y;                             // WebGL y vers le haut
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

/* ---------- Fragment : sprite texturé (alpha non-prémultiplié) ---------- */
export const FS_SPRITE = `
precision highp float;
varying vec2 v_c;
varying vec4 v_tint;
uniform sampler2D u_tex;
void main(){
  vec4 tx = texture2D(u_tex, v_c * 0.5 + 0.5);
  gl_FragColor = vec4(tx.rgb * v_tint.rgb, tx.a * v_tint.a);
}`;

/* ---------- Fragment : bulle réaliste procédurale (sans texture) ---------- */
export const FS_BUBBLE = `
precision highp float;
varying vec2 v_c;
varying vec4 v_tint;
void main(){
  float r = length(v_c);
  if (r > 1.0) discard;
  float edge = smoothstep(0.78, 0.99, r) * (1.0 - smoothstep(0.99, 1.0, r));
  float rim  = smoothstep(0.55, 0.98, r) * 0.35;
  vec2 h1 = v_c - vec2(-0.38, 0.42);
  float hi = exp(-dot(h1,h1)*14.0);
  vec2 h2 = v_c - vec2(0.45, -0.35);
  float hi2 = exp(-dot(h2,h2)*22.0) * 0.4;
  float body = smoothstep(1.0, 0.2, r) * 0.10;
  vec3 col = vec3(0.75, 0.92, 0.88);
  float a = (edge*0.85 + rim*0.35 + hi*0.9 + hi2 + body) * v_tint.a;
  gl_FragColor = vec4(col * (0.7 + hi + hi2), clamp(a, 0.0, 1.0));
}`;
