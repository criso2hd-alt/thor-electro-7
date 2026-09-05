/* ============================================================
   THOR ELECTRO 7 — core: namespace, state, utils, storage
   ============================================================ */
"use strict";
window.THOR = window.THOR || {};
(function (T) {

  // ---------- tiny pub/sub ----------
  const listeners = {};
  T.on = function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); };
  T.emit = function (ev, data) {
    const l = listeners[ev]; if (!l) return;
    for (let i = 0; i < l.length; i++) { try { l[i](data); } catch (e) { console.error(e); } }
  };

  // ---------- utils ----------
  T.clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  T.lerp = (a, b, t) => a + (b - a) * t;
  T.midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);
  T.NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  T.noteName = m => T.NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);
  T.deepClone = obj => (typeof structuredClone === "function" ? structuredClone(obj) : JSON.parse(JSON.stringify(obj)));

  // log-mapping helper for knobs: 0..1 -> min..max exponentially
  T.mapLog = (t, min, max) => min * Math.pow(max / min, t);
  T.unmapLog = (v, min, max) => Math.log(v / min) / Math.log(max / min);

  T.dbToGain = db => Math.pow(10, db / 20);

  // ---------- storage (file:// safe) ----------
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ }
    }
  };
  T.store = store;

  // ---------- default program ----------
  T.DEFAULT_PROGRAM = {
    name: "INIT SOUND",
    organ: {
      on: true,
      drawbars: [8, 4, 8, 0, 6, 0, 0, 0, 0],   // 16' 5 1/3' 8' 4' 2 2/3' 2' 1 3/5' 1 1/3' 1'
      vib: "c3",
      click: 0.45,
      leak: 0.35,
      perc: { on: false, harm: "2nd", fast: true, soft: false },
      rotary: { mode: "fast", depth: 0.6 }
    },
    piano: {
      on: false,
      type: "grand",       // grand | upright | rhodes | wurli | clav
      x1: 0.65,            // contextual: brightness / bell / bark / tone
      x2: 0.5,             // contextual: stretch / body-index / trem / snap
      bass: 0, treble: 0
    },
    synth: {
      on: false,
      o1: { wave: "saw", oct: 0, semi: 0, lvl: 0.8 },
      o2: { wave: "saw", det: 8, lvl: 0.55 },
      sub: 0.25, noise: 0,
      uni: { on: false, det: 16, spread: 0.8 },
      filt: { type: "lp24", cut: 9000, res: 1.2, env: 2200, kt: 0.35 },
      ef: { a: 0.004, d: 0.18, s: 0.35, r: 0.22 },
      ea: { a: 0.006, d: 0.35, s: 0.75, r: 0.4 },
      vel: 0.55,
      lfo: { rate: 5.2, dest: "pit", amt: 0 },
      mode: "poly", glide: 0, drift: 0.2, bend: 2
    },
    fx: {
      fx1: { type: "off", rate: 0.9, depth: 0.5 },
      delay: { on: false, time: 0.32, div: "1/8", fb: 0.35, tone: 4200, mix: 0.22 },
      reverb: { mix: 0.24, decay: 2.1, pre: 0.02 },
      eq: { bass: 0, mid: 0, treble: 0 },
      comp: 0.25, drive: 0
    },
    levels: { organ: 0.85, piano: 0.85, synth: 0.8 }
  };

  // ---------- state ----------
  const savedProgram = store.get("thor_program", null);
  const prog = savedProgram ? Object.assign(T.deepClone(T.DEFAULT_PROGRAM), savedProgram) : T.deepClone(T.DEFAULT_PROGRAM);
  // deep-merge nested groups that may be missing after version changes
  ["organ", "piano", "synth", "fx", "levels"].forEach(k => {
    prog[k] = Object.assign(T.deepClone(T.DEFAULT_PROGRAM[k]), prog[k] || {});
  });

  T.settings = Object.assign({ masterVol: 0.78, kbOct: 3 }, store.get("thor_settings", {}));
  T.state = {
    program: prog,
    programIndex: store.get("thor_progIndex", 0),
    powered: false,
    sustain: false,
    bendCents: 0,
    modWheel: 0
  };

  // path helpers ------------------------------------------------
  T.getPath = function (obj, path) {
    const parts = path.split(".");
    let o = obj;
    for (let i = 0; i < parts.length; i++) {
      if (o == null) return undefined;
      o = o[parts[i]];
    }
    return o;
  };
  T.setPath = function (obj, path, val) {
    const parts = path.split(".");
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (o[parts[i]] == null) o[parts[i]] = {};
      o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = val;
  };

  // value formatters --------------------------------------------
  const fmt = {
    pct: v => Math.round(v * 100) + "%",
    db: v => (v > 0 ? "+" : "") + v.toFixed(1) + " dB",
    hz: v => v >= 1000 ? (v / 1000).toFixed(2) + " kHz" : Math.round(v) + " Hz",
    ms: v => Math.round(v * 1000) + " ms",
    sec: v => v < 1 ? Math.round(v * 1000) + " ms" : v.toFixed(2) + " s",
    cent: v => Math.round(v) + " ct",
    semi: v => (v > 0 ? "+" : "") + Math.round(v) + " st",
    bpm: v => Math.round(v) + " BPM",
    hzr: v => v.toFixed(2) + " Hz",
    raw1: v => v.toFixed(1),
    int: v => String(Math.round(v))
  };
  T.fmt = fmt;

  // persist helpers ---------------------------------------------
  let persistTimer = null;
  T.persistProgram = function () {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      store.set("thor_program", T.state.program);
      store.set("thor_progIndex", T.state.programIndex);
    }, 400);
  };
  T.persistSettings = function () {
    store.set("thor_settings", T.settings);
  };

  // error surface (visible in headless screenshots too)
  window.addEventListener("error", e => {
    const d = document.getElementById("errdump");
    if (!d) return;
    d.classList.add("show");
    d.textContent += "[error] " + e.message + " @" + (e.filename || "") + ":" + e.lineno + "\n";
  });
  window.addEventListener("unhandledrejection", e => {
    const d = document.getElementById("errdump");
    if (!d) return;
    d.classList.add("show");
    d.textContent += "[promise] " + (e.reason && e.reason.message ? e.reason.message : e.reason) + "\n";
  });

})(window.THOR);
