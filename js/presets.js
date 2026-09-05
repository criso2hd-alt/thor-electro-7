/* ============================================================
   THOR ELECTRO 7 — factory program bank
   ============================================================ */
"use strict";
(function (T) {

  function P(name, patch) {
    const p = T.deepClone(T.DEFAULT_PROGRAM);
    p.name = name;
    (function merge(dst, src) {
      Object.keys(src).forEach(k => {
        if (src[k] && typeof src[k] === "object" && !Array.isArray(src[k])) {
          if (!dst[k]) dst[k] = {};
          merge(dst[k], src[k]);
        } else dst[k] = src[k];
      });
    })(p, patch);
    return p;
  }

  const BANK = [

    P("GOSPEL COMBUSTION", {
      organ: { on: true, drawbars: [8, 8, 8, 0, 0, 6, 0, 0, 4], vib: "c3", click: 0.6,
        perc: { on: true, harm: "2nd", fast: true, soft: false },
        rotary: { mode: "fast", depth: 0.75 }, leak: 0.4 },
      piano: { on: false }, synth: { on: false },
      fx: { fx1: { type: "off" }, reverb: { mix: 0.18, decay: 1.8 }, comp: 0.35 }
    }),

    P("JAZZ CLUB COMBO", {
      organ: { on: true, drawbars: [8, 0, 8, 8, 7, 6, 0, 0, 0], vib: "v3", click: 0.35,
        perc: { on: true, harm: "2nd", fast: false, soft: true },
        rotary: { mode: "slow", depth: 0.55 }, leak: 0.45 },
      fx: { fx1: { type: "off" }, reverb: { mix: 0.22, decay: 1.6 }, eq: { bass: 1.5 }, comp: 0.3 }
    }),

    P("ROCK CHURCH 88", {
      organ: { on: true, drawbars: [8, 8, 8, 8, 0, 0, 0, 0, 8], vib: "off", click: 0.75,
        perc: { on: true, harm: "3rd", fast: true, soft: false },
        rotary: { mode: "fast", depth: 0.85 } },
      fx: { fx1: { type: "off" }, drive: 0.25, reverb: { mix: 0.2, decay: 2.4 }, comp: 0.45 }
    }),

    P("BALLAD SLOW B3", {
      organ: { on: true, drawbars: [8, 4, 8, 4, 4, 4, 2, 0, 0], vib: "c2", click: 0.3,
        perc: { on: false }, rotary: { mode: "slow", depth: 0.5 }, leak: 0.35 },
      fx: { fx1: { type: "cho", rate: 0.7, depth: 0.4 }, reverb: { mix: 0.35, decay: 3.2 } }
    }),

    P("CONCERT GRAND", {
      organ: { on: false }, synth: { on: false },
      piano: { on: true, type: "grand", x1: 0.68, x2: 0.6, bass: 0.5, treble: 1 },
      fx: { fx1: { type: "off" }, reverb: { mix: 0.28, decay: 2.6, pre: 0.03 }, comp: 0.2 }
    }),

    P("STUDIO UPRIGHT", {
      organ: { on: false }, synth: { on: false },
      piano: { on: true, type: "upright", x1: 0.45, x2: 0.5, bass: 1, treble: -1 },
      fx: { reverb: { mix: 0.22, decay: 1.7 }, comp: 0.35 }
    }),

    P("RED RHODES MK I", {
      organ: { on: false }, synth: { on: false },
      piano: { on: true, type: "rhodes", x1: 0.55, x2: 0.5, treble: 1.5 },
      fx: { fx1: { type: "trem", rate: 4.6, depth: 0.55 }, reverb: { mix: 0.25, decay: 2.2 }, comp: 0.3 }
    }),

    P("RAW WURLITZER", {
      organ: { on: false }, synth: { on: false },
      piano: { on: true, type: "wurli", x1: 0.55, x2: 0.45 },
      fx: { fx1: { type: "trem", rate: 5.4, depth: 0.5 }, drive: 0.15, reverb: { mix: 0.2, decay: 1.9 }, comp: 0.4 }
    }),

    P("FUNK CLAVINET", {
      organ: { on: false }, synth: { on: false },
      piano: { on: true, type: "clav", x1: 0.6, x2: 0.55 },
      fx: { fx1: { type: "wah", rate: 2.2, depth: 0.55 }, delay: { on: true, div: "1/16", fb: 0.25, mix: 0.14 }, comp: 0.45, eq: { mid: 2 } }
    }),

    P("FAT SAW LEAD", {
      organ: { on: false }, piano: { on: false },
      synth: { on: true, o1: { wave: "saw", oct: 0, semi: 0, lvl: 0.85 },
        o2: { wave: "saw", det: 12, lvl: 0.6 }, sub: 0.35,
        uni: { on: true, det: 22, spread: 0.9 },
        filt: { type: "lp24", cut: 5200, res: 2.4, env: 2600, kt: 0.4 },
        ef: { a: 0.003, d: 0.22, s: 0.25, r: 0.2 },
        ea: { a: 0.005, d: 0.3, s: 0.85, r: 0.3 },
        vel: 0.5, mode: "poly", drift: 0.3 },
      fx: { fx1: { type: "cho", rate: 0.8, depth: 0.35 }, delay: { on: true, div: "3/16", fb: 0.35, mix: 0.2 },
        reverb: { mix: 0.22, decay: 2.4 }, drive: 0.2, comp: 0.3 }
    }),

    P("DREAM PAD 7th", {
      organ: { on: false }, piano: { on: false },
      synth: { on: true, o1: { wave: "tri", oct: 0, semi: 0, lvl: 0.7 },
        o2: { wave: "saw", det: 18, lvl: 0.45 }, sub: 0.15,
        filt: { type: "lp24", cut: 2600, res: 1.6, env: 1200, kt: 0.3 },
        ef: { a: 1.2, d: 2, s: 0.6, r: 1.5 },
        ea: { a: 1.6, d: 2.5, s: 0.85, r: 2.4 },
        lfo: { rate: 0.6, dest: "cut", amt: 0.25 },
        vel: 0.3, mode: "poly" },
      fx: { fx1: { type: "cho", rate: 0.5, depth: 0.6 }, delay: { on: true, div: "1/4", fb: 0.4, mix: 0.25 },
        reverb: { mix: 0.45, decay: 5.5 }, comp: 0.2 }
    }),

    P("PUNCH BASS", {
      organ: { on: false }, piano: { on: false },
      synth: { on: true, o1: { wave: "saw", oct: -1, semi: 0, lvl: 0.9 },
        o2: { wave: "pls", det: 4, lvl: 0.2 }, sub: 0.7,
        filt: { type: "lp24", cut: 900, res: 3.2, env: 2200, kt: 0.25 },
        ef: { a: 0.002, d: 0.14, s: 0.15, r: 0.12 },
        ea: { a: 0.003, d: 0.4, s: 0.7, r: 0.15 },
        mode: "mono", glide: 0.04, vel: 0.6 },
      fx: { fx1: { type: "off" }, drive: 0.18, comp: 0.5, reverb: { mix: 0.06 } }
    }),

    P("PLUCK SQUARES", {
      organ: { on: false }, piano: { on: false },
      synth: { on: true, o1: { wave: "pls", oct: 0, semi: 0, lvl: 0.8 },
        o2: { wave: "pls", det: 9, lvl: 0.5 }, sub: 0.2,
        filt: { type: "lp24", cut: 3400, res: 3.6, env: 3400, kt: 0.5 },
        ef: { a: 0.001, d: 0.09, s: 0.0, r: 0.08 },
        ea: { a: 0.001, d: 0.16, s: 0.0, r: 0.12 },
        vel: 0.7 },
      fx: { fx1: { type: "off" }, delay: { on: true, div: "3/16", fb: 0.3, mix: 0.18 }, reverb: { mix: 0.18, decay: 1.8 } }
    }),

    P("BRASS STACK", {
      organ: { on: false }, piano: { on: false },
      synth: { on: true, o1: { wave: "saw", oct: 0, semi: 0, lvl: 0.8 },
        o2: { wave: "saw", det: 7, lvl: 0.65 }, sub: 0.3,
        filt: { type: "lp24", cut: 1600, res: 1.8, env: 3200, kt: 0.3 },
        ef: { a: 0.08, d: 0.25, s: 0.5, r: 0.2 },
        ea: { a: 0.04, d: 0.3, s: 0.9, r: 0.25 },
        vel: 0.65 },
      fx: { fx1: { type: "cho", rate: 0.6, depth: 0.25 }, reverb: { mix: 0.2, decay: 2.0 }, comp: 0.35 }
    }),

    P("AIR BELLS", {
      organ: { on: false }, piano: { on: false },
      synth: { on: true, o1: { wave: "sin", oct: 1, semi: 0, lvl: 0.75 },
        o2: { wave: "sin", det: 24, lvl: 0.3 }, sub: 0,
        filt: { type: "lp12", cut: 9000, res: 0.5, env: 0, kt: 0 },
        ef: { a: 0.001, d: 0.5, s: 0.1, r: 0.4 },
        ea: { a: 0.002, d: 1.8, s: 0.0, r: 1.6 },
        lfo: { rate: 5.5, dest: "pit", amt: 0.08 },
        vel: 0.5 },
      fx: { fx1: { type: "cho", rate: 0.4, depth: 0.5 }, delay: { on: true, div: "1/4", fb: 0.45, mix: 0.3 },
        reverb: { mix: 0.5, decay: 7 }, comp: 0.15 }
    }),

    P("ORGAN + PAD LAYER", {
      organ: { on: true, drawbars: [8, 0, 8, 8, 0, 0, 0, 8, 0], vib: "c1", perc: { on: false },
        rotary: { mode: "slow", depth: 0.5 } },
      piano: { on: false },
      synth: { on: true, o1: { wave: "tri", oct: 0, semi: 0, lvl: 0.55 },
        o2: { wave: "saw", det: 14, lvl: 0.35 }, sub: 0.1,
        filt: { type: "lp24", cut: 2200, res: 1.2, env: 800, kt: 0.3 },
        ef: { a: 0.8, d: 1.5, s: 0.7, r: 1.2 },
        ea: { a: 1.1, d: 2, s: 0.9, r: 1.8 },
        vel: 0.25 },
      levels: { organ: 0.8, piano: 0.85, synth: 0.5 },
      fx: { fx1: { type: "cho", rate: 0.55, depth: 0.45 }, reverb: { mix: 0.38, decay: 4.2 } }
    })
  ];

  T.FACTORY_BANK = BANK;

})(window.THOR);
