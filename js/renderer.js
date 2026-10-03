/* ============================================================
   renderer.js — Pipeline WebGL : environnement procédural + sprites.

   - Gestion du contexte, compilation des programmes, textures ;
   - rendu par lots (batch) groupés par texture pour minimiser
     les changements d'état GPU ;
   - blending alpha prémultiplié, tri peintre par profondeur ;
   - helpers de création de textures (canvas → GL).
   ============================================================ */

import {
  VS_QUAD, FS_ENV, VS_SPRITE, FS_SPRITE, FS_BUBBLE,
} from './shaders/water.glsl.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = this.gl = canvas.getContext('webgl', {
      alpha: false, antialias: false, depth: false, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL non supporté');

    this.programs = {
      env: this.makeProgram(VS_QUAD, FS_ENV),
      sprite: this.makeProgram(VS_SPRITE, FS_SPRITE),
      bubble: this.makeProgram(VS_SPRITE, FS_BUBBLE),
    };
    this.textures = new Map();
    this.nextTexId = 1;

    // quad plein écran
    this.quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

    // tampon sprite dynamique (coins fixes)
    this.cornerBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

    // buffer attributs interleave par sprite :
    // corner(2) pos(2) size(1) rot(1) alpha(1) tint(4) = 11 floats * 6 sommets
    this.spriteData = new Float32Array(6 * 11 * 4096);
    this.spriteBuf = gl.createBuffer();

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // alpha prémultiplié
  }

  compile(type, src) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error('Shader: ' + gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  makeProgram(vs, fs) {
    const gl = this.gl;
    const p = gl.createProgram();
    gl.attachShader(p, this.compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('Link: ' + gl.getProgramInfoLog(p));
    }
    const info = { program: p, u: {}, a: {} };
    const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) {
      const name = gl.getActiveUniform(p, i).name;
      info.u[name] = gl.getUniformLocation(p, name);
    }
    const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < na; i++) {
      const name = gl.getActiveAttrib(p, i).name;
      info.a[name] = gl.getAttribLocation(p, name);
    }
    return info;
  }

  /** Texture depuis un canvas 2D (alpha premultiplied natif du canvas). */
  uploadTexture(source) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const id = this.nextTexId++;
    this.textures.set(id, tex);
    return id;
  }

  resize(w, h, dpr) {
    const gl = this.gl;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /* ---------- Passe environnement (fond procédural) ---------- */
  drawEnv(uniforms) {
    const gl = this.gl;
    const pr = this.programs.env;
    gl.useProgram(pr.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(pr.a.a_pos);
    gl.vertexAttribPointer(pr.a.a_pos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(pr.u.u_res, this.canvas.width, this.canvas.height);
    gl.uniform1f(pr.u.u_time, uniforms.time);
    gl.uniform2f(pr.u.u_mouse, uniforms.mouse[0], uniforms.mouse[1]);
    gl.uniform1f(pr.u.u_mouseStr, uniforms.mouseStr);
    gl.uniform1f(pr.u.u_light, uniforms.light);
    gl.uniform1f(pr.u.u_caustics, uniforms.caustics);
    gl.uniform1f(pr.u.u_current, uniforms.current);
    gl.uniform1f(pr.u.u_daylight, uniforms.daylight);
    gl.uniform1f(pr.u.u_surfY, uniforms.surfY);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /* ---------- Passe sprites (batch par texture/programme) ---------- */
  /**
   * @param {Array} sprites {texId|-1, x,y,size,rot,alpha,tint:[r,g,b,a],
   *                         flipY?, procedural?}
   */
  drawSprites(sprites) {
    const gl = this.gl;
    // tri peintre : loin → près
    sprites.sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));

    // groupes par (texture|procedural)
    const groups = new Map();
    for (const s of sprites) {
      const key = s.procedural ? 'bubble' : String(s.texId);
      (groups.get(key) || groups.set(key, []).get(key)).push(s);
    }

    for (const [key, list] of groups) {
      const isBubble = key === 'bubble';
      const pr = isBubble ? this.programs.bubble : this.programs.sprite;
      gl.useProgram(pr.program);
      gl.uniform2f(pr.u.u_res, this.canvas.width / (this.dpr || 1),
                                      this.canvas.height / (this.dpr || 1));
      if (!isBubble) {
        const tex = this.textures.get(Number(key));
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(pr.u.u_tex, 0);
      }
      this.uploadBatch(pr, list);
    }
  }

  setDpr(dpr) { this.dpr = dpr; }

  uploadBatch(pr, list) {
    const gl = this.gl;
    const STRIDE = 11;
    let data = this.spriteData;
    const need = list.length * 6 * STRIDE;
    if (need > data.length) data = this.spriteData = new Float32Array(need);

    let o = 0;
    const corners = [[-1,-1],[1,-1],[-1,1],[1,1]];
    const order = [0,1,2, 2,1,3];
    for (const s of list) {
      const t = s.tint || [1,1,1,s.alpha ?? 1];
      const flip = s.flipY ? -1 : 1;
      // 6 sommets
      for (const oi of order) {
        const [cx, cyRaw] = corners[oi];
        const cy = cyRaw * flip;
        data[o++] = cx; data[o++] = cy;                 // a_corner
        data[o++] = s.x; data[o++] = s.y;               // a_pos
        data[o++] = s.size;                             // a_size
        data[o++] = s.rot || 0;                         // a_rot
        data[o++] = s.alpha ?? 1;                       // a_alpha
        data[o++] = t[0]; data[o++] = t[1]; data[o++] = t[2]; data[o++] = t[3];
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, o), gl.DYNAMIC_DRAW);

    const F = 4, S = STRIDE * F;
    const bind = (name, size, off) => {
      const loc = pr.a[name];
      if (loc == null || loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, S, off * F);
    };
    bind('a_corner', 2, 0);
    bind('a_pos', 2, 2);
    bind('a_size', 1, 4);
    bind('a_rot', 1, 5);
    bind('a_alpha', 1, 6);
    bind('a_tint', 4, 7);

    gl.drawArrays(gl.TRIANGLES, 0, list.length * 6);
  }
}
