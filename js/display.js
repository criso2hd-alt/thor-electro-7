/* ============================================================
   THOR ELECTRO 7 — OLED display + shared animation loop
   ============================================================ */
"use strict";
(function (T) {

  let cv, g, W, H, dpr = 1;
  let msg = null;            // transient {label, value}
  let msgUntil = 0;
  let bootTime = 0;

  T.Display = {
    init() {
      cv = document.getElementById("oled");
      if (!cv) return;
      g = cv.getContext("2d");
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      // fixed internal resolution (already hi in HTML)
      W = cv.width; H = cv.height;
      bootTime = performance.now();
    },

    showParam(label, value) {
      msg = { label: String(label).toUpperCase(), value: String(value) };
      msgUntil = performance.now() + 1600;
    },

    /* main render, called from the global rAF loop */
    draw(now, ctxInfo) {
      if (!g) return;
      const P = T.state.program;

      g.clearRect(0, 0, W, H);

      // subtle backlight gradient
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#0e1710");
      bg.addColorStop(1, "#091009");
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);

      if (now - bootTime < 1400) { this.drawBoot(now); return; }

      if (msg && now < msgUntil) { this.drawParam(); return; }
      this.drawIdle(ctxInfo || {});
    },

    drawBoot(now) {
      const t = (now - bootTime) / 1400;
      g.fillStyle = "rgba(255,233,176," + Math.min(1, t * 2) + ")";
      g.font = "800 64px 'Segoe UI', Arial";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.shadowColor = "rgba(255,220,120,.8)";
      g.shadowBlur = t > .3 ? 24 : 0;
      const w = 240 * Math.min(1, t * 1.6);
      g.fillText("THOR", W / 2, H * 0.36);
      g.shadowBlur = 0;
      g.font = "700 22px 'Segoe UI', Arial";
      g.fillStyle = "rgba(160,220,150," + Math.min(1, t * 1.4) + ")";
      g.fillText("ELECTRO 7 · SE", W / 2, H * 0.66);
      // progress line
      g.strokeStyle = "rgba(255,233,176,.6)";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(W / 2 - w / 2, H - 18);
      g.lineTo(W / 2 + w / 2, H - 18);
      g.stroke();
    },

    drawParam() {
      g.textAlign = "left"; g.textBaseline = "alphabetic";
      g.fillStyle = "#9fd48c";
      g.font = "700 26px 'Segoe UI', Arial";
      g.fillText(msg.label, 28, 62);
      g.fillStyle = "#ffe9b0";
      g.shadowColor = "rgba(255,225,150,.65)"; g.shadowBlur = 16;
      g.font = "800 74px 'Segoe UI', Arial";
      g.fillText(msg.value, 26, 152);
      g.shadowBlur = 0;
    },

    drawIdle(info) {
      const P = T.state.program;
      g.textAlign = "left"; g.textBaseline = "alphabetic";

      // top row: program name
      g.fillStyle = "#9fd48c";
      g.font = "700 21px 'Segoe UI', Arial";
      g.fillText("PROG " + String((T.state.programIndex || 0) + 1).padStart(2, "0"), 26, 38);
      g.fillStyle = "#ffe9b0";
      g.font = "800 27px 'Segoe UI', Arial";
      g.fillText(P.name.toUpperCase().slice(0, 18), 130, 39);

      // middle row: active sections
      const secs = [];
      if (P.organ.on) secs.push("ORG");
      if (P.piano.on) secs.push("PNO");
      if (P.synth.on) secs.push("SYN");
      g.fillStyle = "#7db96e";
      g.font = "700 20px Consolas, monospace";
      g.fillText(secs.length ? secs.join("+") : "---", 26, 78);

      // organ extras
      if (P.organ.on) {
        g.fillStyle = "#5d8f52";
        const rot = P.organ.rotary.mode.toUpperCase();
        g.fillText("LES:" + rot + "  VIB:" + P.organ.vib.toUpperCase(), 118, 78);
      }

      // bottom row: transport info
      g.fillStyle = "#9fd48c";
      g.font = "700 22px Consolas, monospace";
      const sq = T.Seq ? T.Seq : null;
      const bpm = sq ? Math.round(sq.song.bpm) : 112;
      const pos = sq ? sq.posString() : "001.1.1";
      g.fillText(bpm + " BPM", 26, 132);
      g.fillText(pos, 168, 132);

      if (sq && sq.playing) {
        g.fillStyle = "#7fe3a4";
        g.font = "800 20px Consolas, monospace";
        g.fillText(sq.recording ? "\u25CF REC" : "\u25B6 PLAY", 330, 132);
      } else if (T.state.sustain) {
        g.fillStyle = "#ffb340";
        g.font = "700 20px Consolas, monospace";
        g.fillText("SUSTAIN", 330, 132);
      }

      // VU meter right side
      const vx = W - 92, vw = 60;
      g.strokeStyle = "#1e3519";
      g.lineWidth = 10;
      g.beginPath(); g.moveTo(vx, 30); g.lineTo(vx, 150); g.stroke();
      const lvl = Math.min(1, info.level || 0);
      const grad = g.createLinearGradient(0, 150, 0, 30);
      grad.addColorStop(0, "#3ee07f"); grad.addColorStop(.75, "#ffb340"); grad.addColorStop(1, "#ff4633");
      g.strokeStyle = grad;
      g.beginPath();
      g.moveTo(vx, 150);
      g.lineTo(vx, 150 - lvl * 120);
      g.stroke();

      // corner ticks
      g.strokeStyle = "rgba(159,212,140,.35)";
      g.lineWidth = 3;
      [[14, 14, 34, 14, 14, 34], [W - 14, 14, W - 34, 14, W - 14, 34],
       [14, H - 14, 34, H - 14, 14, H - 34], [W - 14, H - 14, W - 34, H - 14, W - 14, H - 34]]
        .forEach(c => {
          g.beginPath();
          g.moveTo(c[0], c[2]); g.lineTo(c[0], c[1]); g.lineTo(c[4], c[1]);
          g.moveTo(c[0], c[2]); g.lineTo(c[2], c[1]);
          g.stroke();
        });
    }
  };

})(window.THOR);
