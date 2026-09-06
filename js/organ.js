/* ============================================================
   THOR ELECTRO 7 — TONEWHEEL I drawbar organ
   - per-note additive synthesis (9 drawbars / harmonics)
   - multi-tap scanner vibrato/chorus (pulse-gated taps)
   - Leslie-style rotary speaker (Doppler + amp shadowing)
   - key click, monophonic percussion, leakage/hum
   ============================================================ */
"use strict";
(function (T) {

  // 9 drawbars: 16'  5⅓'  8'   4'   2⅔'  2'   1⅗'  1⅓'  1'
  const HARMONICS = [0.5, 1.5, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0];
  const DRAW_GAIN = [0, 0.11, 0.18, 0.27, 0.38, 0.52, 0.68, 0.84, 1.0];
  const HARM_TRIM = [0.92, 0.82, 1.0, 0.97, 0.9, 0.86, 0.82, 0.78, 0.72];

  const SCAN_RATE = 6.83;
  const TAP_DELAYS = [0, 0.15e-3, 0.32e-3, 0.68e-3, 1.4e-3, 2.9e-3, 6.0e-3];

  // tap weights per scanner position (index 0 = dry)
  const ZERO_TAPS = [0, 0, 0, 0, 0, 0, 0];
  const SCAN_WEIGHTS = {
    v1: [0, 1, .45, .15, 0, 0, 0],
    v2: [0, .5, 1, .45, .15, 0, 0],
    v3: [0, .2, .55, 1, .55, .2, 0],
    c1: [.55, .9, .4, .12, 0, 0, 0],
    c2: [.55, .45, .9, .4, .12, 0, 0],
    c3: [.55, .18, .5, .9, .5, .18, 0]
  };

  // Zero-mean pulse train (exact Fourier series, unnormalized):
  // x(t) = 1 during [phase, phase+duty), minus duty  ->  swings -duty .. 1-duty
  function gateWave(ctx, duty, phase) {
    const N = 40;
    const real = new Float32Array(N + 1);
    const imag = new Float32Array(N + 1);
    real[0] = 0;                                   // DC handled separately (offset gain)
    for (let k = 1; k <= N; k++) {
      const a = 2 * Math.PI * k;
      real[k] = ((Math.sin(a * (phase + duty)) - Math.sin(a * phase)) / a) * 2;
      imag[k] = ((Math.cos(a * phase) - Math.cos(a * (phase + duty))) / a) * 2;
    }
    return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
  }

  T.buildOrgan = function (ctx, dest) {

    const O = { voices: new Map(), cap: 24 };

    // ---------- signal graph ----------
    O.preFx = ctx.createGain();          // keys + percussion enter here
    O.outVol = ctx.createGain();
    O.preFx.connect(O.outVol);
    O.outVol.connect(dest);

    // ---------- leakage & hum ----------
    {
      O.noiseBuf = (function () {
        const len = ctx.sampleRate * 2;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        let lp = 0;
        for (let i = 0; i < len; i++) {
          lp += 0.25 * ((Math.random() * 2 - 1) - lp);
          d[i] = lp;
        }
        return buf;
      })();

      O.leakGain = ctx.createGain(); O.leakGain.gain.value = 0;
      const nsrc = ctx.createBufferSource(); nsrc.buffer = O.noiseBuf; nsrc.loop = true;
      const nlp = ctx.createBiquadFilter(); nlp.type = "lowpass"; nlp.frequency.value = 1400;
      nsrc.connect(nlp); nlp.connect(O.leakGain); O.leakGain.connect(O.outVol); nsrc.start();

      O.humOsc = ctx.createOscillator(); O.humOsc.type = "sine"; O.humOsc.frequency.value = 60;
      O.humGain = ctx.createGain(); O.humGain.gain.value = 0;
      O.humOsc.connect(O.humGain); O.humGain.connect(O.outVol); O.humOsc.start();

      // slow drift applied to every organ harmonic detune
      O.driftOsc = ctx.createOscillator(); O.driftOsc.type = "sine"; O.driftOsc.frequency.value = 0.37;
      O.driftAmt = ctx.createGain(); O.driftAmt.gain.value = 1.4;
      O.driftOsc.connect(O.driftAmt); O.driftOsc.start();
    }

    // ---------- key click ----------
    O.clickLevel = 0.4;
    O.playClick = function (when, vel, isRelease) {
      const src = ctx.createBufferSource();
      src.buffer = O.noiseBuf;
      src.loop = true;
      src.playbackRate.value = 0.85 + Math.random() * 0.3;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass";
      bp.frequency.value = isRelease ? 1800 : 2500; bp.Q.value = 0.9;
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 900;
      const g = ctx.createGain(); g.gain.value = 0;
      const lvl = O.clickLevel * (isRelease ? 0.35 : 1) * (0.25 + vel * 0.75) * 0.5;
      src.connect(bp); bp.connect(hp); hp.connect(g); g.connect(O.preFx);
      g.gain.setValueAtTime(lvl, when);
      g.gain.setTargetAtTime(0, when + 0.002, 0.004);
      src.start(when, Math.random() * 1.5);
      src.stop(when + 0.06);
      src.onended = () => { try { g.disconnect(); bp.disconnect(); } catch (e) {} };
    };

    // ---------- percussion ----------
    O.percArmed = true;
    O.perc = { osc: null, gain: null };
    O.firePerc = function (freqBase, when) {
      const P = T.state.program.organ.perc;
      if (!P.on || !O.percArmed) return;
      O.killPerc(when);
      const mult = P.harm === "3rd" ? 3 : 2;
      const osc = ctx.createOscillator(); osc.type = "sine";
      osc.frequency.value = Math.min(freqBase * mult, ctx.sampleRate * 0.42);
      const g = ctx.createGain(); g.gain.value = 0;
      osc.connect(g); g.connect(O.preFx);
      const peak = P.soft ? 0.16 : 0.34;
      const tau = P.fast ? 0.075 : 0.28;
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(peak, when + 0.004);
      g.gain.setTargetAtTime(0, when + 0.004, tau);
      osc.start(when); osc.stop(when + tau * 6 + 0.1);
      O.perc.osc = osc; O.perc.gain = g;
      osc.onended = () => { if (O.perc.osc === osc) { O.perc.osc = null; O.perc.gain = null; } };
    };
    O.killPerc = function (when) {
      if (O.perc.gain) { try { O.perc.gain.gain.cancelScheduledValues(when); O.perc.gain.gain.setTargetAtTime(0, when, 0.01); } catch (e) {} }
    };

    // ---------- scanner vibrato / chorus ----------
    O.scanIn = ctx.createGain();
    O.scanOut = ctx.createGain();
    O.dryGate = ctx.createGain();          // hard bypass used when VIB = OFF
    O.dryGate.gain.value = 1;
    O.scanTaps = [];
    const SCAN_DUTY = 1.62 / 7;
    {
      for (let i = 0; i < 7; i++) {
        const gate = ctx.createOscillator();           // zero-mean pulse train
        gate.setPeriodicWave(gateWave(ctx, SCAN_DUTY, i / 7));
        gate.frequency.value = SCAN_RATE;

        const vca = ctx.createGain();                  // base offset = w * duty
        vca.gain.value = 0;
        const depth = ctx.createGain();                // gate modulation depth = w
        depth.gain.value = 0;
        gate.connect(depth); depth.connect(vca.gain);

        if (i === 0) {
          O.scanIn.connect(vca);
        } else {
          const dl = ctx.createDelay(0.02);
          dl.delayTime.value = TAP_DELAYS[i];
          O.scanIn.connect(dl); dl.connect(vca);
        }
        vca.connect(O.scanOut);
        gate.start();
        O.scanTaps.push({ vca, depth });
      }
    }
    // effective per-tap gain = w*duty + w*gate'(t)
    // -> 0 between pulses, w during pulse; 'off' bypasses the scanner entirely
    O.setScanPos = function (pos) {
      const isOff = pos === "off";
      const w = isOff ? ZERO_TAPS : (SCAN_WEIGHTS[pos] || SCAN_WEIGHTS.c3);
      const now = ctx.currentTime;
      O.dryGate.gain.setTargetAtTime(isOff ? 1 : 0, now, 0.02);
      O.scanTaps.forEach((tap, i) => {
        const wi = w[i] || 0;
        tap.depth.gain.setTargetAtTime(wi, now, 0.02);
        tap.vca.gain.setTargetAtTime(wi * SCAN_DUTY, now, 0.02);
      });
    };

    // ---------- rotary speaker ----------
    const R = {};
    R.in = ctx.createGain();
    R.xLo = ctx.createBiquadFilter(); R.xLo.type = "lowpass";  R.xLo.frequency.value = 750; R.xLo.Q.value = 0.6;
    R.xHi = ctx.createBiquadFilter(); R.xHi.type = "highpass"; R.xHi.frequency.value = 750; R.xHi.Q.value = 0.6;
    R.in.connect(R.xLo); R.in.connect(R.xHi);

    // horn: two modulated delay lines + mic shadowing
    R.dlH = [ctx.createDelay(0.02), ctx.createDelay(0.02)];
    R.baseDelay = 0.0011;
    R.dlH.forEach(d => d.delayTime.value = R.baseDelay);
    R.lfoA = ctx.createOscillator(); R.lfoA.type = "sine";
    R.lfoB = ctx.createOscillator(); R.lfoB.type = "sine";
    // quadrature for B via two cascaded allpasses tuned to lfo freq
    R.ap1 = ctx.createBiquadFilter(); R.ap1.type = "allpass"; R.ap1.Q.value = 0.62;
    R.ap2 = ctx.createBiquadFilter(); R.ap2.type = "allpass"; R.ap2.Q.value = 0.62;
    R.lfoA.connect(R.ap1); R.ap1.connect(R.ap2);

    R.depL = ctx.createGain(); R.depL.gain.value = 0;
    R.depR = ctx.createGain(); R.depR.gain.value = 0;
    R.lfoA.connect(R.depL); R.depL.connect(R.dlH[0].delayTime);
    R.ap2.connect(R.depR); R.depR.connect(R.dlH[1].delayTime);

    // mic shadow gains (amplitude modulation)
    R.micL = ctx.createGain(); R.micL.gain.value = 0.65;
    R.micR = ctx.createGain(); R.micR.gain.value = 0.65;
    const shL = ctx.createGain(), shR = ctx.createGain();
    shL.gain.value = 0.33; shR.gain.value = 0.33;
    R.lfoA.connect(shL); shL.connect(R.micL.gain);
    R.ap2.connect(shR); shR.connect(R.micR.gain);

    R.panL = ctx.createStereoPanner(); R.panL.pan.value = -0.8;
    R.panR = ctx.createStereoPanner(); R.panR.pan.value = 0.8;

    R.dlH[0].connect(R.micL); R.micL.connect(R.panL);
    R.dlH[1].connect(R.micR); R.micR.connect(R.panR);

    // drum: amplitude tremolo, mono
    R.trem = ctx.createGain(); R.trem.gain.value = 0.8;
    R.shDrum = ctx.createGain(); R.shDrum.gain.value = 0.22;
    R.lfoA.connect(R.shDrum); R.shDrum.connect(R.trem.gain);

    R.panL.connect(O.outVol); R.panR.connect(O.outVol);
    R.tremOut = ctx.createGain();
    R.trem.connect(R.tremOut); R.tremOut.connect(O.outVol);

    R.xHi.connect(R.dlH[0]); R.xHi.connect(R.dlH[1]);
    R.xLo.connect(R.trem);

    R.lfoA.start(); R.lfoB.start();

    R.speed = function (mode, depthKnob) {
      const now = ctx.currentTime;
      const freqs = { off: 0.06, slow: 0.78, fast: 6.8 };
      const f = freqs[mode] != null ? freqs[mode] : 6.8;
      const tc = mode === "off" ? 1.3 : (mode === "fast" ? 0.5 : 0.35);
      R.lfoA.frequency.setTargetAtTime(f, now, tc);
      // keep B in quadrature-ish
      R.ap1.frequency.setTargetAtTime(Math.max(0.05, f), now, tc);
      R.ap2.frequency.setTargetAtTime(Math.max(0.05, f), now, tc);
      const dopScale = T.clamp(f / 6.8, 0.1, 1);
      const dep = (0.00028 + depthKnob * 0.0011) * dopScale;
      R.depL.gain.setTargetAtTime(dep, now, tc);
      R.depR.gain.setTargetAtTime(dep, now, tc);
      const ampDep = 0.33 * T.clamp(f / 6.8, 0.25, 1);
      shL.gain.setTargetAtTime(ampDep, now, tc);
      shR.gain.setTargetAtTime(ampDep, now, tc);
      R.shDrum.gain.setTargetAtTime(0.22 * T.clamp(f / 6.8, 0.3, 1), now, tc);
      R.trem.gain.setTargetAtTime(1 - 0.22 * T.clamp(f / 6.8, 0.3, 1), now, tc);
      R.dlH.forEach(d => d.delayTime.setTargetAtTime(R.baseDelay, now, tc));
    };

    // wire: preFx -> scanner -> rotary (+ hard bypass)
    O.scanIn.connect(O.dryGate);      // feed the dry-bypass path (used when VIB = OFF)
    O.scanOut.connect(R.in);
    O.dryGate.connect(R.in);

    // ---------- voices ----------
    function drawbarLevels() { return T.state.program.organ.drawbars; }

    O.noteOn = function (midi, vel, when) {
      when = when == null ? ctx.currentTime : when;
      if (O.voices.has(midi)) O.noteOff(midi, when);
      const P = T.state.program.organ;
      const f0 = T.midiToFreq(midi);
      const bars = drawbarLevels();

      const oscs = [], gains = [];
      try {
        for (let i = 0; i < 9; i++) {
          const lv = bars[i];
          if (!lv) continue;
          const f = f0 * HARMONICS[i];
          if (!isFinite(f) || f > ctx.sampleRate * 0.45) continue;   // skip missing/too-high harmonics
          const osc = ctx.createOscillator();
          osc.type = "sine";
          osc.frequency.value = f;
          osc.detune.value = (Math.random() * 2 - 1) * 2.2;
          const g = ctx.createGain();
          g.gain.value = 0;
          const target = DRAW_GAIN[lv] * (HARM_TRIM[i] || 0.8) * 0.32;
          g.gain.setValueAtTime(0, when);
          g.gain.linearRampToValueAtTime(target, when + 0.006);
          osc.connect(g); g.connect(O.scanIn);
          O.driftAmt.connect(osc.detune);
          osc.start(when);
          oscs.push(osc); gains.push({ node: g, idx: i, lv });
        }
      } catch (e) {
        // never leave partially-started oscillators running (that = a stuck note)
        oscs.forEach(o => { try { o.stop(); o.disconnect(); } catch (_) {} });
        console.error("organ.noteOn", e);
        return;
      }

      const v = { oscs, gains, on: true };
      O.voices.set(midi, v);
      if (O.voices.size > O.cap) {
        const first = O.voices.keys().next().value;
        O.noteOff(first, when);
      }

      O.playClick(when, vel, false);
      O.firePerc(f0, when);
      O.percArmed = false;
    };

    O.noteOff = function (midi, when) {
      when = when == null ? ctx.currentTime : when;
      const v = O.voices.get(midi);
      if (!v || !v.on) return;
      v.on = false;
      v.oscs.forEach(o => { try { o.stop(when + 0.09); } catch (e) {} });
      v.gains.forEach(g => {
        try { g.node.gain.cancelScheduledValues(when); } catch (e) {}
        g.node.gain.setTargetAtTime(0, when, 0.014);
      });
      setTimeout(() => {
        v.gains.forEach(g => { try { g.node.disconnect(); O.driftAmt.disconnect(g.node); } catch (e) {} });
      }, Math.max(0, (when - ctx.currentTime) * 1000) + 220);
      O.voices.delete(midi);
      if (O.voices.size === 0) O.percArmed = true;   // classic non-retrigger rule
      O.playClick(when, 0.6, true);
    };

    O.allOff = function () {
      const now = ctx.currentTime;
      Array.from(O.voices.keys()).forEach(m => O.noteOff(m, now));
      O.killPerc(now);
    };

    // ---------- parameter updates ----------
    O.update = function (path) {
      const P = T.state.program.organ;
      const now = ctx.currentTime;
      function applyLeak() {
        const f = T.state.program.organ.on ? 1 : 0;
        const l = P.leak * P.leak;                 // quadratic feel: quiet at low settings
        O.leakGain.gain.setTargetAtTime(l * 0.009 * f, now, 0.05);
        O.humGain.gain.setTargetAtTime(l * 0.0035 * f, now, 0.05);
      }
      if (path === "*") {
        O.setScanPos(P.vib);
        R.speed(P.rotary.mode, P.rotary.depth);
        O.clickLevel = P.click * 0.9;
        applyLeak();
        return;
      }
      if (path === "organ.on") { applyLeak(); return; }
      if (path.indexOf("organ.drawbars") === 0) {
        const idx = parseInt(path.split(".")[2], 10);
        const lv = P.drawbars[idx];
        O.voices.forEach(v => {
          v.gains.forEach(g => {
            if (g.idx !== idx) return;
            g.lv = lv;
            const target = lv ? DRAW_GAIN[lv] * HARM_TRIM[idx] * 0.32 : 0;
            g.node.gain.setTargetAtTime(target, now, 0.03);
          });
        });
      }
      else if (path.indexOf("organ.vib") === 0) O.setScanPos(P.vib);
      else if (path.indexOf("organ.rotary") === 0) R.speed(P.rotary.mode, P.rotary.depth);
      else if (path === "organ.click") O.clickLevel = P.click * 0.9;
      else if (path === "organ.leak") {
        O.leakGain.gain.setTargetAtTime(P.leak * 0.012, now, 0.05);
        O.humGain.gain.setTargetAtTime(P.leak * 0.006, now, 0.05);
      }
    };

    O.setLevel = function (v) {
      O.outVol.gain.setTargetAtTime(v, ctx.currentTime, 0.03);
    };

    // init
    O.setScanPos(T.state.program.organ.vib);
    R.speed(T.state.program.organ.rotary.mode, T.state.program.organ.rotary.depth);
    O.clickLevel = T.state.program.organ.click * 0.9;
    {
      const l0 = T.state.program.organ.leak;
      const q0 = l0 * l0;
      const f0 = T.state.program.organ.on ? 1 : 0;
      O.leakGain.gain.value = q0 * 0.009 * f0;
      O.humGain.gain.value = q0 * 0.0035 * f0;
    }

    return O;
  };

})(window.THOR);
