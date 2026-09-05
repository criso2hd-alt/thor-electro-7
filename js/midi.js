/* ============================================================
   THOR ELECTRO 7 — Web MIDI input, computer keys,
   on-screen keyboard
   ============================================================ */
"use strict";
(function (T) {

  const KB = { pressed: new Set(), octBase: 48 };   // C3
  T.KB = KB;

  // ---------------- on-screen keyboard ----------------
  let cv, g2, kW = 1000, kH = 96, dpr = 1;
  const LOW = 36, HIGH = 96;

  function whiteIndex(m) {
    const pc = ((m % 12) + 12) % 12;
    const wOfPc = [0, -1, 1, -1, 2, 3, -1, 4, -1, 5, -1, 6];
    return wOfPc[pc];
  }
  function whitesBefore(midi) {
    let c = 0;
    for (let m = LOW; m < midi; m++) if (whiteIndex(m) >= 0) c++;
    return c;
  }
  function isBlack(m) { return [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12); }

  function nWhites() {
    let c = 0;
    for (let m = LOW; m <= HIGH; m++) if (!isBlack(m)) c++;
    return c;
  }
  // black key geometry in px, shared by hit-test and rendering
  function blackGeom(m, ww) {
    const leftWhite = m - 1;                 // every black key's lower neighbour is white
    const wx = whitesBefore(leftWhite) * ww + ww;   // right edge of that white key
    const bw = ww * 0.56;
    return { x: wx - bw / 2 - 1, w: bw };
  }

  function initKbd() {
    cv = document.getElementById("kbd");
    if (!cv) return;
    g2 = cv.getContext("2d");
    resizeKbd();
    window.addEventListener("resize", resizeKbd);

    let mouseDown = false, lastKey = -1;
    function keyAt(x, y) {
      const ww = kW / nWhites();
      // black keys occupy the top 62% — test them first
      if (y < kH * 0.62) {
        for (let m = LOW; m <= HIGH; m++) {
          if (!isBlack(m)) continue;
          const bg = blackGeom(m, ww);
          if (x >= bg.x && x <= bg.x + bg.w) return m;
        }
      }
      const idx = T.clamp(Math.floor(x / ww), 0, nWhites() - 1);
      let count = 0;
      for (let m = LOW; m <= HIGH; m++) {
        if (!isBlack(m)) { if (count === idx) return m; count++; }
      }
      return LOW;
    }

    function down(e) {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      mouseDown = true;
      const m = keyAt(x * (kW / r.width), y * (kH / r.height));
      if (m !== lastKey) {
        if (lastKey >= 0) noteOff(lastKey);
        lastKey = m;
        noteOn(m, 0.85);
      }
      e.preventDefault();
    }
    function up() {
      mouseDown = false;
      if (lastKey >= 0) noteOff(lastKey);
      lastKey = -1;
    }
    cv.addEventListener("pointerdown", e => { cv.setPointerCapture(e.pointerId); down(e); });
    cv.addEventListener("pointermove", e => { if (mouseDown) down(e); });
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);

    T.on("noteled", ev => {
      if (ev.on) KB.pressed.add(ev.midi); else KB.pressed.delete(ev.midi);
      KB.dirtyKbd = true;
    });
    T.on("panic", () => { KB.pressed.clear(); KB.dirtyKbd = true; });
  }

  function resizeKbd() {
    dpr = window.devicePixelRatio || 1;
    kW = cv.clientWidth; kH = cv.clientHeight;
    cv.width = Math.max(1, kW * dpr); cv.height = Math.max(1, kH * dpr);
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    KB._blacks = new Set();
    for (let m = LOW; m <= HIGH; m++) if (isBlack(m)) KB._blacks.add(m);
    KB.dirtyKbd = true;
    drawKbd();                       // repaint synchronously — never leave it blank
  }

  function drawKbd() {
    if (!g2 || !KB.dirtyKbd) return;
    KB.dirtyKbd = false;
    const nWhite = whitesBefore(HIGH + 1);
    const ww = kW / nWhite;
    g2.clearRect(0, 0, kW, kH);
    // whites
    let wi = 0;
    for (let m = LOW; m <= HIGH; m++) {
      if (isBlack(m)) continue;
      const x = wi * ww;
      const on = KB.pressed.has(m);
      g2.fillStyle = on ? "#ffb199" : "#f4f2ec";
      g2.fillRect(x + 0.5, 0.5, ww - 1, kH - 1);
      g2.fillStyle = "rgba(0,0,0,.25)";
      g2.fillRect(x + ww - 1.5, 0.5, 1.5, kH);
      if (m % 12 === 0) {
        g2.fillStyle = "#8a8578"; g2.font = "9px Consolas,monospace"; g2.textAlign = "center";
        g2.fillText("C" + (Math.floor(m / 12) - 1), x + ww / 2, kH - 5);
      }
      wi++;
    }
    // blacks
    for (let m = LOW; m <= HIGH; m++) {
      if (!isBlack(m)) continue;
      const bg = blackGeom(m, ww);
      const on = KB.pressed.has(m);
      g2.fillStyle = on ? "#ff4633" : "#17181c";
      g2.fillRect(bg.x, 0.5, bg.w, kH * 0.62);
      g2.fillStyle = "rgba(255,255,255,.16)";
      g2.fillRect(bg.x, 0.5, bg.w, 2);
    }
  }

  // ---------------- note routing ----------------
  function noteOn(m, vel) {
    if (!T.vm) return;
    T.vm.liveNoteOn(m, vel == null ? 0.9 : vel);
    T.Seq.liveNoteOn(m, vel == null ? 0.9 : vel);
    flashMidi();
  }
  function noteOff(m) {
    if (!T.vm) return;
    T.vm.liveNoteOff(m);
    T.Seq.liveNoteOff(m);
  }

  let midiLedTimer = null;
  function flashMidi() {
    const el = document.getElementById("midiLed");
    if (!el) return;
    el.classList.add("lit");
    clearTimeout(midiLedTimer);
    midiLedTimer = setTimeout(() => el.classList.remove("lit"), 120);
  }

  // ---------------- Web MIDI ----------------
  function handleMIDI(e) {
    try { routeMIDI(e); }
    catch (err) { console.error("MIDI message error", err, e && e.data); }
  }

  function routeMIDI(e) {
    const d = e.data;
    if (!d || d.length < 2) return;
    const status = d[0] & 0xf0;
    const d1 = d[1], d2 = d.length > 2 ? d[2] : 0;
    switch (status) {
      case 0x90:
        if (d2 > 0) noteOn(d1, Math.max(0.05, d2 / 127));
        else noteOff(d1);
        break;
      case 0x80: noteOff(d1); break;
      case 0xB0:
        if (d1 === 64) { if (T.vm) T.vm.sustain(d2 >= 64); }
        else if (d1 === 1) { if (T.vm) T.vm.modWheel(d2 / 127); }
        else if (d1 === 123 || d1 === 121) { if (T.vm) T.vm.panic(); }
        break;
      case 0xE0: {
        const val = ((d2 & 0x7f) << 7) | (d1 & 0x7f);
        const cents = ((val - 8192) / 8192) * (T.state.program.synth.bend * 100);
        if (T.vm) T.vm.bend(cents);
        break;
      }
    }
  }

  function bindInputs(access) {
    access.inputs.forEach(inp => {
      inp.onmidimessage = handleMIDI;
      toast("MIDI: " + (inp.name || "device") + " connected");
    });
    access.onstatechange = () => {
      access.inputs.forEach(inp => {
        if (inp.connection !== "open" || !inp.onmidimessage) inp.onmidimessage = handleMIDI;
      });
    };
    const gx = Array.from(access.inputs.values()).find(i => /gx|nektar/i.test(i.name || ""));
    if (gx) setTimeout(() => toast("Nektar GX61 ready"), 400);
  }

  T.MidiInit = function () {
    if (!navigator.requestMIDIAccess) {
      toast("Web MIDI not available — use Chrome or Edge", 4200);
      return;
    }
    navigator.requestMIDIAccess({ sysex: false }).then(bindInputs)
      .catch(() => toast("MIDI access denied", 3600));
  };

  // ---------------- toasts (display line) ----------------
  function toast(text, ms) {
    if (T.Display) T.Display.showParam("SYSTEM", text);
    void ms;
  }
  T.toast = toast;

  // ---------------- computer keyboard ----------------
  const KEYMAP = {
    "KeyZ": 0, "KeyS": 1, "KeyX": 2, "KeyD": 3, "KeyC": 4, "KeyV": 5,
    "KeyG": 6, "KeyB": 7, "KeyH": 8, "KeyN": 9, "KeyJ": 10, "KeyM": 11,
    "Comma": 12, "Period": 13, "Slash": 14,
    "KeyQ": 12, "Digit2": 13, "KeyW": 14, "Digit3": 15, "KeyE": 16,
    "Digit4": 17, "KeyR": 18, "Digit5": 19, "KeyT": 20, "Digit6": 21,
    "KeyY": 22, "Digit7": 23, "KeyU": 24
  };
  const kbHeld = {};

  function initComputerKeys() {
    window.addEventListener("keydown", e => {
      if (e.repeat || e.metaKey) return;
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const code = e.code;

      if (code === "Minus" || code === "Equal") {
        KB.octBase = T.clamp(KB.octBase + (code === "Equal" ? 12 : -12), 24, 72);
        const ov = document.getElementById("octVal");
        if (ov) ov.textContent = T.noteName(KB.octBase);
        e.preventDefault();
        return;
      }
      if (!(code in KEYMAP)) return;
      if (kbHeld[code]) return;
      kbHeld[code] = true;
      const vel = e.shiftKey ? 0.55 : 0.9;
      noteOn(KB.octBase + KEYMAP[code], vel);
      e.preventDefault();
    });
    window.addEventListener("keyup", e => {
      const code = e.code;
      if (!(code in KEYMAP) || !kbHeld[code]) return;
      kbHeld[code] = false;
      noteOff(KB.octBase + KEYMAP[code]);
    });
  }

  // ---------------- boot ----------------
  T.KeyboardInit = function () {
    initKbd();
    initComputerKeys();
    drawKbd();                          // immediate first paint
    setInterval(drawKbd, 60);
  };

})(window.THOR);
