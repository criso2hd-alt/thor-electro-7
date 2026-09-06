/* ============================================================
   THOR ELECTRO 7 — analog modeling synth
   2 osc + sub + noise, unison stack, multimode filter,
   dual ADSR, syncable LFO, poly/mono/legato, glide, drift
   ============================================================ */
"use strict";
(function (T) {

  T.buildSynth = function (ctx, dest) {

    const S = { voices: new Map(), monoStack: [], lastFreq: null };

    S.bus = ctx.createGain(); S.bus.connect(dest);

    // ---------- shared modulation ----------
    S.bendSrc = ctx.createConstantSource(); S.bendSrc.offset.value = 0; S.bendSrc.start();
    S.driftSrc = ctx.createConstantSource(); S.driftSrc.offset.value = 0; S.driftSrc.start();

    S.lfoOsc = ctx.createOscillator(); S.lfoOsc.type = "sine";
    S.lfoOsc.frequency.value = T.state.program.synth.lfo.rate;
    S.lfoCutG = ctx.createGain(); S.lfoCutG.gain.value = 0;
    S.lfoPitchG = ctx.createGain(); S.lfoPitchG.gain.value = 0;
    S.lfoAmpG = ctx.createGain(); S.lfoAmpG.gain.value = 0;
    S.lfoOsc.connect(S.lfoCutG); S.lfoOsc.connect(S.lfoPitchG); S.lfoOsc.connect(S.lfoAmpG);
    S.lfoOsc.start();

    // dedicated MOD-WHEEL vibrato: a fixed ~5.5 Hz LFO on pitch, independent of the
    // patch LFO, so the wheel always adds musical vibrato on any synth sound.
    S.modWheel = 0;
    S.modLfo = ctx.createOscillator(); S.modLfo.type = "sine"; S.modLfo.frequency.value = 5.5;
    S.modLfoG = ctx.createGain(); S.modLfoG.gain.value = 0;
    S.modLfo.connect(S.modLfoG); S.modLfo.start();

    const noiseBuf = (function () {
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp += 0.42 * ((Math.random() * 2 - 1) - lp);
        d[i] = lp;
      }
      return buf;
    })();
    S.noiseSrc = ctx.createBufferSource();
    S.noiseSrc.buffer = noiseBuf; S.noiseSrc.loop = true; S.noiseSrc.start();

    let pulseWave = null;
    function getPulse() {
      if (!pulseWave) {
        const n = 24;
        const real = new Float32Array(n), imag = new Float32Array(n);
        for (let k = 1; k < n; k++) {
          imag[k] = (2 / (k * Math.PI)) * Math.sin(Math.PI * k * 0.28);
        }
        pulseWave = ctx.createPeriodicWave(real, imag);
      }
      return pulseWave;
    }

    function makeOsc(wave, freq) {
      const o = ctx.createOscillator();
      if (wave === "pls") { o.setPeriodicWave(getPulse()); o.frequency.value = freq; }
      else { o.type = wave === "saw" ? "sawtooth" : wave; o.frequency.value = freq; }
      return o;
    }

    // ---------- filter builder ----------
    function buildFilter(type, res) {
      if (type === "lp24") {
        const f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter();
        f1.type = "lowpass"; f2.type = "lowpass";
        f1.Q.value = res * 0.72; f2.Q.value = res * 0.72;
        f1.connect(f2);
        return { head: f1, tail: f2, nodes: [f1, f2] };
      }
      const f = ctx.createBiquadFilter();
      if (type === "lp12") { f.type = "lowpass"; f.Q.value = res; }
      else if (type === "bp") { f.type = "bandpass"; f.Q.value = res; }
      else { f.type = "highpass"; f.Q.value = res; }
      return { head: f, tail: f, nodes: [f] };
    }

    function velFactor(vel) {
      const vs = T.state.program.synth.vel;
      return 1 - vs * 0.85 + vs * 0.85 * vel;
    }

    // ---------- voice ----------
    function createVoice(midi, vel, when, legatoRetrigger) {
      const P = T.state.program.synth;
      const f0 = T.midiToFreq(midi);
      const v = { midi, on: true, t: when };

      const preFilter = ctx.createGain(); preFilter.gain.value = 1;

      // --- oscillators ---
      const oscs = [];
      function addOsc(wave, freq, level, panv, detCents) {
        if (level <= 0.001) return;
        const o = makeOsc(wave, freq);
        o.detune.value = detCents || 0;
        S.bendSrc.connect(o.detune);
        const g = ctx.createGain(); g.gain.value = level;
        const pn = panv != null ? ctx.createStereoPanner() : null;
        if (pn) { pn.pan.value = panv; o.connect(g); g.connect(pn); pn.connect(preFilter); }
        else { o.connect(g); g.connect(preFilter); }
        S.lfoPitchG.connect(o.detune);
        S.modLfoG.connect(o.detune);        // mod-wheel vibrato
        o.start(when);
        oscs.push(o);
      }

      if (P.uni.on) {
        const N = 5;
        for (let i = 0; i < N; i++) {
          const spreadDet = (i / (N - 1) - 0.5) * 2 * P.uni.det;
          const panv = (i / (N - 1) - 0.5) * 2 * P.uni.spread * 0.85;
          addOsc(P.o1.wave, f0, 0.85 / N * 1.6, panv, spreadDet + (Math.random() * 2 - 1) * P.drift * 7);
        }
        if (P.sub > 0.01) addOsc("square", f0 / 2, P.sub * 0.35, null, 0);
      } else {
        addOsc(P.o1.wave, f0 * Math.pow(2, P.o1.oct) * Math.pow(2, P.o1.semi / 12),
          P.o1.lvl * 0.55, null, (Math.random() * 2 - 1) * P.drift * 7);
        addOsc(P.o2.wave, f0, P.o2.lvl * 0.5, null, P.o2.det + (Math.random() * 2 - 1) * P.drift * 7);
        if (P.sub > 0.01) addOsc("square", f0 / 2, P.sub * 0.4, null, 0);
      }

      // noise tap
      if (P.noise > 0.005) {
        const ns = ctx.createBufferSource(); ns.buffer = S.noiseSrc.buffer; ns.loop = true;
        const ng = ctx.createGain(); ng.gain.value = P.noise * 0.3;
        ns.connect(ng); ng.connect(preFilter); ns.start(when);
        oscs.push(ns);
      }

      // --- glide ---
      const doGlide = (P.mode !== "poly") && P.glide > 0.005 && S.lastFreq != null && !legatoRetrigger;
      oscs.forEach(o => {
        if (o.frequency && doGlide) {
          o.frequency.setValueAtTime(S.lastFreq, when);
          o.frequency.exponentialRampToValueAtTime(Math.max(20, o.frequency.value), when + P.glide);
        }
      });
      S.lastFreq = f0;

      // --- filter ---
      const F = buildFilter(P.filt.type, P.filt.res);
      preFilter.connect(F.head);
      const vca = ctx.createGain(); vca.gain.value = 0;
      F.tail.connect(vca);
      vca.connect(S.bus);           // route the voice into the synth output bus

      // filter env (on detune, cents)
      const baseCents = P.filt.kt * (midi - 60) * 100;
      const envAmt = P.filt.env * velFactor(vel);
      const fd = F.nodes[0].detune;
      F.nodes.forEach(fn => {
        fn.frequency.value = T.clamp(P.filt.cut, 25, 20000);
        S.lfoCutG.connect(fn.detune);
      });
      if (!legatoRetrigger || P.mode === "poly") {
        F.nodes.forEach(fn => {
          const d = fn.detune;
          d.setValueAtTime(baseCents, when);
          d.linearRampToValueAtTime(baseCents + envAmt, when + Math.max(0.001, P.ef.a));
          d.setTargetAtTime(baseCents + envAmt * P.ef.s, when + Math.max(0.001, P.ef.a), Math.max(0.01, P.ef.d) / 3);
        });
      } else {
        F.nodes.forEach(fn => fn.detune.setValueAtTime(baseCents + envAmt * P.ef.s, when));
      }

      // --- amp env ---
      const peak = (0.22 + 0.5 * vel) * velFactor(vel);
      const a = Math.max(0.0015, P.ea.a);
      if (!legatoRetrigger) {
        vca.gain.setValueAtTime(0, when);
        vca.gain.linearRampToValueAtTime(peak, when + a);
        vca.gain.setTargetAtTime(peak * P.ea.s, when + a, Math.max(0.01, P.ea.d) / 3);
      } else {
        vca.gain.setValueAtTime(peak * P.ea.s * 0.9, when);
      }
      S.lfoAmpG.connect(vca.gain);

      v.oscs = oscs; v.preFilter = preFilter; v.F = F; v.vca = vca; v.baseCents = baseCents;
      v.envAmt = envAmt; v.peak = peak;
      return v;
    }

    function killVoice(v, when, tau) {
      if (!v || !v.on) return;
      v.on = false;
      tau = tau == null ? Math.max(0.015, T.state.program.synth.ea.r / 3) : tau;
      try { v.vca.gain.cancelScheduledValues(when); } catch (e) {}
      v.vca.gain.setTargetAtTime(0, when, tau);
      const stopAt = when + tau * 8 + 0.12;
      v.F.nodes.forEach(fn => {
        fn.detune.cancelScheduledValues(when);
        fn.detune.setTargetAtTime(0, when, tau);
      });
      v.oscs.forEach(o => { try { o.stop(stopAt); } catch (e) {} });
      setTimeout(() => {
        try { v.vca.disconnect(); v.preFilter.disconnect(); } catch (e) {}
        v.F.nodes.forEach(fn => { try { fn.disconnect(); } catch (e) {} });
      }, Math.max(0, (stopAt - ctx.currentTime) * 1000) + 150);
    }

    // ---------- API ----------
    S.noteOn = function (midi, vel, when) {
      when = when == null ? ctx.currentTime : when;
      const P = T.state.program.synth;
      if (P.mode !== "poly") {
        const prev = S.voices.get(S.monoStack[S.monoStack.length - 1]);
        const legato = P.mode === "legato" && S.monoStack.length > 0;
        S.monoStack = S.monoStack.filter(m => m !== midi);
        S.monoStack.push(midi);
        const v = createVoice(midi, vel, when, legato);
        S.voices.set(midi, v);
        if (prev && prev !== v) killVoice(prev, when, 0.02);
        return;
      }
      const old = S.voices.get(midi);
      if (old) killVoice(old, when, 0.012);
      const cap = P.uni.on ? 8 : 14;
      if (S.voices.size >= cap) {
        const firstKey = S.voices.keys().next().value;
        killVoice(S.voices.get(firstKey), when, 0.03);
        S.voices.delete(firstKey);
      }
      S.voices.set(midi, createVoice(midi, vel, when, false));
    };

    S.noteOff = function (midi, when) {
      when = when == null ? ctx.currentTime : when;
      if (T.state.sustain) {
        const v = S.voices.get(midi);
        if (v && v.on) { v.sustainHold = true; return; }
      }
      if (T.state.program.synth.mode !== "poly") {
        S.monoStack = S.monoStack.filter(m => m !== midi);
      }
      const v = S.voices.get(midi);
      if (v) { killVoice(v, when); S.voices.delete(midi); }
    };

    S.sustainDown = function () {};
    S.sustainUp = function (when) {
      when = when == null ? ctx.currentTime : when;
      S.voices.forEach((v, midi) => {
        if (v.sustainHold) {
          v.sustainHold = false;
          if (T.state.program.synth.mode !== "poly") {
            S.monoStack = S.monoStack.filter(m => m !== midi);
          }
          killVoice(v, when);
          S.voices.delete(midi);
        }
      });
    };

    S.allOff = function (when) {
      when = when == null ? ctx.currentTime : when;
      S.voices.forEach(v => killVoice(v, when, 0.02));
      S.voices.clear();
      S.monoStack.length = 0;
    };

    // ---------- params ----------
    function refreshLfoRouting() {
      const P = T.state.program.synth;
      const now = ctx.currentTime;
      const amt = P.lfo.amt;
      S.lfoOsc.frequency.setTargetAtTime(P.lfo.rate, now, 0.02);
      S.lfoCutG.gain.setTargetAtTime(P.lfo.dest === "cut" ? amt * 2400 : 0, now, 0.02);
      S.lfoPitchG.gain.setTargetAtTime(P.lfo.dest === "pit" ? amt * 70 : 0, now, 0.02);
      S.lfoAmpG.gain.setTargetAtTime(P.lfo.dest === "amp" ? amt * 0.4 : 0, now, 0.02);
    }

    S.update = function (path) {
      if (path.indexOf("synth.lfo") === 0 || path === "*") refreshLfoRouting();
    };

    S.setLevel = function (v) { S.bus.gain.setTargetAtTime(v, ctx.currentTime, 0.03); };
    S.setBend = function (cents) { S.bendSrc.offset.setTargetAtTime(cents, ctx.currentTime, 0.015); };
    S.setModWheel = function (mw) {
      S.modWheel = mw;
      S.modLfoG.gain.setTargetAtTime(mw * 100, ctx.currentTime, 0.04);   // up to ~1 semitone vibrato
    };

    refreshLfoRouting();

    return S;
  };

})(window.THOR);
