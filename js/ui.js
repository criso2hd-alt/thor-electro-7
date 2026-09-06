/* ============================================================
   THOR ELECTRO 7 — UI bindings: knobs, drawbars, toggles,
   selectors, program bank, transport, track strips
   ============================================================ */
"use strict";
(function (T) {

  // ---------- central parameter application ----------
  T.applyParam = function (path, value) {
    T.setPath(T.state.program, path, value);
    dispatchEngine(path);
    T.persistProgram();
  };

  function dispatchEngine(path) {
    if (!T.fx) return;
    if (path.indexOf("fx.") === 0 || path === "settings.masterVol") { T.fx.update(path); return; }
    const top = path.split(".")[0];
    if (top === "levels") {
      const eng = path.split(".")[1];
      if (T.engines && T.engines[eng]) T.engines[eng].setLevel(T.getPath(T.state.program, path));
      return;
    }
    if (top === "organ" && path === "organ.on") { /* hum gate handled in organ */ }
    if (T.engines && T.engines[top] && T.engines[top].update) T.engines[top].update(path);
  }

  T.loadProgram = function (prog) {
    T.state.program = T.deepClone(prog);
    T.persistProgram();
    refreshAllAudio();
    T.emit("program-loaded");
    if (T.Display) T.Display.showParam("PROGRAM", T.state.program.name);
  };

  function refreshAllAudio() {
    if (!T.fx) return;
    T.fx.update("*");
    Object.keys(T.engines).forEach(k => {
      const e = T.engines[k];
      if (e.setLevel) e.setLevel(T.state.program.levels[k]);
      if (e.update) e.update("*");
    });
    if (T.engines.synth.setBend) T.engines.synth.setBend(0);
  }

  // ---------- knob factory ----------
  const registered = [];   // {el, kind, path, min, max, log, linear, step, def, fmt, label, dyn}

  function getVal(r) {
    if (r.kind === "song") return T.Seq.song[r.path];
    if (r.kind === "setting") return T.settings[r.path];
    return T.getPath(T.state.program, r.path);
  }
  function setVal(r, v) {
    if (r.kind === "song") { T.Seq.updateSongParam(r.path, v); return; }
    if (r.kind === "setting") {
      T.settings[r.path] = v;
      T.persistSettings();
      dispatchSetting(r.path);
      return;
    }
    T.applyParam(r.path, v);
  }
  function dispatchSetting(path) {
    if (T.fx) T.fx.update("settings." + path);
  }

  function normOf(r, v) {
    v = T.clamp(v, r.min, r.max);
    if (r.log) return T.clamp(Math.log(v / r.min) / Math.log(r.max / r.min), 0, 1);
    return (v - r.min) / (r.max - r.min);
  }
  function valFromNorm(r, t) {
    t = T.clamp(t, 0, 1);
    let v = r.log ? T.mapLog(t, r.min, r.max)
      : r.linear ? r.min + t * (r.max - r.min)
        : r.min + Math.pow(t, 1.6) * (r.max - r.min);
    if (r.step) v = Math.round(v / r.step) * r.step;
    return T.clamp(v, r.min, r.max);
  }
  function renderKnob(r) {
    const t = normOf(r, getVal(r));
    r.ptr.style.setProperty("--rot", (-135 + t * 270) + "deg");
    if (r.dyn) refreshDynLabels();
  }
  function announce(r) {
    const v = getVal(r);
    if (T.Display) T.Display.showParam(r.label, (T.fmt[r.fmt] || String)(v));
  }

  function makeKnob(el) {
    const kind = el.dataset.param ? "prog" : el.dataset.setting ? "setting" : "song";
    const path = el.dataset.param || el.dataset.setting || el.dataset.songknob;
    const r = {
      el, kind, path,
      min: parseFloat(el.dataset.min ?? 0),
      max: parseFloat(el.dataset.max ?? 1),
      log: !!el.dataset.log, linear: !!el.dataset.linear,
      step: el.dataset.step ? parseFloat(el.dataset.step) : null,
      def: parseFloat(el.dataset.default ?? 0.5),
      fmt: el.dataset.fmt || "pct",
      label: el.dataset.label || path,
      dyn: el.dataset.dynlabel || null
    };
    el.innerHTML = '<div class="cap"><div class="ptr"></div></div><div class="lbl"></div>';
    r.ptr = el.querySelector(".ptr");
    r.lblEl = el.querySelector(".lbl");
    r.lblEl.textContent = r.dyn ? "" : r.label;
    renderLbl(r);

    let dragging = false, lastY = 0, startNorm = 0;
    el.addEventListener("pointerdown", e => {
      dragging = true; lastY = e.clientY;
      startNorm = normOf(r, getVal(r));
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    el.addEventListener("pointermove", e => {
      if (!dragging) return;
      const fine = e.shiftKey ? 0.22 : 1;
      const dt = (lastY - e.clientY) / 170 * fine;
      lastY = e.clientY;
      startNorm = T.clamp(startNorm + dt, 0, 1);
      setVal(r, valFromNorm(r, startNorm));
      renderKnob(r);
      announce(r);
    });
    el.addEventListener("pointerup", () => { dragging = false; });
    el.addEventListener("wheel", e => {
      e.preventDefault();
      const t = T.clamp(normOf(r, getVal(r)) + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.008 : 0.04), 0, 1);
      setVal(r, valFromNorm(r, t));
      renderKnob(r);
      announce(r);
    }, { passive: false });
    el.addEventListener("dblclick", () => {
      setVal(r, r.def);
      renderKnob(r);
      announce(r);
    });

    registered.push(r);
    renderKnob(r);
    return r;
  }

  // dynamic piano knob labels
  function refreshDynLabels() {
    if (!T.PianoXLabels) return;
    const type = T.state.program.piano.type;
    registered.forEach(r => {
      if (r.dyn === "pianoX1") r.lblEl.textContent = T.PianoXLabels.x1[type] || "X1";
      if (r.dyn === "pianoX2") r.lblEl.textContent = T.PianoXLabels.x2[type] || "X2";
    });
  }
  T.refreshPianoLabels = refreshDynLabels;

  function renderLbl(r) { if (!r.dyn) r.lblEl.textContent = r.label; }

  // ---------- drawbars ----------
  const DB_LABELS = ["16'", "5⅓'", "8'", "4'", "2⅔'", "2'", "1⅗'", "1⅓'", "1'"];
  function buildDrawbars() {
    const host = document.getElementById("drawbars");
    if (!host) return;
    DB_LABELS.forEach((lab, i) => {
      const d = document.createElement("div");
      d.className = "dbar";
      d.innerHTML =
        '<div class="dbar-label">' + lab + "</div>" +
        '<div class="dbar-slot"><div class="dbar-scale"></div><div class="dbar-fill"></div><div class="dbar-handle"></div></div>';
      host.appendChild(d);
      const fill = d.querySelector(".dbar-fill");
      const handle = d.querySelector(".dbar-handle");
      const slot = d.querySelector(".dbar-slot");

      function render() {
        const v = T.state.program.organ.drawbars[i];
        const t = v / 8;
        fill.style.height = (t * 100) + "%";
        handle.style.bottom = "calc(" + (t * 100) + "% - " + (t * 24) + "px)";
        slot.title = lab + " = " + v;
      }
      let drag = false, startY = 0, startV = 0;
      slot.addEventListener("pointerdown", e => {
        drag = true; startY = e.clientY; startV = T.state.program.organ.drawbars[i];
        slot.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      slot.addEventListener("pointermove", e => {
        if (!drag) return;
        const dv = Math.round((startY - e.clientY) / 11);
        const nv = T.clamp(startV + dv, 0, 8);
        if (nv !== T.state.program.organ.drawbars[i]) {
          T.applyParam("organ.drawbars." + i, nv);
          render();
          if (T.Display) T.Display.showParam("DRAWBAR " + lab, nv);
        }
      });
      slot.addEventListener("pointerup", () => { drag = false; });
      slot.addEventListener("wheel", e => {
        e.preventDefault();
        const nv = T.clamp(T.state.program.organ.drawbars[i] + (e.deltaY < 0 ? 1 : -1), 0, 8);
        if (nv !== T.state.program.organ.drawbars[i]) {
          T.applyParam("organ.drawbars." + i, nv);
          render();
          if (T.Display) T.Display.showParam("DRAWBAR " + lab, nv);
        }
      }, { passive: false });
      slot.addEventListener("dblclick", () => {
        T.applyParam("organ.drawbars." + i, i === 2 ? 8 : 0);
        render();
      });

      drawbarRenderers.push(render);
      render();
    });
  }
  const drawbarRenderers = [];

  // ---------- toggles ----------
  function bindToggle(el) {
    const path = el.dataset.toggle;
    const refresh = () => el.classList.toggle("on", !!T.getPath(T.state.program, path));
    el.addEventListener("click", () => {
      const nv = !T.getPath(T.state.program, path);
      T.applyParam(path, nv);
      refresh();
      if (T.Display) T.Display.showParam(path.split(".").join(" "), nv ? "ON" : "OFF");
      if (path === "piano.on" || path === "organ.on" || path === "synth.on") {
        const nm = path.split(".")[0].toUpperCase();
        if (T.Display) T.Display.showParam("SECTION " + nm, nv ? "ON" : "OFF");
      }
    });
    toggleRefreshers.push(refresh);
    refresh();
  }
  const toggleRefreshers = [];

  // ---------- segmented selects ----------
  function bindSelect(el) {
    const path = el.dataset.select;
    const btns = Array.from(el.querySelectorAll("button"));
    const refresh = () => {
      const cur = String(T.getPath(T.state.program, path));
      btns.forEach(b => b.classList.toggle("sel", b.dataset.val === cur));
    };
    btns.forEach(b => b.addEventListener("click", () => {
      let v = b.dataset.val;
      if (v === "true") v = true;
      else if (v === "false") v = false;
      else if (["oct", "semi"].some(k => path.endsWith(k))) v = parseFloat(v);
      T.applyParam(path, v);
      refresh();
      if (T.Display) T.Display.showParam(path.split(".").slice(1).join(" "), b.textContent);
      if (path === "piano.type" && T.refreshPianoLabels) T.refreshPianoLabels();
      if (path === "fx.delay.div" && T.fx) T.fx.updateDelayTime();
    }));
    selectRefreshers.push(refresh);
    refresh();
  }
  const selectRefreshers = [];

  // ---------- song-bound controls ----------
  const songControls = [];
  function bindSongToggle(el) {
    const key = el.dataset.songtoggle;
    const refresh = () => el.classList.toggle("on", !!T.Seq.song[key]);
    el.addEventListener("click", () => {
      T.Seq.updateSongParam(key, !T.Seq.song[key]);
      if (T.Display) T.Display.showParam(key.toUpperCase(), T.Seq.song[key] ? "ON" : "OFF");
    });
    songControls.push({ el, refresh, kind: "toggle", key });
    refresh();
  }
  function bindSongSelect(el) {
    const key = el.dataset.songselect;
    const btns = Array.from(el.querySelectorAll("button"));
    const refresh = () => {
      const cur = String(T.Seq.song[key]);
      btns.forEach(b => b.classList.toggle("sel", b.dataset.val === cur));
    };
    btns.forEach(b => b.addEventListener("click", () => T.Seq.updateSongParam(key, b.dataset.val)));
    songControls.push({ el, refresh, kind: "select", key });
    refresh();
  }

  // ---------- track strips ----------
  function buildTracks() {
    const col = document.getElementById("trackCol");
    if (!col) return;
    col.innerHTML = "";
    T.Seq.song.tracks.forEach((tr, i) => {
      const row = document.createElement("div");
      row.className = "track-strip";
      row.innerHTML =
        '<span class="dot"></span>' +
        '<span class="tname">' + tr.name + "</span>" +
        '<button class="mini-btn eng" title="sound engine">SYN</button>' +
        '<button class="mini-btn mute" title="mute">M</button>' +
        '<button class="mini-btn solo" title="solo">S</button>' +
        '<button class="mini-btn cap" title="capture current program">&#8595;</button>' +
        '<button class="mini-btn clr" title="clear notes">&#10005;</button>';
      col.appendChild(row);

      row.querySelector(".eng").addEventListener("click", e => {
        e.stopPropagation();
        const order = ["synth", "piano", "organ"];
        tr.engine = order[(order.indexOf(tr.engine) + 1) % order.length];
        T.Seq.changed();
      });
      row.querySelector(".mute").addEventListener("click", e => { e.stopPropagation(); tr.mute = !tr.mute; T.Seq.changed(); });
      row.querySelector(".solo").addEventListener("click", e => { e.stopPropagation(); tr.solo = !tr.solo; T.Seq.changed(); });
      row.querySelector(".cap").addEventListener("click", e => {
        e.stopPropagation();
        tr.prog = T.deepClone(T.state.program);
        toastTrack(i, "prog captured");
      });
      row.querySelector(".clr").addEventListener("click", e => {
        e.stopPropagation();
        T.Seq.pushUndo();
        tr.notes.length = 0;
        T.Seq.changed();
      });
      row.querySelector(".tname").addEventListener("dblclick", e => {
        e.stopPropagation();
        const nn = prompt("Track name:", tr.name);
        if (nn != null) { tr.name = nn.slice(0, 14); T.Seq.changed(); }
      });
      row.addEventListener("click", () => {
        T.Seq.arm = i;
        refreshTrackStrips();
        if (T.Roll) { T.Roll.sel.clear(); T.Roll.dirty = true; }
      });
    });
    // add-track button (up to the track cap)
    if (T.Seq.song.tracks.length < (T.Seq.MAX_TRACKS || 16)) {
      const add = document.createElement("button");
      add.className = "add-track";
      add.textContent = "+ ADD TRACK";
      add.title = "Add another sequencer track";
      add.addEventListener("click", () => T.Seq.addTrack());
      col.appendChild(add);
    }

    refreshTrackStrips();

    // load-program double duty: shift-click strip loads its stored program (bind once)
    if (!col._shiftBound) {
      col._shiftBound = true;
      col.addEventListener("click", e => {
        if (!e.shiftKey) return;
        const strip = e.target.closest(".track-strip");
        if (!strip) return;
        const idx = Array.from(col.querySelectorAll(".track-strip")).indexOf(strip);
        const prog = T.Seq.song.tracks[idx] && T.Seq.song.tracks[idx].prog;
        if (prog) { T.loadProgram(prog); toastTrack(idx, "program loaded"); }
        else toastTrack(idx, "no captured program");
      });
    }
  }
  T.rebuildTracks = buildTracks;

  function refreshTrackStrips() {
    const col = document.getElementById("trackCol");
    if (!col) return;
    Array.from(col.querySelectorAll(".track-strip")).forEach((row, i) => {
      const tr = T.Seq.song.tracks[i];
      if (!tr) return;
      row.classList.toggle("armed", i === T.Seq.arm);
      row.querySelector(".dot").style.background = tr.color;
      row.querySelector(".tname").textContent = tr.name;
      const engBtn = row.querySelector(".eng");
      engBtn.textContent = tr.engine === "organ" ? "ORG" : tr.engine === "piano" ? "PNO" : "SYN";
      row.querySelector(".mute").classList.toggle("on", tr.mute);
      row.querySelector(".solo").classList.toggle("on", tr.solo);
      row.querySelector(".cap").style.opacity = tr.prog ? 1 : 0.4;
      row.title = tr.prog ? ("shift-click: load '" + tr.prog.name + "'") : "shift-click arm";
    });
  }
  T.refreshTracks = refreshTrackStrips;

  function toastTrack(i, msg) {
    if (T.Display) T.Display.showParam("TRK " + (i + 1), msg.toUpperCase());
  }

  // ---------- transport & song menu ----------
  function bindTransport() {
    const bp = document.getElementById("btnPlay");
    const bs = document.getElementById("btnStop");
    const br = document.getElementById("btnRec");
    bp.addEventListener("click", () => T.Seq.togglePlay());
    bs.addEventListener("click", () => T.Seq.stop());
    br.addEventListener("click", () => T.Seq.toggleRecord());

    T.on("transport", () => {
      bp.classList.toggle("lit", T.Seq.playing);
      br.classList.toggle("lit", T.Seq.recording);
      const recLed = document.getElementById("recLed");
      if (recLed) recLed.classList.toggle("lit", T.Seq.recording);
    });

    document.getElementById("songNew").addEventListener("click", () => {
      if (confirm("Clear all tracks and start a new pattern?")) T.Seq.newSong();
    });
    document.getElementById("songExport").addEventListener("click", () => T.Seq.exportSong());
    document.getElementById("songImport").addEventListener("click", () => document.getElementById("songFile").click());
    document.getElementById("songFile").addEventListener("change", e => {
      if (e.target.files[0]) T.Seq.importSong(e.target.files[0]);
      e.target.value = "";
    });

    document.getElementById("rollUndo").addEventListener("click", () => T.Seq.undo());
    document.getElementById("rollRedo").addEventListener("click", () => T.Seq.redo());
    document.getElementById("rollQuant").addEventListener("click", () => T.Roll.quantizeSelection());
    document.getElementById("rollDelSel").addEventListener("click", () => T.Roll.deleteSelection());

    T.on("songui", () => {
      songControls.forEach(c => c.refresh());
      refreshTrackStrips();
      const ov = document.getElementById("octVal");
      void ov;
    });
    T.on("song", () => refreshTrackStrips());
  }

  // ---------- program bank ----------
  function bindProgNav() {
    document.getElementById("progUp").addEventListener("click", () => stepProg(1));
    document.getElementById("progDown").addEventListener("click", () => stepProg(-1));
  }
  function stepProg(dir) {
    const n = T.FACTORY_BANK.length;
    let i = ((T.state.programIndex || 0) + dir) % n;
    if (i < 0) i += n;
    T.state.programIndex = i;
    T.loadProgram(T.FACTORY_BANK[i]);
  }

  // ---------- sustain LED / help ----------
  function bindMisc() {
    T.on("sustain", down => {
      const el = document.getElementById("sustainLed");
      if (el) el.classList.toggle("on", down);
    });
    const help = document.getElementById("helpModal");
    document.getElementById("helpClose").addEventListener("click", () => help.hidden = true);
    help.addEventListener("click", e => { if (e.target === help) help.hidden = true; });
    window.addEventListener("keydown", e => {
      if (e.key === "?" ) { help.hidden = !help.hidden; }
      if (e.key === "Escape") { help.hidden = true; if (T.vm) T.vm.panic(); }
      if ((e.key === "z" || e.key === "Z") && e.ctrlKey) { e.preventDefault(); e.shiftKey ? T.Seq.redo() : T.Seq.undo(); }
      if ((e.key === "y" || e.key === "Y") && e.ctrlKey) { e.preventDefault(); T.Seq.redo(); }
      if ((e.key === "a" || e.key === "A") && e.ctrlKey) { e.preventDefault(); T.Roll.selectAll(); }
      if ((e.key === "d" || e.key === "D") && e.ctrlKey) { e.preventDefault(); T.Roll.duplicateSelection(); }
      if (e.code === "KeyL" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target && e.target.tagName) || "";
        if (tag !== "INPUT") T.Roll.quantizeSelection();
      }
      if (e.code === "Enter" && T.state.powered) {
        e.preventDefault();
        const tag = (e.target && e.target.tagName) || "";
        if (tag !== "INPUT") T.Seq.toggleRecord();
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const tag = (e.target && e.target.tagName) || "";
        if (tag !== "INPUT") { T.Roll.deleteSelection(); }
      }
      if (e.key === "ArrowUp" && e.altKey) { e.preventDefault(); T.Roll.transpose(1); }
      if (e.key === "ArrowDown" && e.altKey) { e.preventDefault(); T.Roll.transpose(-1); }
      if (e.key === "ArrowRight" && e.altKey) { e.preventDefault(); T.Roll.moveTime(Number(T.Seq.song.grid)); }
      if (e.key === "ArrowLeft" && e.altKey) { e.preventDefault(); T.Roll.moveTime(-Number(T.Seq.song.grid)); }
      if (e.code === "Space" && T.state.powered) {
        e.preventDefault();
        if (e.shiftKey) T.Seq.stop(); else T.Seq.togglePlay();
      }
    });
  }

  // ---------- global refresh ----------
  function refreshAllUI() {
    registered.forEach(r => { renderKnob(r); renderLbl(r); });
    toggleRefreshers.forEach(f => f());
    selectRefreshers.forEach(f => f());
    drawbarRenderers.forEach(f => f());
    refreshDynLabels();
    const pn = document.getElementById("progName");
    if (pn) pn.textContent = T.state.program.name;
  }
  T.on("program-loaded", refreshAllUI);

  // ---------- boot ----------
  T.UIInit = function () {
    document.querySelectorAll(".knob[data-param],.knob[data-songknob],.knob[data-setting]").forEach(makeKnob);
    buildDrawbars();
    document.querySelectorAll("[data-toggle]").forEach(bindToggle);
    document.querySelectorAll("[data-select]").forEach(bindSelect);
    document.querySelectorAll("[data-songtoggle]").forEach(bindSongToggle);
    document.querySelectorAll("[data-songselect]").forEach(bindSongSelect);
    buildTracks();
    bindTransport();
    bindProgNav();
    bindMisc();
    refreshAllUI();
    if (T.updateOctDisplay) T.updateOctDisplay();
  };

})(window.THOR);
