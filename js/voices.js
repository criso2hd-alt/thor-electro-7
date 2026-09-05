/* ============================================================
   THOR ELECTRO 7 — voice manager: routes notes to engines,
   handles layering, sustain, bend & panic
   ============================================================ */
"use strict";
(function (T) {

  T.buildVM = function (ctx, engines) {
    const VM = { ctx, engines };

    VM.noteOn = function (engineName, midi, vel, when, force) {
      const P = T.state.program;
      if (!force) {
        if (engineName === "organ" && !P.organ.on) return;
        if (engineName === "piano" && !P.piano.on) return;
        if (engineName === "synth" && !P.synth.on) return;
      }
      const e = engines[engineName];
      // never let one engine's failure abort the others or leave a note hanging
      try { if (e && e.noteOn) e.noteOn(midi, vel, when == null ? ctx.currentTime : when); }
      catch (err) { console.error("noteOn", engineName, err); }
      T.emit("noteled", { midi, on: true });
    };

    VM.noteOff = function (engineName, midi, when) {
      // note-off is ALWAYS honoured on every engine, regardless of section
      // on/off state — otherwise toggling a section (or any error) strands a
      // held note as a stuck/hanging tone.
      const e = engines[engineName];
      try { if (e && e.noteOff) e.noteOff(midi, when == null ? ctx.currentTime : when); }
      catch (err) { console.error("noteOff", engineName, err); }
      T.emit("noteled", { midi, on: false });
    };

    VM.liveNoteOn = function (midi, vel, when) {
      // plays all enabled sections simultaneously (layering)
      ["organ", "piano", "synth"].forEach(name => VM.noteOn(name, midi, vel, when));
    };
    VM.liveNoteOff = function (midi, when) {
      ["organ", "piano", "synth"].forEach(name => VM.noteOff(name, midi, when));
    };

    VM.sustain = function (down) {
      T.state.sustain = down;
      if (!down) {
        engines.piano.sustainUp();
        engines.synth.sustainUp();
      }
      T.emit("sustain", down);
    };

    VM.bend = function (cents) {
      T.state.bendCents = cents;
      engines.synth.setBend(cents);
    };

    VM.modWheel = function (v) {
      T.state.modWheel = v;
      engines.synth.setModWheel(v);
    };

    VM.panic = function () {
      Object.values(engines).forEach(e => e.allOff && e.allOff());
      T.emit("panic");
    };

    return VM;
  };

})(window.THOR);
