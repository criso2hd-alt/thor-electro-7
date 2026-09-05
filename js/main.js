/* ============================================================
   THOR ELECTRO 7 — boot & main loop
   ============================================================ */
"use strict";
(function (T) {

  let lastLevel = 0;

  T.powerOn = function () {
    if (T.state.powered) return Promise.resolve();
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ latencyHint: "interactive" });
    T.ctx = ctx;

    // master FX
    const fx = T.buildEffects(ctx);
    T.fx = fx;

    // engines -> straight into the mix bus (section gating is done
    // at note level so sequencer tracks always sound)
    const engines = {
      organ: T.buildOrgan(ctx, fx.input),
      piano: T.buildPiano(ctx, fx.input),
      synth: T.buildSynth(ctx, fx.input)
    };
    T.engines = engines;

    T.vm = T.buildVM(ctx, engines);

    // apply full current program
    fx.update("*");
    Object.keys(engines).forEach(k => {
      if (engines[k].setLevel) engines[k].setLevel(T.state.program.levels[k]);
      if (engines[k].update) engines[k].update("*");
    });

    T.state.powered = true;

    T.MidiInit();

    // gentle power-on relay thump
    try {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = 52;
      g.gain.setValueAtTime(0.12, ctx.currentTime);
      g.gain.setTargetAtTime(0, ctx.currentTime + 0.02, 0.09);
      o.connect(g); g.connect(fx.master);
      o.start(); o.stop(ctx.currentTime + 0.5);
    } catch (e) {}

    T.emit("power");
    return ctx.resume();
  };

  // ---------- main animation loop ----------
  function frame(now) {
    if (T.state.powered && T.fx) {
      const lvl = Math.min(1, T.fx.level());
      lastLevel = Math.max(lvl, lastLevel * 0.93);
      if (T.Display) T.Display.draw(now, { level: lastLevel });
    }
    if (T.Roll) T.Roll.frame();
    requestAnimationFrame(frame);
  }

  // ---------- global shortcuts that must exist pre-audio ----------
  window.addEventListener("keydown", e => {
    if (!T.state.powered) {
      if (e.code === "Enter" || e.code === "Space") { e.preventDefault(); T.powerOn().then(hideSplash); }
    }
  });

  function hideSplash() {
    const sp = document.getElementById("splash");
    if (sp) { sp.classList.add("off"); sp.style.display = "none"; }
  }

  // ---------- layout controls (swap sides / fullscreen / help) ----------
  // Recompute the size-dependent canvases (on-screen keyboard + piano roll)
  // after any layout change; both listen for the window resize event.
  function relayout() { window.dispatchEvent(new Event("resize")); }
  T.relayout = relayout;

  function applySwap() {
    const ws = document.getElementById("workspace");
    if (ws) ws.classList.toggle("swap", !!T.settings.swapSides);
    relayout();
  }

  function initLayoutControls() {
    applySwap();

    const swap = document.getElementById("swapSides");
    if (swap) swap.addEventListener("click", () => {
      T.settings.swapSides = !T.settings.swapSides;
      T.persistSettings();
      applySwap();
    });

    const full = document.getElementById("fullBtn");
    if (full) full.addEventListener("click", () => {
      const d = document;
      if (!d.fullscreenElement) {
        (d.documentElement.requestFullscreen || function () {}).call(d.documentElement);
      } else if (d.exitFullscreen) {
        d.exitFullscreen();
      }
    });
    document.addEventListener("fullscreenchange", () => setTimeout(relayout, 60));

    const help = document.getElementById("helpBtn");
    const modal = document.getElementById("helpModal");
    if (help && modal) help.addEventListener("click", () => { modal.hidden = !modal.hidden; });

    // dismissable "buy me a coffee" button — stays hidden once dismissed
    const coffee = document.getElementById("coffeeWidget");
    const coffeeX = document.getElementById("coffeeDismiss");
    if (coffee && T.settings.hideCoffee) coffee.classList.add("hidden");
    if (coffee && coffeeX) coffeeX.addEventListener("click", e => {
      e.preventDefault();
      coffee.classList.add("hidden");
      T.settings.hideCoffee = true;
      T.persistSettings();
    });
  }

  // ---------- boot ----------
  document.addEventListener("DOMContentLoaded", () => {
    if (T.Display) T.Display.init();
    if (T.UIInit) T.UIInit();
    if (T.KeyboardInit) T.KeyboardInit();
    initLayoutControls();
    relayout();                       // ensure canvases match final layout
    requestAnimationFrame(frame);

    const btn = document.getElementById("powerBtn");
    if (btn) {
      btn.addEventListener("click", () => {
        T.powerOn().then(() => setTimeout(hideSplash, 350));
        btn.disabled = true;
      });
    }

    // demo / headless hook: ?autotest boots without the power-on click
    // (used for automated screenshots); ?swap starts on the mirrored layout.
    if (location.search.indexOf("autotest") >= 0) {
      try { T.powerOn(); } catch (e) { /* audio may be unavailable in headless */ }
      if (location.search.indexOf("swap") >= 0) {
        T.settings.swapSides = true;
        applySwap();
      }
      setTimeout(hideSplash, 250);
    }
  });

})(window.THOR);
