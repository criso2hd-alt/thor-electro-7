/* ============================================================
   THOR ELECTRO 7 — pattern sequencer
   lookahead-scheduled transport, per-track record with
   loop overdub/replace, quantize, swing, metronome, count-in
   ============================================================ */
"use strict";
(function (T) {

  const TRACK_COLORS = ["#ff5f56", "#ffb340", "#ffe14d", "#7ee787", "#58d5f7", "#9b8cff", "#ff7ad9", "#c9f76f"];

  function freshSong() {
    return {
      bpm: 112, bars: 4, swing: 0,
      metro: false, countin: false, recmode: "rep", grid: 0.25, qnt: true,
      tracks: TRACK_COLORS.map((c, i) => ({
        name: "Track " + (i + 1), engine: "synth", color: c,
        mute: false, solo: false, prog: null, notes: []
      }))
    };
  }

  const S = {
    song: T.store.get("thor_song", null) || freshSong(),
    arm: 0,               // armed (selected) track index
    playing: false, recording: false, counting: false,
    stepIdx: 0, nextStepTime: 0, startTime: 0,
    timer: null, pendingRec: {}, undoStack: [], redoStack: []
  };
  // merge defaults for songs saved by older versions
  S.song = Object.assign(freshSong(), S.song);
  S.song.tracks.forEach((t, i) => {
    S.song.tracks[i] = Object.assign(freshSong().tracks[i], t);
  });
  if (!S.song.tracks || S.song.tracks.length !== 8) S.song = freshSong();

  const LOOKAHEAD = 0.14, TICK_MS = 25;

  S.stepDur = () => 60 / S.song.bpm / 4;
  S.totalSteps = () => Math.round(S.song.bars * 16);

  // ---------- buckets ----------
  S.buckets = [];
  S.rebuildBuckets = function () {
    const total = S.totalSteps();
    S.buckets = S.song.tracks.map(tr => {
      const b = Array.from({ length: total }, () => []);
      tr.notes.forEach(n => {
        const s = Math.floor(n.start * 4);
        if (s >= 0 && s < total) b[s].push(n);
      });
      return b;
    });
  };

  S.audible = tr => {
    const anySolo = S.song.tracks.some(t => t.solo);
    return anySolo ? tr.solo : !tr.mute;
  };

  // ---------- metronome ----------
  let clickBuf = null;
  function ensureClick(ctx) {
    if (clickBuf) return;
    const sr = ctx.sampleRate;
    clickBuf = {};
    [[1660, "hi"], [1100, "lo"]].forEach(([f, k]) => {
      const len = Math.floor(sr * 0.05);
      const buf = ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        d[i] = Math.sin(2 * Math.PI * f * i / sr) * Math.exp(-90 * i / len) * 0.5;
      }
      clickBuf[k] = buf;
    });
  }
  function click(ctx, when, accent) {
    const src = ctx.createBufferSource();
    src.buffer = clickBuf[accent ? "hi" : "lo"];
    const g = ctx.createGain(); g.gain.value = accent ? 0.9 : 0.55;
    src.connect(g); g.connect(ctx.destination);
    src.start(when);
    src.onended = () => { try { g.disconnect(); } catch (e) {} };
  }

  // ---------- scheduling ----------
  function scheduleStep(step, time) {
    const ctx = T.ctx;
    if (S.song.metro && !S.counting) click(ctx, time, step % 16 === 0);
    S.song.tracks.forEach((tr, ti) => {
      if (!S.audible(tr)) return;
      const arr = S.buckets[ti] && S.buckets[ti][step];
      if (!arr) return;
      arr.forEach(n => {
        T.vm.noteOn(tr.engine, n.pitch, n.vel, time, true);
        T.vm.noteOff(tr.engine, n.pitch, time + Math.max(0.03, n.dur * 60 / S.song.bpm), true);
      });
    });
  }

  function tick() {
    const ctx = T.ctx;
    while (S.nextStepTime < ctx.currentTime + LOOKAHEAD) {
      const swingOff = (S.stepIdx % 2 === 1) ? S.song.swing * S.stepDur() * 0.55 : 0;
      scheduleStep(S.stepIdx % S.totalSteps(), S.nextStepTime + swingOff);
      S.nextStepTime += S.stepDur();
      S.stepIdx++;
    }
  }

  S.curStepFloat = function () {
    if (!S.playing || !T.ctx) return 0;
    const elapsed = (T.ctx.currentTime - S.startTime) / S.stepDur();
    return ((elapsed % S.totalSteps()) + S.totalSteps()) % S.totalSteps();
  };

  S.posString = function () {
    const sf = S.counting ? 0 : S.curStepFloat();
    const bar = Math.floor(sf / 16) + 1, beat = Math.floor(sf / 4) % 4 + 1;
    const six = Math.floor(sf) % 4 + 1;
    return String(bar).padStart(3, "0") + "." + beat + "." + six;
  };

  // ---------- transport ----------
  function startPlayback(delaySec, thenRecord) {
    const ctx = T.ctx;
    ensureClick(ctx);
    S.stepIdx = 0;
    S.nextStepTime = ctx.currentTime + (delaySec || 0.06);
    S.startTime = S.nextStepTime;
    S.playing = true;
    S.recording = !!thenRecord;
    if (!S.timer) S.timer = setInterval(tick, TICK_MS);
    S.rebuildBuckets();
    T.emit("transport");
  }

  S.play = function () {
    if (S.playing || !T.ctx) return;
    startPlayback(S.recording && S.song.countin ? S.stepDur() * 16 : 0.06, S.recording);
    if (S.recording && S.song.countin) {
      S.counting = true;
      const ctx = T.ctx;
      for (let i = 0; i < 16; i++) {
        if (i % 4 === 0) click(ctx, S.startTime + i * S.stepDur(), i === 0);
      }
      setTimeout(() => { S.counting = false; T.emit("transport"); },
        (S.startTime - ctx.currentTime + S.stepDur() * 16) * 1000);
    }
  };

  S.stop = function () {
    S.playing = false; S.recording = false; S.counting = false;
    clearInterval(S.timer); S.timer = null;
    Object.keys(S.pendingRec).forEach(k => delete S.pendingRec[k]);
    if (T.vm) T.vm.panic();
    T.emit("transport");
  };

  S.togglePlay = function () { S.playing ? S.stop() : S.play(); };

  S.toggleRecord = function () {
    if (!T.ctx) return;
    if (S.recording) {           // punch out
      S.recording = false;
      T.emit("transport");
      return;
    }
    const tr = S.song.tracks[S.arm];
    if (S.song.recmode === "rep") { pushUndo(); tr.notes.length = 0; S.rebuildBuckets(); T.emit("song"); }
    // auto-assign engine from currently enabled sections
    const P = T.state.program;
    const active = [];
    if (P.synth.on) active.push("synth");
    if (P.piano.on) active.push("piano");
    if (P.organ.on) active.push("organ");
    if (active.length === 1) tr.engine = active[0];
    if (!tr.prog) tr.prog = T.deepClone(P);
    S.recording = true;
    if (!S.playing) S.play(); else T.emit("transport");
  };

  // ---------- live input capture ----------
  S.liveNoteOn = function (midi, vel) {
    if (!S.recording || !S.playing || S.counting) return;
    S.pendingRec[midi] = { start: S.curStepFloat(), vel };
  };
  S.liveNoteOff = function (midi) {
    if (!S.recording) { delete S.pendingRec[midi]; return; }
    const p = S.pendingRec[midi];
    delete S.pendingRec[midi];
    if (p == null) return;
    const tr = S.song.tracks[S.arm];
    const gridBeats = Number(S.song.grid) || 0.25;
    let startBeats = p.start / 4;
    let endBeats = S.curStepFloat() / 4;
    if (endBeats <= startBeats) endBeats = startBeats + gridBeats;
    if (S.song.qnt) {
      startBeats = Math.round(startBeats / gridBeats) * gridBeats;
      endBeats = Math.max(startBeats + gridBeats, Math.round(endBeats / gridBeats) * gridBeats);
    }
    const total = S.song.bars * 4;
    startBeats = ((startBeats % total) + total) % total;
    let durBeats = endBeats - startBeats;
    if (durBeats > total) durBeats = total - startBeats;
    tr.notes.push({ id: ++noteIdSeq, pitch: midi, start: startBeats, dur: durBeats, vel: p.vel });
    S.changed();
  };

  let noteIdSeq = 0;

  // ---------- persistence / io ----------
  let saveTimer = null;
  S.changed = function () {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => T.store.set("thor_song", S.song), 700);
    S.rebuildBuckets();
    T.emit("song");
  };

  S.newSong = function () {
    pushUndo();
    S.song = freshSong();
    S.changed();
  };

  S.exportSong = function () {
    const blob = new Blob([JSON.stringify(S.song, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "thor-pattern.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  S.importSong = function (file) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const obj = JSON.parse(rd.result);
        if (!obj.tracks) throw new Error("bad file");
        pushUndo();
        S.song = Object.assign(freshSong(), obj);
        S.changed();
      } catch (e) { alert("Could not import: " + e.message); }
    };
    rd.readAsText(file);
  };

  // ---------- undo ----------
  function snapshot() { return JSON.stringify(S.song.tracks.map(t => ({ notes: t.notes, engine: t.engine, name: t.name }))); }
  function pushUndo() {
    S.undoStack.push(snapshot());
    if (S.undoStack.length > 80) S.undoStack.shift();
    S.redoStack.length = 0;
  }
  S.pushUndo = pushUndo;
  S.undo = function () {
    if (!S.undoStack.length) return;
    S.redoStack.push(snapshot());
    restore(S.undoStack.pop());
  };
  S.redo = function () {
    if (!S.redoStack.length) return;
    S.undoStack.push(snapshot());
    restore(S.redoStack.pop());
  };
  function restore(json) {
    const data = JSON.parse(json);
    data.forEach((t, i) => {
      S.song.tracks[i].notes = t.notes;
      S.song.tracks[i].engine = t.engine;
      S.song.tracks[i].name = t.name;
    });
    S.changed();
  }

  // ---------- song param updates from UI ----------
  S.updateSongParam = function (path, val) {
    switch (path) {
      case "bpm":
        S.song.bpm = val;
        if (T.fx) T.fx.updateDelayTime();
        break;
      case "swing": S.song.swing = val; break;
      case "bars": S.song.bars = parseInt(val, 10); break;
      case "grid": S.song.grid = parseFloat(val); break;
      case "recmode": S.song.recmode = val; break;
      case "metro": S.song.metro = !!val; break;
      case "countin": S.song.countin = !!val; break;
      case "qnt": S.song.qnt = !!val; break;
    }
    T.store.set("thor_song", S.song);
    T.emit("songui");
    if (path === "bars") { S.rebuildBuckets(); T.emit("song"); }
  };

  T.on("program-loaded", () => {
    // refresh track chips etc.
    T.emit("songui");
  });

  T.Seq = S;
  S.rebuildBuckets();

})(window.THOR);
