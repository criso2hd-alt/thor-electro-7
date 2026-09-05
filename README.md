# THOR ELECTRO 7

A standalone, browser-based performance synthesizer inspired by classic red stage keyboards — three engines (drawbar **Organ**, acoustic/electric **Piano**, analog-modeling **Synth**), a master **effects** section, and a built-in **pattern sequencer** with a piano-roll editor. Plug in a MIDI keyboard and play, or use the on-screen keyboard / your computer keys.

Pure vanilla JavaScript + the Web Audio and Web MIDI APIs. **No build step, no dependencies, no server required** — it's just static files.

## Run locally

Because browsers restrict some features on `file://`, serve the folder over HTTP:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. Click **power on** (this starts audio + MIDI, which browsers require to begin after a user gesture).

## Playing

- **MIDI:** connect a USB MIDI keyboard and allow MIDI access when prompted. Pitch/mod wheels and the sustain pedal (CC64) are supported.
- **Computer keyboard:** `Z S X C … ` (lower row) and `Q 2 W 3 …` (upper row, +1 octave). `-` / `=` shift octave.
- **On-screen keyboard:** click/drag across the keys at the bottom.

## Layout

- Four control columns — **Organ · Piano · Synth · Effects**.
- A **sequencer + keyboard** side pane. Use the **⇄** button (top-right) to flip it to the left or right; **⛶** toggles full screen; **?** opens the shortcut reference.
- Everything scales to fill the screen.

## Sequencer / piano roll

Space = play/pause (Shift+Space = stop) · Enter = record · drag on empty grid = draw note · drag = move · edge = resize · right-click/double-click = delete · Shift-drag = marquee select · Ctrl+Z/Y = undo/redo · L = quantize · Ctrl+D = duplicate · Alt+arrows = transpose / nudge · Esc = panic (all notes off).

## Deploy

Static site — deploys anywhere. For Cloudflare Pages:

```bash
wrangler pages deploy . --project-name thor-electro-7
```
