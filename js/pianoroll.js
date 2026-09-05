/* ============================================================
   THOR ELECTRO 7 — piano roll editor
   draw / move / resize / marquee / erase / velocity lane,
   vertical zoom & scroll, ghost tracks, playhead
   ============================================================ */
"use strict";
(function (T) {

  const S = T.Seq;

  const PITCH_MAX = 96, PITCH_MIN = 24;
  const RULER_H = 16, VEL_H = 44;
  const BLACK = [1, 3, 6, 8, 10];

  const Roll = {
    rowH: 13, scrollY: 0, dirty: true,
    sel: new Set(),
    lastDur: null,
    drag: null, hoverCursor: "default"
  };

  let wrap, gridCv, noteCv, overCv, gg, ng, og;
  let W = 800, H = 300, dpr = 1;

  function gridH() { return H - VEL_H - RULER_H; }
  function colW() { return W / (S.song.bars * 4); }

  function init() {
    wrap = document.getElementById("rollWrap");
    gridCv = document.getElementById("rollGrid");
    noteCv = document.getElementById("rollNotes");
    overCv = document.getElementById("rollOverlay");
    gg = gridCv.getContext("2d");
    ng = noteCv.getContext("2d");
    og = overCv.getContext("2d");
    resize();
    window.addEventListener("resize", resize);
    bindPointer();
    T.on("song", () => { Roll.dirty = true; });
    T.on("transport", () => { Roll.dirty = true; });
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = wrap.clientWidth; H = wrap.clientHeight;
    [gridCv, noteCv, overCv].forEach(c => {
      c.width = Math.max(1, W * dpr);
      c.height = Math.max(1, H * dpr);
      c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    clampScroll();
    Roll.dirty = true;
  }

  function clampScroll() {
    const maxY = Math.max(0, (PITCH_MAX - PITCH_MIN + 1) * Roll.rowH - gridH());
    Roll.scrollY = T.clamp(Roll.scrollY, 0, maxY);
  }

  // ---------- coordinate helpers ----------
  function yToPitch(y) {
    return PITCH_MAX - Math.floor((y - RULER_H + Roll.scrollY) / Roll.rowH);
  }
  function pitchToY(p) {
    return RULER_H + (PITCH_MAX - p) * Roll.rowH - Roll.scrollY;
  }
  function beatToX(b) { return b * colW(); }
  function xToBeat(x) { return x / colW(); }
  function snapB(b, noSnap) {
    if (noSnap) return b;
    const g = Number(S.song.grid) || 0.25;
    return Math.round(b / g) * g;
  }
  function inVelLane(y) { return y > RULER_H + gridH(); }
  function inRuler(y) { return y < RULER_H; }

  function noteRect(n) {
    const x = beatToX(n.start), w = Math.max(3, n.dur * colW());
    const y = pitchToY(n.pitch), h = Roll.rowH - 1;
    return { x, y, w, h };
  }
  function noteAt(x, y) {
    const tr = S.song.tracks[S.arm];
    for (let i = tr.notes.length - 1; i >= 0; i--) {
      const r = noteRect(tr.notes[i]);
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return tr.notes[i];
    }
    return null;
  }

  function preview(pitch, vel) {
    if (!T.vm) return;
    T.vm.liveNoteOn(pitch, vel == null ? 0.85 : vel);
    setTimeout(() => T.vm.liveNoteOff(pitch), 190);
  }

  // ---------- drawing ----------
  function draw() {
    drawGrid();
    drawNotes();
    Roll.dirty = false;
  }

  function drawGrid() {
    gg.clearRect(0, 0, W, H);
    // background
    gg.fillStyle = "#101115";
    gg.fillRect(0, 0, W, H);

    const cw = colW(), rh = Roll.rowH;

    // pitch rows
    const firstRow = Math.floor(Roll.scrollY / rh);
    const lastRow = firstRow + Math.ceil(gridH() / rh) + 1;
    for (let row = firstRow; row <= lastRow; row++) {
      const pitch = PITCH_MAX - row;
      if (pitch < PITCH_MIN || pitch > PITCH_MAX) continue;
      const y = RULER_H + row * rh - Roll.scrollY;
      gg.fillStyle = BLACK.includes(((pitch % 12) + 12) % 12) ? "#131419" : "#171920";
      gg.fillRect(0, y, W, rh - 1);
      // octave lines
      if (pitch % 12 === 0) {
        gg.fillStyle = "rgba(255,255,255,.05)";
        gg.fillRect(0, y + rh - 1, W, 1);
      }
      // C labels
      if (pitch % 12 === 0 && W > 400) {
        gg.fillStyle = "#4a4e58"; gg.font = "9px Consolas,monospace";
        gg.textAlign = "left";
        gg.fillText("C" + (pitch / 12 - 1), 4, y + rh - 3);
      }
    }

    // vertical grid
    for (let st = 0; st <= S.song.bars * 16; st++) {
      const x = Math.round(st / 4 * cw);
      if (x > W) break;
      const bar = st % 16 === 0, beat = st % 4 === 0;
      gg.fillStyle = bar ? "#33363f" : beat ? "#26282f" : "#1c1e24";
      gg.fillRect(x, RULER_H, bar ? 2 : 1, gridH());
    }
    // loop end shading beyond bars
    if (beatToX(S.song.bars * 4) < W) {
      gg.fillStyle = "rgba(0,0,0,.45)";
      gg.fillRect(beatToX(S.song.bars * 4), RULER_H, W, gridH());
    }

    // ruler
    gg.fillStyle = "#0b0c10"; gg.fillRect(0, 0, W, RULER_H);
    gg.fillStyle = "#565a64"; gg.font = "700 9px Consolas,monospace"; gg.textAlign = "left";
    for (let bar = 0; bar < S.song.bars; bar++) {
      const x = bar * 4 * cw;
      gg.fillText(String(bar + 1), x + 4, 11);
      gg.fillStyle = "#2b2e35"; gg.fillRect(x, 0, 1, RULER_H);
      gg.fillStyle = "#565a64";
    }

    // velocity lane
    const vy = RULER_H + gridH();
    gg.fillStyle = "#0d0e12"; gg.fillRect(0, vy, W, VEL_H);
    gg.fillStyle = "#26272d"; gg.fillRect(0, vy, W, 1);
    gg.fillStyle = "#3c4048"; gg.font = "700 8px Consolas,monospace";
    gg.fillText("VEL", 5, vy + 11);

    // velocity bars for armed track
    const tr = S.song.tracks[S.arm];
    tr.notes.forEach(n => {
      const x = beatToX(n.start);
      const bh = (VEL_H - 10) * n.vel;
      gg.fillStyle = Roll.sel.has(n) ? "#ffffff" : tr.color;
      gg.globalAlpha = 0.75;
      gg.fillRect(x, vy + VEL_H - bh, Math.min(cw - 1, Math.max(2, n.dur * cw - 1)), bh);
      gg.globalAlpha = 1;
    });
  }

  function drawNotes() {
    ng.clearRect(0, 0, W, H);
    const rh = Roll.rowH;

    // ghost notes from other tracks
    S.song.tracks.forEach((tr, ti) => {
      if (ti === S.arm) return;
      ng.fillStyle = "rgba(255,255,255,.07)";
      tr.notes.forEach(n => {
        const y = pitchToY(n.pitch);
        if (y < RULER_H - rh || y > RULER_H + gridH()) return;
        const x = beatToX(n.start);
        ng.fillRect(x, y, Math.max(3, n.dur * colW()), rh - 1);
      });
    });

    // armed track
    const tr = S.song.tracks[S.arm];
    tr.notes.forEach(n => {
      const r = noteRect(n);
      if (r.y < RULER_H - rh || r.y > RULER_H + gridH()) return;
      const selected = Roll.sel.has(n);
      ng.fillStyle = tr.color;
      ng.globalAlpha = n === (Roll.drag && Roll.drag.note) ? 1 : 0.92;
      roundRect(ng, r.x, r.y, r.w, r.h, 2.5);
      ng.fill();
      ng.globalAlpha = 1;
      // brightness by velocity
      ng.fillStyle = `rgba(255,255,255,${0.15 + n.vel * 0.35})`;
      ng.fillRect(r.x + 1, r.y + 1, Math.max(2, 2.5 * (r.h / 12)), r.h - 2);
      ng.strokeStyle = selected ? "#ffffff" : "rgba(0,0,0,.55)";
      ng.lineWidth = selected ? 1.6 : 1;
      roundRect(ng, r.x, r.y, r.w, r.h, 2.5);
      ng.stroke();
    });
  }

  function roundRect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function drawOverlay() {
    og.clearRect(0, 0, W, H);
    // playhead
    if (S.playing || S.recording) {
      const sf = S.counting ? 0 : S.curStepFloat();
      const x = beatToX(sf / 4);
      og.fillStyle = S.recording ? "#ff4633" : "#7fe3a4";
      og.shadowColor = og.fillStyle; og.shadowBlur = 6;
      og.fillRect(x - 1, 0, 2, H - VEL_H);
      og.shadowBlur = 0;
    }
    // marquee
    if (Roll.drag && Roll.drag.mode === "marquee") {
      const d = Roll.drag;
      const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
      og.strokeStyle = "#7fe3a4"; og.lineWidth = 1;
      og.setLineDash([4, 3]);
      og.strokeRect(x, y, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      og.setLineDash([]);
    }
  }

  // ---------- pointer interaction ----------
  function localXY(e) {
    const r = wrap.getBoundingClientRect();
    // map screen px -> canvas layout px (corrects for any CSS zoom on an ancestor)
    const sx = r.width ? wrap.clientWidth / r.width : 1;
    const sy = r.height ? wrap.clientHeight / r.height : 1;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  }

  function bindPointer() {
    const el = wrap;
    el.addEventListener("contextmenu", e => e.preventDefault());

    el.addEventListener("pointerdown", e => {
      if (e.button !== 0 && e.button !== 2) return;
      el.setPointerCapture(e.pointerId);
      const { x, y } = localXY(e);
      const tr = S.song.tracks[S.arm];
      const noSnap = e.altKey;

      // ---- velocity lane ----
      if (inVelLane(y)) {
        if (e.button !== 0) return;
        S.pushUndo();
        Roll.drag = { mode: "vel", moved: false };
        applyVel(x, y);
        return;
      }
      if (inRuler(y)) return;

      const n = noteAt(x, y);

      // ---- right button: erase (drag supported) ----
      if (e.button === 2) {
        S.pushUndo();
        Roll.drag = { mode: "erase", moved: false };
        if (n) { removeNote(n); }
        return;
      }

      // ---- on a note ----
      if (n) {
        if (e.shiftKey) {                       // toggle selection
          if (Roll.sel.has(n)) Roll.sel.delete(n); else Roll.sel.add(n);
          Roll.dirty = true;
          Roll.drag = { mode: "idle" };
          return;
        }
        if (!Roll.sel.has(n)) { Roll.sel.clear(); Roll.sel.add(n); }
        const r = noteRect(n);
        const nearEdge = x > r.x + r.w - 7;
        S.pushUndo();
        Roll.drag = {
          mode: nearEdge ? "resize" : "move",
          note: n, startX: x, startY: y,
          origStart: n.start, origDur: n.dur, origPitch: n.pitch,
          groupOrig: Array.from(Roll.sel).map(m => ({ m, s: m.start, p: m.pitch })),
          moved: false, lastPitch: n.pitch
        };
        return;
      }

      // ---- empty area ----
      if (e.shiftKey) {                          // marquee select
        Roll.drag = { mode: "marquee", x0: x, y0: y, x1: x, y1: y, additive: e.ctrlKey };
      } else {                                   // draw a note
        const pitch = yToPitch(y);
        const g = Number(S.song.grid) || 0.25;
        const start = Math.max(0, snapB(xToBeat(x), noSnap));
        S.pushUndo();
        const note = { id: ++noteIdCounter, pitch: T.clamp(pitch, PITCH_MIN, PITCH_MAX),
          start, dur: Roll.lastDur || g, vel: 0.8 };
        tr.notes.push(note);
        Roll.sel.clear(); Roll.sel.add(note);
        Roll.drag = { mode: "resize", note, startX: x, startY: y, created: true,
          origStart: start, origDur: note.dur, origPitch: pitch, moved: false, lastPitch: pitch };
        preview(pitch, 0.8);
      }
      Roll.dirty = true;
    });

    el.addEventListener("pointermove", e => {
      const { x, y } = localXY(e);
      const d = Roll.drag;

      if (!d) { updateCursor(x, y); return; }
      d.moved = true;
      const tr = S.song.tracks[S.arm];
      const noSnap = e.altKey;

      switch (d.mode) {
        case "marquee":
          d.x1 = x; d.y1 = y;
          selectByMarquee(d);
          break;

        case "erase": {
          const n = noteAt(x, y);
          if (n) removeNote(n);
          break;
        }

        case "vel": applyVel(x, y); break;

        case "resize": {
          const g = Number(S.song.grid) || 0.25;
          let endB = xToBeat(x);
          const others = Roll.sel.size > 1 ? Array.from(Roll.sel).filter(m => m !== d.note) : [];
          if (!noSnap) endB = Math.round(endB / g) * g;
          let dur = endB - d.origStart;
          const minD = noSnap ? 0.05 : g / 2;
          if (dur < minD) dur = d.created ? g : minD;
          const total = S.song.bars * 4;
          if (d.origStart + dur > total) dur = total - d.origStart;
          const ratio = dur / (d.origDur || 1);
          d.note.dur = dur;
          others.forEach(m => {
            m.dur = Math.max(minD, m.dur * ratio);
            void others;
          });
          Roll.lastDur = dur;
          break;
        }

        case "move": {
          const g = Number(S.song.grid) || 0.25;
          const dB = xToBeat(x) - xToBeat(d.startX);
          const newRowDelta = Math.round((y - d.startY) / Roll.rowH);
          const newStartBase = noSnap ? d.origStart + dB : Math.round((d.origStart + dB) / g) * g;
          const newPitchBase = d.origPitch - newRowDelta;
          const pitchDelta = newPitchBase - d.groupOrig[0].p;
          const startDelta = newStartBase - d.groupOrig[0].s;
          const total = S.song.bars * 4;
          d.groupOrig.forEach(go => {
            let ns = go.s + startDelta;
            ns = T.clamp(ns, 0, total - 0.01);
            go.m.start = ns;
            go.m.pitch = T.clamp(go.p + pitchDelta, PITCH_MIN, PITCH_MAX);
          });
          if (d.note.pitch !== d.lastPitch) {
            preview(d.note.pitch, 0.7);
            d.lastPitch = d.note.pitch;
          }
          break;
        }
      }
      Roll.dirty = true;
    });

    function finishDrag(e) {
      const d = Roll.drag;
      if (!d) return;
      if (d.mode === "marquee") { /* selection already applied */ }
      if ((d.mode === "move" || d.mode === "resize") && !d.moved && !d.created) {
        // simple click without move -> collapse selection to this note
        Roll.sel.clear(); Roll.sel.add(d.note);
      }
      if ((d.mode === "move" || d.mode === "resize" || d.mode === "erase" || d.mode === "vel")) {
        S.changed();
      }
      Roll.drag = null;
      Roll.dirty = true;
    }
    el.addEventListener("pointerup", finishDrag);
    el.addEventListener("pointercancel", () => { Roll.drag = null; });

    el.addEventListener("wheel", e => {
      e.preventDefault();
      if (e.ctrlKey) {                       // zoom rows
        const oldRow = yToPitch(localXY(e).y);
        Roll.rowH = T.clamp(Roll.rowH + (e.deltaY < 0 ? 2 : -2), 7, 30);
        // keep hovered pitch under cursor
        clampScroll();
        const targetY = pitchToY(oldRow);
        Roll.scrollY += targetY - localXY(e).y;
        clampScroll();
      } else {
        Roll.scrollY += (e.deltaY > 0 ? 1 : -1) * 42;
        clampScroll();
      }
      Roll.dirty = true;
    }, { passive: false });

    el.addEventListener("dblclick", e => {
      const { x, y } = localXY(e);
      if (inVelLane(y) || inRuler(y)) return;
      const n = noteAt(x, y);
      if (n) {                                // dbl-click note = delete
        S.pushUndo();
        removeNote(n);
        S.changed();
      } else {
        const tr = S.song.tracks[S.arm];
        const g = Number(S.song.grid) || 0.25;
        const note = { id: ++noteIdCounter, pitch: yToPitch(y),
          start: T.clamp(snapB(xToBeat(x)), 0, S.song.bars * 4 - g), dur: Roll.lastDur || g, vel: 0.8 };
        S.pushUndo();
        tr.notes.push(note);
        Roll.sel.clear(); Roll.sel.add(note);
        preview(note.pitch, 0.85);
        S.changed();
      }
    });
  }

  let noteIdCounter = 1000;

  function updateCursor(x, y) {
    let cur = "default";
    if (!inVelLane(y) && !inRuler(y)) {
      const n = noteAt(x, y);
      if (n) {
        const r = noteRect(n);
        cur = x > r.x + r.w - 7 ? "col-resize" : "grab";
      } else cur = "crosshair";
    } else if (inVelLane(y)) cur = "ns-resize";
    if (cur !== Roll.hoverCursor) {
      Roll.hoverCursor = cur;
      wrap.style.cursor = cur;
    }
  }

  function applyVel(x, y) {
    const vy = RULER_H + gridH();
    const v = T.clamp(1 - (y - vy) / (VEL_H - 10), 0.04, 1);
    const tr = S.song.tracks[S.arm];
    const targets = Roll.sel.size ? Array.from(Roll.sel) :
      tr.notes.filter(n => {
        const nx = beatToX(n.start);
        return x >= nx - 2 && x <= nx + Math.max(4, n.dur * colW());
      });
    targets.forEach(n => { n.vel = v; });
    Roll.dirty = true;
  }

  function selectByMarquee(d) {
    const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1);
    const y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
    if (!d.additive) Roll.sel.clear();
    S.song.tracks[S.arm].notes.forEach(n => {
      const r = noteRect(n);
      if (r.x + r.w >= x0 && r.x <= x1 && r.y + r.h >= y0 && r.y <= y1) Roll.sel.add(n);
    });
  }

  function removeNote(n) {
    const tr = S.song.tracks[S.arm];
    const i = tr.notes.indexOf(n);
    if (i >= 0) tr.notes.splice(i, 1);
    Roll.sel.delete(n);
    Roll.dirty = true;
  }

  // ---------- external commands ----------
  Roll.deleteSelection = function () {
    if (!Roll.sel.size) return;
    S.pushUndo();
    const tr = S.song.tracks[S.arm];
    tr.notes = tr.notes.filter(n => !Roll.sel.has(n));
    Roll.sel.clear();
    S.changed();
  };

  Roll.selectAll = function () {
    Roll.sel.clear();
    S.song.tracks[S.arm].notes.forEach(n => Roll.sel.add(n));
    Roll.dirty = true;
  };

  Roll.quantizeSelection = function () {
    const tr = S.song.tracks[S.arm];
    const targets = Roll.sel.size ? Array.from(Roll.sel) : tr.notes;
    if (!targets.length) return;
    S.pushUndo();
    const g = Number(S.song.grid) || 0.25;
    const total = S.song.bars * 4;
    targets.forEach(n => {
      n.start = T.clamp(Math.round(n.start / g) * g, 0, total - g / 2);
    });
    S.changed();
  };

  Roll.transpose = function (semis) {
    const targets = Roll.sel.size ? Array.from(Roll.sel) : S.song.tracks[S.arm].notes;
    if (!targets.length) return;
    S.pushUndo();
    targets.forEach(n => { n.pitch = T.clamp(n.pitch + semis, PITCH_MIN, PITCH_MAX); });
    S.changed();
  };

  Roll.moveTime = function (beats) {
    const targets = Roll.sel.size ? Array.from(Roll.sel) : null;
    if (!targets) return;
    S.pushUndo();
    const total = S.song.bars * 4;
    targets.forEach(n => { n.start = T.clamp(n.start + beats, 0, total - 0.01); });
    S.changed();
  };

  Roll.duplicateSelection = function () {
    if (!Roll.sel.size) return;
    S.pushUndo();
    const clones = [];
    Roll.sel.forEach(n => {
      const total = S.song.bars * 4;
      const c = { id: ++noteIdCounter, pitch: n.pitch, start: Math.min(total - 0.05, n.start + n.dur), dur: n.dur, vel: n.vel };
      clones.push(c);
    });
    S.song.tracks[S.arm].notes.push(...clones);
    Roll.sel.clear();
    clones.forEach(c => Roll.sel.add(c));
    S.changed();
  };

  // ---------- frame hook ----------
  Roll.frame = function () {
    if (Roll.dirty) draw();
    drawOverlay();
  };

  T.Roll = Roll;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else init();

})(window.THOR);
