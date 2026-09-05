/* ============================================================
   THOR ELECTRO 7 — PM & FM II piano engine
   - Grand / Upright : Karplus-Strong string rendering (cached)
     with hammer noise, soundboard EQ, damper thump
   - Rhodes / Wurli  : 2-op FM + tine partial + key thump,
     Wurli bark drive + tremolo
   - Clav            : plucked bandpass saw + pickup snap
   ============================================================ */
"use strict";
(function (T) {

  const X1_LABELS = {
    grand: "STRING DAMP", upright: "STRING DAMP",
    rhodes: "BELL", wurli: "BARK", clav: "TONE"
  };
  const X2_LABELS = {
    grand: "RESONANCE", upright: "RESONANCE",
    rhodes: "BODY", wurli: "TREM", clav: "SNAP"
  };
  T.PianoXLabels = { x1: X1_LABELS, x2: X2_LABELS };

  T.buildPiano = function (ctx, dest) {

    const PN = { voices: new Map(), sustained: new Set(), cap: 20 };

    // ---------- master chain ----------
    PN.bus = ctx.createGain();
    PN.eqBass = ctx.createBiquadFilter(); PN.eqBass.type = "lowshelf"; PN.eqBass.frequency.value = 120;
    PN.eqTreble = ctx.createBiquadFilter(); PN.eqTreble.type = "highshelf"; PN.eqTreble.frequency.value = 4200;
    PN.bus.connect(PN.eqBass); PN.eqBass.connect(PN.eqTreble); PN.eqTreble.connect(dest);

    // acoustic soundboard body chain
    PN.bodyHead = ctx.createGain();
    let prev = PN.bodyHead;
    [[105, 3.5, 1.1], [235, -2.5, 1.3], [900, 2.2, 1.1], [2700, 1.6, 1.4]].forEach(([f, g, q]) => {
      const p = ctx.createBiquadFilter(); p.type = "peaking";
      p.frequency.value = f; p.gain.value = g; p.Q.value = q;
      prev.connect(p); prev = p;
    });
    const bodyHP = ctx.createBiquadFilter(); bodyHP.type = "highpass"; bodyHP.frequency.value = 28;
    prev.connect(bodyHP); bodyHP.connect(PN.bus);

    // electric input (no body resonances)
    PN.epIn = ctx.createGain();
    PN.epIn.connect(PN.bus);

    // ---------- sampled GRAND (Salamander Grand Piano, Yamaha C5, CC-BY 3.0) ----------
    // Real recordings, one every 3 semitones; played notes pitch-shift <=1 semitone.
    PN.samples = { ready: false, map: new Map() };
    (function loadGrand() {
      const PC = { C:0, Cs:1, D:2, Ds:3, E:4, F:5, Fs:6, G:7, Gs:8, A:9, As:10, B:11 };
      const files = ["C1","Ds1","Fs1","A1","C2","Ds2","Fs2","A2","C3","Ds3","Fs3","A3",
                     "C4","Ds4","Fs4","A4","C5","Ds5","Fs5","A5","C6","Ds6","Fs6","A6",
                     "C7","Ds7","Fs7","A7","C8"];
      const midiOf = n => { const m = n.match(/^([A-G]s?)(\d)$/); return PC[m[1]] + (parseInt(m[2], 10) + 1) * 12; };
      files.forEach(n => {
        fetch("samples/piano/" + n + ".mp3")
          .then(r => r.ok ? r.arrayBuffer() : Promise.reject())
          .then(a => ctx.decodeAudioData(a))
          .then(buf => {
            PN.samples.map.set(midiOf(n), buf);
            if (PN.samples.map.size >= 10) PN.samples.ready = true;   // enough coverage to sound good
          })
          .catch(() => {});
      });
    })();

    function grandSampleNote(midi, vel, when) {
      let best = null, bd = 1e9;
      PN.samples.map.forEach((buf, sm) => { const d = Math.abs(sm - midi); if (d < bd) { bd = d; best = sm; } });
      if (best == null) { acousticNote(midi, vel, when, "grand"); return; }
      const v = makeVoice(midi); v.type = "grand";
      const src = ctx.createBufferSource(); src.buffer = PN.samples.map.get(best);
      src.playbackRate.value = Math.pow(2, (midi - best) / 12);
      // single-velocity library: emulate dynamics with loudness + hammer brightness
      const vg = ctx.createGain(); vg.gain.value = T.clamp(0.15 + 0.85 * vel * vel, 0, 1);
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass";
      lp.frequency.value = T.clamp(1600 + vel * vel * 16000, 1600, 18000);
      const pan = ctx.createStereoPanner(); pan.pan.value = T.clamp((midi - 60) / 40, -1, 1) * 0.22;
      src.connect(lp); lp.connect(vg); vg.connect(pan); pan.connect(PN.bus);
      src.start(when);
      v.srcs = [src]; v.vg = vg; v.relTau = 0.18;
    }

    // ---------- shared noise ----------
    const noiseBuf = (function () {
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    })();

    function thumpBuffer(cut) {
      const sr = ctx.sampleRate, len = Math.floor(sr * 0.09);
      const buf = ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      let lp = 0;
      const a = Math.exp(-2 * Math.PI * cut / sr);
      for (let i = 0; i < len; i++) {
        lp = (1 - a) * (Math.random() * 2 - 1) + a * lp;
        d[i] = lp * Math.exp(-28 * i / len);
      }
      return buf;
    }
    PN.thumpGrand = thumpBuffer(320);
    PN.thumpUpright = thumpBuffer(480);

    // ---------- Karplus-Strong rendering ----------
    const ksCache = new Map();
    function getKS(type, midi, vel, x1) {
      const vb = Math.min(3, Math.floor(vel * 4));
      const bb = Math.min(3, Math.floor(T.clamp(x1, 0, 1) * 4));
      const key = type + "|" + midi + "|" + vb + "|" + bb;
      let buf = ksCache.get(key);
      if (buf) return buf;

      const f0 = T.midiToFreq(midi);
      const sr = ctx.sampleRate;
      const upright = type === "upright";
      const w0 = 2 * Math.PI * f0 / sr;

      // bucket-representative controls (buffer is cached per velocity/x1 bucket)
      const velR = (vb + 0.5) / 4;                      // 0.125 .. 0.875
      const xR = bb / 3;                                // 0..1  STRING DAMP (higher = brighter/longer)

      // excitation: gentle so the FUNDAMENTAL dominates (not a bright noise burst)
      const bright = T.clamp(0.16 + 0.30 * velR + 0.14 * xR, 0.12, 0.62) * (upright ? 0.9 : 1);
      const hammer = T.clamp(0.62 - 0.25 * velR, 0.30, 0.70);   // tonal strike vs. noise balance

      // grands ring long; higher notes decay faster; STRING DAMP lengthens it
      let dur = T.clamp(9.0 * Math.pow(180 / f0, 0.5), 0.6, 16) * (upright ? 0.5 : 1) * (0.7 + 0.4 * xR);
      const len = Math.floor(sr * dur);
      const data = new Float32Array(len);

      // ---- loop filters ----
      const dLoss = T.clamp(0.14 + 0.40 * (1 - xR), 0.06, 0.60) * (upright ? 1.15 : 1); // one-pole loss (highs die first)
      const rho = Math.pow(0.0005, 1 / Math.max(1, f0 * dur));   // per-loop gain -> ~ -66 dB over `dur`
      const pole = rho * dLoss;
      const g = rho * (1 - dLoss);
      // cascade of first-order all-passes -> subtle inharmonic "shimmer" in the upper partials
      const disp = upright ? 0.10 : 0.14;
      const nAP = upright ? 1 : 2;

      // keep tuning accurate: subtract the phase delay the loop filters add at f0
      const cw = Math.cos(w0), sw = Math.sin(w0);
      const pdLoss = Math.atan2(pole * sw, 1 - pole * cw) / w0;
      const apAng = Math.atan2(-sw, disp + cw) - Math.atan2(-disp * sw, 1 + disp * cw);
      const pdDisp = nAP * (-apAng / w0);
      let Dtot = sr / f0 - pdLoss - pdDisp;
      if (Dtot < 2) Dtot = 2;
      const Lint = Math.floor(Dtot);
      const bufLen = Lint + 2;
      const dl = new Float32Array(bufLen);

      // fundamental-heavy strike + coloured noise for the hammer
      let z = 0;
      for (let i = 0; i < Lint; i++) {
        const wn = Math.random() * 2 - 1;
        z += bright * (wn - z);
        const ph = 2 * Math.PI * i / Lint;
        const tone = Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph);
        dl[i] = hammer * tone + (1 - hammer) * z;
      }

      // tuned, damped, dispersive Karplus-Strong loop (fractional read = accurate pitch)
      const apX = new Float32Array(nAP), apY = new Float32Array(nAP);
      let widx = 0, yl = 0;
      for (let i = 0; i < len; i++) {
        let rp = widx - Dtot; if (rp < 0) rp += bufLen;
        const ri = rp | 0, rf = rp - ri;
        const out = dl[ri] + rf * (dl[(ri + 1) % bufLen] - dl[ri]);
        data[i] = out;
        yl = g * out + pole * yl;                 // low-pass loss
        let a = yl;
        for (let m = 0; m < nAP; m++) {           // dispersion all-pass cascade
          const y = disp * a + apX[m] - disp * apY[m];
          apX[m] = a; apY[m] = y; a = y;
        }
        dl[widx] = a;
        widx = widx + 1; if (widx >= bufLen) widx = 0;
      }

      // normalize + velocity level + tail fade
      let peak = 0;
      for (let i = 0; i < len; i++) { const a = Math.abs(data[i]); if (a > peak) peak = a; }
      const norm = peak > 0 ? 1 / peak : 1;
      const amp = 0.42 + 0.38 * (vb / 3);
      const fadeStart = Math.max(0, len - 2400);
      for (let i = 0; i < len; i++) {
        let s = data[i] * norm * amp;
        if (i > fadeStart) s *= (len - i) / (len - fadeStart);
        data[i] = s;
      }

      buf = ctx.createBuffer(1, len, sr);
      buf.copyToChannel(data, 0);
      ksCache.set(key, buf);
      if (ksCache.size > 280) {
        const k = ksCache.keys().next().value;
        ksCache.delete(k);
      }
      return buf;
    }

    // ---------- voices ----------
    function makeVoice(midi) {
      const v = { midi, nodes: [], on: true };
      PN.voices.set(midi, v);
      if (PN.voices.size > PN.cap) {
        const first = PN.voices.keys().next().value;
        if (first !== midi) PN.release(first, ctx.currentTime, 0.02);
      }
      return v;
    }

    function acousticNote(midi, vel, when, type) {
      const P = T.state.program.piano;
      const buf = getKS(type, midi, vel, P.x1);
      const amp = 0.5 + vel * 0.55;
      const v = makeVoice(midi);

      const vg = ctx.createGain(); vg.gain.value = amp;
      vg.connect(type === "grand" || type === "upright" ? PN.bodyHead : PN.epIn);
      v.vg = vg;

      const s1 = ctx.createBufferSource(); s1.buffer = buf;
      const s2 = ctx.createBufferSource(); s2.buffer = buf; s2.detune.value = 1.4;
      const p1 = ctx.createStereoPanner(); p1.pan.value = -0.22;
      const p2 = ctx.createStereoPanner(); p2.pan.value = 0.22;
      s1.connect(p1); p1.connect(vg);
      s2.connect(p2); p2.connect(vg);
      s1.start(when); s2.start(when);
      v.srcs = [s1, s2];
      v.type = type;

      // hammer thump
      const tb = type === "upright" ? PN.thumpUpright : PN.thumpGrand;
      const ts = ctx.createBufferSource(); ts.buffer = tb;
      const tg = ctx.createGain(); tg.gain.value = (0.05 + vel * 0.22) * (type === "upright" ? 1.35 : 1);
      ts.connect(tg); tg.connect(PN.bodyHead);
      ts.start(when);
      setTimeout(() => { try { tg.disconnect(); } catch (e) {} }, 300);
    }

    function epNote(midi, vel, when, type) {
      const P = T.state.program.piano;
      const f0 = T.midiToFreq(midi);
      const v = makeVoice(midi);
      v.type = type;

      const vg = ctx.createGain(); vg.gain.value = 1;
      let head = vg;

      if (type === "wurli") {
        const k = 1.2 + P.x1 * 7;                     // BARK
        const ws = ctx.createWaveShaper();
        const n = 512, c = new Float32Array(n), norm = Math.tanh(k);
        for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
        ws.curve = c; ws.oversample = "2x";
        vg.connect(ws); head = ws;
      }
      const pan = ((midi % 12) / 11 - 0.5) * 1.0;
      const pn = ctx.createStereoPanner(); pn.pan.value = pan;
      head.connect(pn); pn.connect(PN.epIn);

      const amp = 0.34 + vel * 0.5;

      // carrier + modulator (body)
      const car = ctx.createOscillator(); car.type = "sine"; car.frequency.value = f0;
      const mod = ctx.createOscillator(); mod.type = "sine"; mod.frequency.value = f0;
      const mg = ctx.createGain();
      mod.connect(mg); mg.connect(car.frequency);
      const I0 = (type === "wurli" ? 1.1 : 0.85) + vel * (type === "wurli" ? 2.2 : 1.7);
      const Isus = type === "rhodes" ? 0.015 + P.x2 * 0.1 : 0.05 + P.x2 * 0.13;   // BODY
      mg.gain.setValueAtTime(I0 * f0 * 0.5, when);
      mg.gain.setTargetAtTime(Isus * f0 * 0.5, when + 0.004, 0.11);

      const cg = ctx.createGain(); cg.gain.value = 0;
      car.connect(cg); cg.connect(vg);
      const decTau = T.clamp(Math.pow(180 / f0, 0.55) * 3.4 * (0.55 + P.x2 * 0.9), 0.25, 8);
      cg.gain.setValueAtTime(0, when);
      cg.gain.linearRampToValueAtTime(amp, when + 0.002);
      cg.gain.setTargetAtTime(amp * 0.32, when + 0.002, decTau);

      // tine / bell partial
      let tineOsc = null;
      const bellLvl = type === "rhodes" ? P.x1 * 0.5 : 0.1;
      if (bellLvl > 0.01) {
        tineOsc = ctx.createOscillator(); tineOsc.type = "sine";
        tineOsc.frequency.value = Math.min(f0 * 14, ctx.sampleRate * 0.42);
        const tg2 = ctx.createGain(); tg2.gain.value = 0;
        tineOsc.connect(tg2); tg2.connect(vg);
        tg2.gain.setValueAtTime(bellLvl * vel * vel * 0.9, when);
        tg2.gain.setTargetAtTime(0, when + 0.002, 0.055);
        tineOsc.start(when);
        v.tineG = tg2;
      }

      // key thump
      const ts = ctx.createBufferSource(); ts.buffer = noiseBuf;
      const tf = ctx.createBiquadFilter(); tf.type = "bandpass"; tf.frequency.value = 850; tf.Q.value = 1.1;
      const tg = ctx.createGain(); tg.gain.value = 0;
      ts.connect(tf); tf.connect(tg); tg.connect(vg);
      tg.gain.setValueAtTime(0.16 * vel, when);
      tg.gain.setTargetAtTime(0, when + 0.001, 0.012);
      ts.start(when, Math.random()); ts.stop(when + 0.09);

      // wurli tremolo
      let tremOsc = null, tremDep = null;
      if (type === "wurli") {
        tremOsc = ctx.createOscillator(); tremOsc.type = "sine"; tremOsc.frequency.value = 4.7;
        tremDep = ctx.createGain(); tremDep.gain.value = 0;
        tremOsc.connect(tremDep); tremDep.connect(cg.gain);
        tremOsc.start(when);
      }
      tremDep && tremDep.gain.setTargetAtTime(amp * 0.42 * P.x2, when, 0.05);

      car.start(when); mod.start(when);

      v.car = car; v.mod = mod; v.cg = cg; v.tremDep = tremDep;
      v.relTau = 0.07;
    }

    function clavNote(midi, vel, when) {
      const P = T.state.program.piano;
      const f0 = T.midiToFreq(midi);
      const v = makeVoice(midi);
      v.type = "clav";

      const toneMult = 0.5 + P.x1 * 1.5;              // TONE
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass";
      bp.Q.value = 2.4;
      const fHi = Math.min(f0 * 9 * toneMult, ctx.sampleRate * 0.44);
      bp.frequency.setValueAtTime(fHi, when);
      bp.frequency.setTargetAtTime(f0 * 2.2 * toneMult, when + 0.004, 0.035);
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 7500;

      const vg = ctx.createGain(); vg.gain.value = 0;
      const pn = ctx.createStereoPanner(); pn.pan.value = ((midi % 12) / 11 - 0.5) * 0.6;

      const osc = ctx.createOscillator(); osc.type = "sawtooth"; osc.frequency.value = f0;
      osc.connect(bp); bp.connect(lp); lp.connect(vg); vg.connect(pn); pn.connect(PN.epIn);

      const amp = 0.30 + vel * 0.5;
      vg.gain.setValueAtTime(0, when);
      vg.gain.linearRampToValueAtTime(amp, when + 0.0015);
      vg.gain.setTargetAtTime(amp * 0.34, when + 0.0015, 0.12);

      // pickup snap
      const snap = P.x2;                              // SNAP
      if (snap > 0.02) {
        const ts = ctx.createBufferSource(); ts.buffer = noiseBuf;
        const tf = ctx.createBiquadFilter(); tf.type = "highpass"; tf.frequency.value = 3800;
        const tg = ctx.createGain(); tg.gain.value = 0;
        ts.connect(tf); tf.connect(tg); tg.connect(vg);
        tg.gain.setValueAtTime(0.3 * snap * vel, when);
        tg.gain.setTargetAtTime(0, when + 0.001, 0.008);
        ts.start(when, Math.random()); ts.stop(when + 0.05);
      }

      osc.start(when);
      v.osc = osc; v.vg = vg; v.relTau = 0.03;
    }

    // ---------- public API ----------
    PN.noteOn = function (midi, vel, when) {
      when = when == null ? ctx.currentTime : when;
      const old = PN.voices.get(midi);
      if (old) PN.release(midi, when, 0.008);
      const type = T.state.program.piano.type;
      PN.sustained.delete(midi);
      if (type === "grand" && PN.samples.ready) grandSampleNote(midi, vel, when);
      else if (type === "grand" || type === "upright") acousticNote(midi, vel, when, type);
      else if (type === "rhodes" || type === "wurli") epNote(midi, vel, when, type);
      else clavNote(midi, vel, when);
    };

    PN.release = function (midi, when, tauOverride) {
      when = when == null ? ctx.currentTime : when;
      const v = PN.voices.get(midi);
      if (!v || !v.on) return;
      const tau = tauOverride != null ? tauOverride : v.relTau || 0.08;
      v.on = false;
      if (v.vg) {
        try { v.vg.gain.cancelScheduledValues(when); } catch (e) {}
        v.vg.gain.setTargetAtTime(0, when, tau);
      }
      const stopAt = when + tau * 8 + 0.15;
      if (v.srcs) v.srcs.forEach(s => { try { s.stop(stopAt); } catch (e) {} });
      if (v.car) { try { v.car.stop(stopAt); } catch (e) {} }
      if (v.mod) { try { v.mod.stop(stopAt); } catch (e) {} }
      if (v.tineG) v.tineG.gain.setTargetAtTime(0, when, 0.02);
      if (v.tremDep) v.tremDep.gain.setTargetAtTime(0, when, 0.02);
      if (v.osc) { try { v.osc.stop(stopAt); } catch (e) {} }
      PN.voices.delete(midi);
      const cleanupDelay = Math.max(0, (stopAt - ctx.currentTime) * 1000) + 120;
      setTimeout(() => {
        try { v.vg && v.vg.disconnect(); } catch (e) {}
      }, cleanupDelay);
    };

    PN.noteOff = function (midi, when) {
      when = when == null ? ctx.currentTime : when;
      if (T.state.sustain) {
        const v = PN.voices.get(midi);
        if (v && v.on) { PN.sustained.add(midi); return; }
      }
      PN.release(midi, when);
      // damper thump on acoustic
      const type = T.state.program.piano.type;
      const ksAcoustic = type === "upright" || (type === "grand" && !PN.samples.ready);
      if (ksAcoustic && !T.state.sustain) {
        const tb = type === "upright" ? PN.thumpUpright : PN.thumpGrand;
        const ts = ctx.createBufferSource(); ts.buffer = tb;
        const tg = ctx.createGain(); tg.gain.value = 0.05;
        ts.connect(tg); tg.connect(PN.bodyHead); ts.start(when);
        setTimeout(() => { try { tg.disconnect(); } catch (e) {} }, 250);
      }
    };

    PN.sustainDown = function () {};
    PN.sustainUp = function (when) {
      when = when == null ? ctx.currentTime : when;
      PN.sustained.forEach(m => PN.release(m, when));
      PN.sustained.clear();
    };

    PN.allOff = function (when) {
      when = when == null ? ctx.currentTime : when;
      Array.from(PN.voices.keys()).forEach(m => PN.release(m, when, 0.02));
      PN.sustained.clear();
    };

    // ---------- parameter updates ----------
    PN.update = function (path) {
      const P = T.state.program.piano;
      const now = ctx.currentTime;
      if (path === "*" || path === "piano.bass") PN.eqBass.gain.setTargetAtTime(P.bass, now, 0.04);
      if (path === "*" || path === "piano.treble") PN.eqTreble.gain.setTargetAtTime(P.treble, now, 0.04);
      // type/x changes apply to next notes
    };

    PN.setLevel = function (v) { PN.bus.gain.setTargetAtTime(v, ctx.currentTime, 0.03); };

    PN.setLevel(T.state.program.levels.piano);
    PN.eqBass.gain.value = T.state.program.piano.bass;
    PN.eqTreble.gain.value = T.state.program.piano.treble;

    return PN;
  };

})(window.THOR);
