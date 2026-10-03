/* ============================================================
   audio.js — Son optionnel (désactivé par défaut).

   Synthèse 100% WebAudio, aucun fichier externe :
   - bruit d'eau filtré (bruit rose passe-bande lentement modulé) ;
   - micro-cliquets de bulles aléatoires extrêmement discrets.
   Volume global très bas pour ne jamais gêner l'utilisateur.
   ============================================================ */

export class Ambience {
  constructor() {
    this.ctx = null;
    this.running = false;
  }

  async start() {
    if (this.running) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const ctx = this.ctx;

    // --- bruit "eau" : buffer brownien mis en boucle + filtre variable ---
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 480; bp.Q.value = 0.6;

    // LFO très lent sur la fréquence centrale → "respiration" de l'eau
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(bp.frequency);

    const master = ctx.createGain();
    master.gain.value = 0.045;                 // discret !

    src.connect(bp).connect(master).connect(ctx.destination);
    src.start(); lfo.start();
    this.master = master;
    this.src = src; this.lfo = lfo; this.bp = bp;
    this.running = true;

    // clics de bulles
    this.bubbleTimer = setInterval(() => this.bubble(), 900);
  }

  /** Mini-glissando ascendant : bulle qui crève, à peine audible. */
  bubble() {
    if (!this.running || document.hidden) return;
    if (Math.random() > 0.5) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f0 = 600 + Math.random() * 900;
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.9, ctx.currentTime + 0.06);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.012 * Math.random() + 0.002, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09);
    o.connect(g).connect(this.master);
    o.start(); o.stop(ctx.currentTime + 0.1);
  }

  stop() {
    if (!this.running) return;
    clearInterval(this.bubbleTimer);
    try { this.src.stop(); this.lfo.stop(); } catch (_) {}
    this.ctx.close();
    this.ctx = null;
    this.running = false;
  }
}
