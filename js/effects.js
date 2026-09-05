/* ============================================================
   THOR ELECTRO 7 — master effects: FX1, delay, reverb, EQ,
   drive, compressor, limiter
   ============================================================ */
"use strict";
(function (T) {

  function makeDriveCurve(amount) {
    const n = 1024, curve = new Float32Array(n);
    const k = 1 + amount * 16;
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / norm;
    }
    return curve;
  }

  T.buildEffects = function (ctx) {

    const E = {};

    // ================= top-level routing =================
    E.input = ctx.createGain();
    E.fx1In = ctx.createGain();
    E.fx1Out = ctx.createGain();
    E.eqLow = ctx.createBiquadFilter();  E.eqLow.type = "lowshelf";  E.eqLow.frequency.value = 160;
    E.eqMid = ctx.createBiquadFilter();  E.eqMid.type = "peaking";   E.eqMid.frequency.value = 750; E.eqMid.Q.value = 0.9;
    E.eqHigh = ctx.createBiquadFilter(); E.eqHigh.type = "highshelf"; E.eqHigh.frequency.value = 3800;

    E.drivePre = ctx.createGain();
    E.shaper = ctx.createWaveShaper(); E.shaper.oversample = "2x";
    E.drivePost = ctx.createGain();

    E.postFx = ctx.createGain();

    E.comp = ctx.createDynamicsCompressor();
    E.comp.attack.value = 0.006; E.comp.release.value = 0.18; E.comp.knee.value = 18;
    E.makeup = ctx.createGain();
    E.limiter = ctx.createDynamicsCompressor();
    E.limiter.threshold.value = -2; E.limiter.knee.value = 0;
    E.limiter.ratio.value = 20; E.limiter.attack.value = 0.001; E.limiter.release.value = 0.09;
    E.master = ctx.createGain();
    E.analyser = ctx.createAnalyser(); E.analyser.fftSize = 512;

    E.input.connect(E.fx1In);
    E.fx1Out.connect(E.eqLow); E.eqLow.connect(E.eqMid); E.eqMid.connect(E.eqHigh);
    E.eqHigh.connect(E.drivePre); E.drivePre.connect(E.shaper); E.shaper.connect(E.drivePost);
    E.drivePost.connect(E.postFx);
    E.postFx.connect(E.comp); E.comp.connect(E.makeup); E.makeup.connect(E.limiter);
    E.limiter.connect(E.master); E.master.connect(E.analyser); E.analyser.connect(ctx.destination);

    // ================= FX1 chains =================
    const fx1 = { chains: {}, cur: null };

    function mkChain(name, build) {
      const c = { name };
      c.inp = ctx.createGain(); c.inp.gain.value = 0;
      c.outp = ctx.createGain(); c.outp.gain.value = 0;
      build(c);                       // must wire c.inp -> ... -> c.outp
      fx1.chains[name] = c;
    }

    mkChain("off", c => { c.inp.connect(c.outp); });

    mkChain("trem", c => {
      c.mod = ctx.createGain(); c.mod.gain.value = 1;
      c.lfo = ctx.createOscillator(); c.lfo.type = "sine";
      c.dep = ctx.createGain(); c.dep.gain.value = 0;
      c.lfo.connect(c.dep); c.dep.connect(c.mod.gain); c.lfo.start();
      c.inp.connect(c.mod); c.mod.connect(c.outp);
    });

    mkChain("pan", c => {
      c.pan = ctx.createStereoPanner();
      c.lfo = ctx.createOscillator(); c.lfo.type = "sine";
      c.dep = ctx.createGain(); c.dep.gain.value = 0;
      c.lfo.connect(c.dep); c.dep.connect(c.pan.pan); c.lfo.start();
      c.inp.connect(c.pan); c.pan.connect(c.outp);
    });

    mkChain("wah", c => {
      c.bp = ctx.createBiquadFilter(); c.bp.type = "bandpass";
      c.bp.frequency.value = 800; c.bp.Q.value = 4.5;
      c.mk = ctx.createGain(); c.mk.gain.value = 2.4;
      c.lfo = ctx.createOscillator(); c.lfo.type = "triangle";
      c.dep = ctx.createGain(); c.dep.gain.value = 600;
      c.lfo.connect(c.dep); c.dep.connect(c.bp.frequency); c.lfo.start();
      c.inp.connect(c.bp); c.bp.connect(c.mk); c.mk.connect(c.outp);
    });

    mkChain("pha", c => {
      const head = ctx.createGain();
      c.wet = ctx.createGain(); c.wet.gain.value = 0.7;
      c.lfo = ctx.createOscillator(); c.lfo.type = "sine";
      c.dep = ctx.createGain(); c.dep.gain.value = 900;
      c.lfo.connect(c.dep); c.lfo.start();
      let prev = head;
      for (let i = 0; i < 6; i++) {
        const ap = ctx.createBiquadFilter();
        ap.type = "allpass"; ap.frequency.value = 420 + i * 240; ap.Q.value = 0.7;
        prev.connect(ap); prev = ap;
        c.dep.connect(ap.frequency);
      }
      const fb = ctx.createGain(); fb.gain.value = 0.5;
      prev.connect(fb); fb.connect(head);
      c.inp.connect(head);
      prev.connect(c.wet); c.wet.connect(c.outp);
      const dry = ctx.createGain(); dry.gain.value = 0.4;
      c.inp.connect(dry); dry.connect(c.outp);
    });

    mkChain("cho", c => {
      const split = ctx.createGain();
      c.dl = ctx.createDelay(0.08); c.dr = ctx.createDelay(0.08);
      c.dl.delayTime.value = 0.017; c.dr.delayTime.value = 0.019;
      const pl = ctx.createStereoPanner(), pr = ctx.createStereoPanner();
      pl.pan.value = -0.8; pr.pan.value = 0.8;
      c.lf = ctx.createOscillator(); c.lf.type = "sine";
      c.rf = ctx.createOscillator(); c.rf.type = "sine";
      c.dlG = ctx.createGain(); c.dlG.gain.value = 0.003;
      c.drG = ctx.createGain(); c.drG.gain.value = 0.003;
      c.lf.connect(c.dlG); c.dlG.connect(c.dl.delayTime);
      c.rf.connect(c.drG); c.drG.connect(c.dr.delayTime);
      c.lf.start(); c.rf.start();
      split.connect(c.dl); split.connect(c.dr);
      c.dl.connect(pl); c.dr.connect(pr);
      c.wet = ctx.createGain(); c.wet.gain.value = 1;
      pl.connect(c.wet); pr.connect(c.wet);
      const dry = ctx.createGain(); dry.gain.value = 0.62;
      c.inp.connect(split); c.inp.connect(dry);
      c.wet.connect(c.outp); dry.connect(c.outp);
    });

    mkChain("fla", c => {
      const split = ctx.createGain();
      c.dl = ctx.createDelay(0.05); c.dr = ctx.createDelay(0.05);
      c.dl.delayTime.value = 0.0028; c.dr.delayTime.value = 0.0028;
      c.dampen = ctx.createBiquadFilter(); c.dampen.type = "lowpass"; c.dampen.frequency.value = 9000;
      const fb = ctx.createGain(); fb.gain.value = 0.58;
      c.lf = ctx.createOscillator(); c.lf.type = "triangle";
      c.dlG = ctx.createGain(); c.dlG.gain.value = 0.001;
      c.drG = ctx.createGain(); c.drG.gain.value = 0.001;
      c.lf.connect(c.dlG); c.dlG.connect(c.dl.delayTime);
      c.lf.connect(c.drG); c.drG.connect(c.dr.delayTime);
      c.lf.start();
      split.connect(c.dl); split.connect(c.dr);
      c.dl.connect(c.dampen); c.dampen.connect(fb); fb.connect(split);
      const pl = ctx.createStereoPanner(); pl.pan.value = -0.7;
      const inv = ctx.createGain(); inv.gain.value = -1;
      const pr = ctx.createStereoPanner(); pr.pan.value = 0.7;
      c.dl.connect(pl); c.dr.connect(inv); inv.connect(pr);
      c.wet = ctx.createGain(); c.wet.gain.value = 0.85;
      pl.connect(c.wet); pr.connect(c.wet);
      const dry = ctx.createGain(); dry.gain.value = 0.5;
      c.inp.connect(split); c.inp.connect(dry);
      c.wet.connect(c.outp); dry.connect(c.outp);
    });

    function setFX1(type, rate, depth) {
      const P = T.state.program.fx.fx1;
      type = type || P.type;
      rate = (rate == null ? P.rate : rate);
      depth = (depth == null ? P.depth : depth);
      const now = ctx.currentTime;
      if (fx1.cur && fx1.cur !== fx1.chains[type]) {
        try { E.fx1In.disconnect(fx1.cur.inp); } catch (e) {}
        try { fx1.cur.outp.disconnect(E.fx1Out); } catch (e) {}
        fx1.cur.inp.gain.setTargetAtTime(0, now, 0.01);
        fx1.cur.outp.gain.setTargetAtTime(0, now, 0.01);
      }
      const c = fx1.chains[type] || fx1.chains.off;
      if (fx1.cur !== c) {
        c.inp.gain.setTargetAtTime(1, now, 0.01);
        c.outp.gain.setTargetAtTime(1, now, 0.01);
        E.fx1In.connect(c.inp);
        c.outp.connect(E.fx1Out);
      }
      fx1.cur = c;

      switch (type) {
        case "trem":
          c.lfo.frequency.setTargetAtTime(rate, now, 0.02);
          c.dep.gain.setTargetAtTime(depth * 0.85, now, 0.02); break;
        case "pan":
          c.lfo.frequency.setTargetAtTime(rate, now, 0.02);
          c.dep.gain.setTargetAtTime(depth * 0.95, now, 0.02); break;
        case "wah":
          c.lfo.frequency.setTargetAtTime(rate * 0.45, now, 0.02);
          c.bp.frequency.setTargetAtTime(1200 - depth * 700, now, 0.02);
          c.dep.gain.setTargetAtTime(300 + depth * 900, now, 0.02); break;
        case "pha":
          c.lfo.frequency.setTargetAtTime(Math.max(0.02, rate * 0.35), now, 0.02);
          c.dep.gain.setTargetAtTime(300 + depth * 1400, now, 0.02);
          c.wet.gain.setTargetAtTime(0.35 + depth * 0.65, now, 0.02); break;
        case "cho":
          c.lf.frequency.setTargetAtTime(rate * 0.9, now, 0.02);
          c.rf.frequency.setTargetAtTime(rate * 0.9 * 1.13, now, 0.02);
          c.dlG.gain.setTargetAtTime(0.001 + depth * 0.007, now, 0.02);
          c.drG.gain.setTargetAtTime(0.001 + depth * 0.007, now, 0.02); break;
        case "fla":
          c.lf.frequency.setTargetAtTime(Math.max(0.02, rate * 0.25), now, 0.02);
          c.dlG.gain.setTargetAtTime(0.0002 + depth * 0.0022, now, 0.02);
          c.drG.gain.setTargetAtTime(0.0002 + depth * 0.0022, now, 0.02); break;
      }
    }
    E.setFX1 = setFX1;

    // ================= DELAY (ping-pong) =================
    const DLY = {};
    DLY.send = ctx.createGain(); DLY.send.gain.value = 0;
    DLY.hp = ctx.createBiquadFilter(); DLY.hp.type = "highpass"; DLY.hp.frequency.value = 150;
    DLY.dl = ctx.createDelay(1.5); DLY.dr = ctx.createDelay(1.5);
    DLY.lpL = ctx.createBiquadFilter(); DLY.lpL.type = "lowpass"; DLY.lpL.frequency.value = 4200;
    DLY.lpR = ctx.createBiquadFilter(); DLY.lpR.type = "lowpass"; DLY.lpR.frequency.value = 4200;
    DLY.fbL = ctx.createGain(); DLY.fbR = ctx.createGain();
    DLY.pl = ctx.createStereoPanner(); DLY.pl.pan.value = -0.75;
    DLY.pr = ctx.createStereoPanner(); DLY.pr.pan.value = 0.75;
    DLY.wet = ctx.createGain();

    DLY.send.connect(DLY.hp); DLY.hp.connect(DLY.dl);
    DLY.dl.connect(DLY.lpL); DLY.lpL.connect(DLY.fbL); DLY.fbL.connect(DLY.dr);
    DLY.dr.connect(DLY.lpR); DLY.lpR.connect(DLY.fbR); DLY.fbR.connect(DLY.dl);
    DLY.dl.connect(DLY.pl); DLY.dr.connect(DLY.pr);
    DLY.pl.connect(DLY.wet); DLY.pr.connect(DLY.wet);
    DLY.wet.connect(E.postFx);
    E.drivePost.connect(DLY.send);      // feed the delay from the processed (post-EQ/drive) signal

    function divBeats(div) {
      switch (div) {
        case "1/4": return 1;
        case "1/8": return 0.5;
        case "3/16": return 0.75;
        case "1/16": return 0.25;
        default: return null;
      }
    }
    function updateDelayTime() {
      const P = T.state.program.fx.delay;
      let t = P.time;
      const b = divBeats(P.div);
      if (b != null && T.Seq && T.Seq.song) t = Math.min(1.4, b * 60 / T.Seq.song.bpm);
      const now = ctx.currentTime;
      DLY.dl.delayTime.setTargetAtTime(T.clamp(t, 0.04, 1.45), now, 0.08);
      DLY.dr.delayTime.setTargetAtTime(T.clamp(t, 0.04, 1.45), now, 0.08);
    }
    E.updateDelayTime = updateDelayTime;

    // ================= REVERB =================
    const RV = {};
    RV.send = ctx.createGain(); RV.send.gain.value = 0;
    RV.pre = ctx.createDelay(0.5); RV.pre.delayTime.value = 0.02;
    RV.conv = ctx.createConvolver(); RV.conv.normalize = true;
    RV.damp = ctx.createBiquadFilter(); RV.damp.type = "lowpass"; RV.damp.frequency.value = 8500;
    RV.wet = ctx.createGain();

    RV.send.connect(RV.pre); RV.pre.connect(RV.conv);
    RV.conv.connect(RV.damp); RV.damp.connect(RV.wet);
    RV.wet.connect(E.postFx);
    E.drivePost.connect(RV.send);       // feed the reverb from the processed (post-EQ/drive) signal

    let irTimer = null;
    function buildIR(decay) {
      const sr = ctx.sampleRate;
      const len = Math.max(256, Math.floor(sr * Math.min(12, decay)));
      const buf = ctx.createBuffer(2, len, sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let lp = 0;
        const tau = decay / 3;
        for (let i = 0; i < len; i++) {
          const t = i / sr;
          const env = Math.exp(-3 * t / tau) * Math.min(1, t * 90);
          lp += 0.32 * ((Math.random() * 2 - 1) - lp);
          d[i] = lp * env * 0.6;
        }
        for (let r = 0; r < 7; r++) {
          const pos = Math.floor(sr * (0.008 + Math.random() * 0.075));
          if (pos < len) d[pos] += (Math.random() * 0.5 + 0.3) * (ch ? -1 : 1);
        }
      }
      return buf;
    }
    function updateReverbIR() {
      clearTimeout(irTimer);
      irTimer = setTimeout(() => {
        try { RV.conv.buffer = buildIR(T.state.program.fx.reverb.decay); } catch (e) {}
      }, 300);
    }
    E.updateReverbIR = updateReverbIR;

    // ================= parameter application =================
    E.update = function (path) {
      const P = T.state.program.fx;
      const now = ctx.currentTime;
      const st = (ap, v, tc) => ap.setTargetAtTime(v, now, tc == null ? 0.03 : tc);

      if (path.indexOf("fx.fx1") === 0 || path === "*") setFX1(P.fx1.type, P.fx1.rate, P.fx1.depth);

      if (path.indexOf("fx.delay") === 0 || path === "*") {
        st(DLY.send.gain, P.delay.on ? P.delay.mix : 0);
        st(DLY.wet.gain, P.delay.on ? 1 : 0);
        st(DLY.fbL.gain, P.delay.on ? P.delay.fb : 0, 0.05);
        st(DLY.fbR.gain, P.delay.on ? P.delay.fb : 0, 0.05);
        st(DLY.lpL.frequency, P.delay.tone);
        st(DLY.lpR.frequency, P.delay.tone);
        updateDelayTime();
      }
      if (path.indexOf("fx.reverb") === 0 || path === "*") {
        st(RV.send.gain, P.reverb.mix);
        st(RV.wet.gain, 1);
        st(RV.pre.delayTime, P.reverb.pre, 0.05);
        updateReverbIR();
      }
      if (path.indexOf("fx.eq") === 0 || path === "*") {
        st(E.eqLow.gain, P.eq.bass);
        st(E.eqMid.gain, P.eq.mid);
        st(E.eqHigh.gain, P.eq.treble);
      }
      if (path === "fx.comp" || path === "*") {
        const amt = P.comp;
        st(E.comp.threshold, -6 - amt * 30);
        st(E.comp.ratio, 1.5 + amt * 8);
        st(E.makeup.gain, T.dbToGain(amt * 7));
      }
      if (path === "fx.drive" || path === "*") {
        const amt = P.drive;
        E.shaper.curve = makeDriveCurve(amt);
        st(E.drivePre.gain, 1 + amt * 2.2);
        st(E.drivePost.gain, 1 / (1 + amt * 1.4));
      }
      if (path === "settings.masterVol" || path === "*") {
        st(E.master.gain, Math.pow(T.settings.masterVol, 1.6));
      }
    };

    E.level = function () {
      const arr = new Float32Array(E.analyser.fftSize);
      E.analyser.getFloatTimeDomainData(arr);
      let s = 0;
      for (let i = 0; i < arr.length; i++) s += arr[i] * arr[i];
      return Math.sqrt(s / arr.length) * 3.2;
    };

    E.update("*");
    setFX1();
    return E;
  };

})(window.THOR);
