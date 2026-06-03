/* ============================================================
 * visualizers.js — composite VST widgets:
 *   ADSRPanel, WaveformPicker, FilterResponse, LFOMini, RhythmGrid
 * Each composite owns child knobs/segs and adds a live SVG preview.
 * ========================================================== */

(function (global) {
  'use strict';
  const W = global.VstWidgets;
  const NS = 'http://www.w3.org/2000/svg';

  // Mini SVG icons for the 12 oscillator waveforms (36x16 viewbox)
  const WAVEFORM_PATHS = [
    // 0 sine
    'M2 8 Q 6 0, 10 8 T 18 8 T 26 8 T 34 8',
    // 1 sawtooth (rising)
    'M2 14 L10 2 L10 14 L18 2 L18 14 L26 2 L26 14 L34 2',
    // 2 square
    'M2 13 L2 3 L10 3 L10 13 L18 13 L18 3 L26 3 L26 13 L34 13 L34 3',
    // 3 triangle
    'M2 13 L8 3 L14 13 L20 3 L26 13 L32 3 L34 8',
    // 4 bandlimited pulse
    'M2 13 L2 4 L8 4 L8 13 L14 13 L14 4 L20 4 L20 13 L26 13 L26 4 L32 4 L32 13',
    // 5 pulse (narrow)
    'M2 13 L2 4 L5 4 L5 13 L14 13 L14 4 L17 4 L17 13 L26 13 L26 4 L29 4 L29 13',
    // 6 reverse sawtooth
    'M2 2 L10 14 L10 2 L18 14 L18 2 L26 14 L26 2 L34 14',
    // 7 sample and hold
    'M2 6 L7 6 L7 11 L12 11 L12 3 L17 3 L17 9 L22 9 L22 5 L27 5 L27 12 L32 12 L32 7',
    // 8 variable triangle
    'M2 13 L11 3 L13 13 L22 3 L24 13 L33 3',
    // 9 bandlimited sawtooth
    'M2 13 Q 5 13, 9 3 L11 3 Q 14 13, 18 3 L20 3 Q 23 13, 27 3 L29 3 Q 32 13, 34 13',
    // 10 reverse bandlimited sawtooth
    'M2 3 Q 5 3, 9 13 L11 13 Q 14 3, 18 13 L20 13 Q 23 3, 27 13 L29 13 Q 32 3, 34 3',
    // 11 bandlimited square
    'M2 13 Q 2 4, 6 4 L10 4 Q 14 4, 14 13 L14 13 Q 14 4, 18 4 L22 4 Q 26 4, 26 13'
  ];
  const WAVEFORM_LABELS = ['sin', 'saw', 'sq', 'tri', 'blp', 'pul', 'rsa', 's&h', 'vtr', 'bsa', 'rba', 'bsq'];

  function makeSvg(viewBox, cls) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', viewBox);
    if (cls) s.setAttribute('class', cls);
    return s;
  }

  // --- WaveformPicker --------------------------------------
  function WaveformPicker(meta, opts = {}) {
    const root = document.createElement('div');
    root.className = 'vst-waveform-picker-wrap';
    if (opts.color) root.style.setProperty('--knob-color', opts.color);
    if (opts.label !== false) {
      const lbl = document.createElement('div');
      lbl.className = 'name';
      lbl.style.fontSize = '0.72em';
      lbl.style.color = 'var(--text-dim)';
      lbl.style.textTransform = 'lowercase';
      lbl.style.marginBottom = '4px';
      lbl.textContent = opts.label || meta.name;
      root.appendChild(lbl);
    }
    const grid = document.createElement('div');
    grid.className = 'vst-waveform-picker';
    root.appendChild(grid);
    const N = Math.min(12, meta.max - meta.min + 1);
    const buttons = [];
    for (let i = 0; i < N; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'opt';
      btn.title = WAVEFORM_LABELS[i];
      const svg = makeSvg('0 0 36 16');
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', WAVEFORM_PATHS[i]);
      svg.appendChild(path);
      btn.appendChild(svg);
      const lbl = document.createElement('div');
      lbl.className = 'lbl';
      lbl.textContent = WAVEFORM_LABELS[i];
      btn.appendChild(lbl);
      btn.addEventListener('click', () => { val = i; commit(true); });
      grid.appendChild(btn);
      buttons.push(btn);
    }
    let val = Number(meta.defaultRaw);
    function render() {
      buttons.forEach((b, i) => b.classList.toggle('active', i === val));
    }
    function commit(send) {
      val = Math.max(meta.min, Math.min(meta.max, Math.round(val)));
      render();
      if (send) global.setParameter(meta.address, val);
      api.onChange && api.onChange();
    }
    const api = {
      element: root, meta,
      setFromSysex(raw, send = false) { val = Math.round(Number(raw)); commit(send); },
      getRawValue() { return val; },
      onChange: null
    };
    // shared right-click/double-click on each button
    buttons.forEach(b => {
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        // open numeric popover anchored on grid
        const ev = new MouseEvent('contextmenu', { bubbles: false });
        ev.preventDefault = () => {};
      });
    });
    grid.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
    root.addEventListener('dblclick', () => api.setFromSysex(meta.defaultRaw, true));
    W.register(meta.address, api);
    render();
    return api;
  }

  // --- ADSR Curve Visualization -----------------------------
  // params: { attack, hold, decay, sustain, release } each = sysex address (number)
  // The actual knobs are still rendered (compact); a curve viz sits above.
  function ADSRPanel(label, params, paramMeta, opts = {}) {
    const root = document.createElement('div');
    if (opts.color) root.style.setProperty('--knob-color', opts.color);

    const viz = document.createElement('div');
    viz.className = 'vst-viz vst-adsr';
    const svg = makeSvg('0 0 200 100');
    viz.appendChild(svg);
    root.appendChild(viz);

    // grid
    for (let i = 1; i < 5; i++) {
      const ln = document.createElementNS(NS, 'line');
      ln.setAttribute('class', 'grid');
      ln.setAttribute('x1', (i * 40)); ln.setAttribute('x2', (i * 40));
      ln.setAttribute('y1', 0); ln.setAttribute('y2', 100);
      svg.appendChild(ln);
    }
    const baseLn = document.createElementNS(NS, 'line');
    baseLn.setAttribute('class', 'grid');
    baseLn.setAttribute('x1', 0); baseLn.setAttribute('x2', 200);
    baseLn.setAttribute('y1', 90); baseLn.setAttribute('y2', 90);
    svg.appendChild(baseLn);

    const curve = document.createElementNS(NS, 'path');
    curve.setAttribute('class', 'curve');
    svg.appendChild(curve);

    // Knob row
    const row = document.createElement('div');
    row.className = 'vst-knob-row';
    root.appendChild(row);

    const knobs = {};
    for (const k of ['attack', 'hold', 'decay', 'sustain', 'release']) {
      if (!params[k]) continue;
      const m = paramMeta[params[k]];
      if (!m) continue;
      const knob = W.Knob(m, { compact: true, label: k, color: opts.color });
      knob.onChange = redraw;
      knobs[k] = knob;
      row.appendChild(knob.element);
    }

    // optional retrigger release
    if (params.retrigger) {
      const m = paramMeta[params.retrigger];
      if (m) {
        const knob = W.Knob(m, { compact: true, label: 'retrig', color: opts.color });
        row.appendChild(knob.element);
      }
    }

    function getRawAt(addr) {
      const w = W.get(addr);
      return w ? w.getRawValue() : 0;
    }

    function redraw() {
      // Times in ms (already raw sysex). Sustain in 0..1 (float -> /100).
      const aRaw = params.attack ? getRawAt(params.attack) : 0;
      const hRaw = params.hold ? getRawAt(params.hold) : 0;
      const dRaw = params.decay ? getRawAt(params.decay) : 0;
      const sRaw = params.sustain ? getRawAt(params.sustain) : 100;
      const rRaw = params.release ? getRawAt(params.release) : 0;
      const a = aRaw, h = hRaw, d = dRaw, r = rRaw;
      const sust = sRaw / 100; // float (0..1)
      // total ms baseline; use log scale so short values are visible
      const total = Math.max(50, a + h + d + r + 200);
      const W_ = 200, H = 100, top = 8, btm = 90;
      const x = (ms) => (ms / total) * W_;
      const y0 = btm; // 0
      const y1 = top; // 1
      const ySust = btm - (btm - top) * sust;
      // points: (0,0) -> (a, peak) -> (a+h, peak) -> (a+h+d, sust) -> (a+h+d+sustainRegion, sust) -> end (a+h+d+sustainRegion + r, 0)
      const sustainRegion = Math.max(20, total * 0.15);
      const px = [
        [0, y0],
        [x(a), y1],
        [x(a + h), y1],
        [x(a + h + d), ySust],
        [x(a + h + d + sustainRegion), ySust],
        [x(a + h + d + sustainRegion + r), y0],
        [W_, y0]
      ];
      const dStr = px.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') + ' L ' + W_ + ' ' + y0 + ' Z';
      curve.setAttribute('d', dStr);
    }
    redraw();
    return { element: root, redraw, knobs };
  }

  // --- Filter response visualization ------------------------
  // Draws an SVG curve based on cutoff/Q/lp/bp/hp gains.
  function FilterResponse(addrs, paramMeta, opts = {}) {
    const root = document.createElement('div');
    if (opts.color) root.style.setProperty('--knob-color', opts.color);

    const viz = document.createElement('div');
    viz.className = 'vst-viz vst-filter-resp';
    const svg = makeSvg('0 0 200 80');
    const area = document.createElementNS(NS, 'path');
    area.setAttribute('class', 'area');
    svg.appendChild(area);
    const curve = document.createElementNS(NS, 'path');
    curve.setAttribute('class', 'curve');
    svg.appendChild(curve);
    viz.appendChild(svg);
    root.appendChild(viz);

    const row = document.createElement('div');
    row.className = 'vst-knob-row';
    root.appendChild(row);

    const knobMap = {};
    for (const key of ['frequency', 'base_frequency', 'cutoff', 'resonance', 'lowpass', 'bandpass', 'highpass', 'keytrack', 'sensitivity', 'lfo_freq', 'lfo_amp', 'lfo_waveform']) {
      if (!addrs[key]) continue;
      const m = paramMeta[addrs[key]];
      if (!m) continue;
      let widget;
      if (key === 'lfo_waveform') {
        widget = WaveformPicker(m, { color: opts.color, label: 'LFO wave' });
      } else {
        widget = W.Knob(m, { compact: true, label: m.name, color: opts.color });
      }
      widget.onChange = redraw;
      knobMap[key] = widget;
      row.appendChild(widget.element);
    }

    function rawAt(addr) {
      if (!addr) return 0;
      const w = W.get(addr);
      return w ? w.getRawValue() : 0;
    }
    function getRaw(k) {
      return rawAt(addrs[k]);
    }
    function getUi(k) {
      const a = addrs[k]; if (!a) return 0;
      const m = paramMeta[a]; if (!m) return 0;
      return W.sysexToUi(rawAt(a), m);
    }

    function redraw() {
      const cutoffAddr = addrs.frequency || addrs.base_frequency || addrs.cutoff;
      const cutoff = rawAt(cutoffAddr) || 1000;
      const cutoffMax = (paramMeta[cutoffAddr] || { max: 5000 }).max;
      const q = getUi('resonance') || 0.7;
      const lp = getUi('lowpass') || 0;
      const bp = getUi('bandpass') || 0;
      const hp = getUi('highpass') || 0;
      const W_ = 200, H = 80;
      const N = 80;
      const pts = [];
      const fc = Math.log(cutoff + 1) / Math.log(cutoffMax + 1);
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        // frequency log axis
        const f = t;
        const distance = (f - fc);
        // approximate magnitude: lp falls above fc, hp falls below fc, bp peaks at fc
        const lpMag = lp / (1 + Math.pow(10, Math.max(0, distance) * 4));
        const hpMag = hp / (1 + Math.pow(10, Math.max(0, -distance) * 4));
        const bpMag = bp * Math.exp(-Math.pow(distance * 5, 2)) * (1 + q * 0.5);
        const peak = Math.exp(-Math.pow(distance * 8, 2)) * (q - 0.7) * 0.4;
        let mag = Math.min(1.5, lpMag + hpMag + bpMag + peak);
        if (!Number.isFinite(mag)) mag = 0;
        mag = Math.max(0, mag);
        const y = H - mag * (H - 8) - 4;
        pts.push([t * W_, Math.max(2, Number.isFinite(y) ? y : H - 4)]);
      }
      const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      curve.setAttribute('d', d);
      area.setAttribute('d', d + ` L ${W_} ${H} L 0 ${H} Z`);
    }
    redraw();
    return { element: root, redraw };
  }

  // --- LFO Mini --------------------------------------------
  function LFOMini(addrs, paramMeta, opts = {}) {
    const root = document.createElement('div');
    if (opts.color) root.style.setProperty('--knob-color', opts.color);

    if (addrs.waveform) {
      const m = paramMeta[addrs.waveform];
      if (m) {
        const picker = WaveformPicker(m, { color: opts.color, label: 'waveform' });
        picker.onChange = redraw;
        root.appendChild(picker.element);
      }
    }

    const viz = document.createElement('div');
    viz.className = 'vst-viz vst-lfo-mini';
    const svg = makeSvg('0 0 200 50');
    const ax = document.createElementNS(NS, 'line');
    ax.setAttribute('class', 'axis');
    ax.setAttribute('x1', 0); ax.setAttribute('x2', 200);
    ax.setAttribute('y1', 25); ax.setAttribute('y2', 25);
    svg.appendChild(ax);
    const wave = document.createElementNS(NS, 'path');
    wave.setAttribute('class', 'wave');
    svg.appendChild(wave);
    viz.appendChild(svg);
    root.appendChild(viz);

    const row = document.createElement('div');
    row.className = 'vst-knob-row';
    root.appendChild(row);

    for (const k of ['frequency', 'amplitude']) {
      if (!addrs[k]) continue;
      const m = paramMeta[addrs[k]];
      if (!m) continue;
      const knob = W.Knob(m, { compact: true, label: k, color: opts.color });
      knob.onChange = redraw;
      row.appendChild(knob.element);
    }

    function getUi(addr) {
      if (!addr) return 0;
      const m = paramMeta[addr];
      const w = W.get(addr);
      if (!m || !w) return 0;
      return W.sysexToUi(w.getRawValue(), m);
    }

    function redraw() {
      const wf = addrs.waveform ? (W.get(addrs.waveform) ? W.get(addrs.waveform).getRawValue() : 0) : 0;
      const freq = getUi(addrs.frequency) || 1;
      const amp = getUi(addrs.amplitude) || 0.5;
      const cycles = Math.max(0.5, Math.min(8, freq * 0.4 + 0.5));
      const N = 200;
      const pts = [];
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const phase = t * cycles * Math.PI * 2;
        let v;
        switch (wf) {
          case 0: v = Math.sin(phase); break;
          case 1: v = 2 * ((phase / (Math.PI * 2)) % 1) - 1; break;
          case 2: v = Math.sin(phase) >= 0 ? 1 : -1; break;
          case 3: { // triangle
            const p = (phase / (Math.PI * 2)) % 1;
            v = p < 0.5 ? -1 + 4 * p : 3 - 4 * p; break;
          }
          case 6: v = 1 - 2 * ((phase / (Math.PI * 2)) % 1); break;
          case 7: v = Math.sign(Math.sin(Math.floor(t * cycles * 6)));break;
          default: v = Math.sin(phase);
        }
        pts.push([t * 200, 25 - v * amp * 22]);
      }
      const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      wave.setAttribute('d', d);
    }
    redraw();
    return { element: root, redraw };
  }

  // --- Rhythm Grid ------------------------------------------
  // 7 voices x 16 steps. Bits stored at sysex addresses base_adress_rythm + step.
  function RhythmGrid(opts = {}) {
    const base = (global.miniChordController?.base_adress_rythm) || 220;
    const root = document.createElement('div');
    root.className = 'vst-rhythm';
    if (opts.color) root.style.setProperty('--knob-color', opts.color);

    const labels = ['voice 1', 'voice 2', 'voice 3', 'voice 4', 'voice 2"', 'voice 3"', 'voice 4"'];
    const cells = [];
    for (let voice = 0; voice < 7; voice++) {
      const row = document.createElement('div');
      row.className = 'row';
      const lbl = document.createElement('div');
      lbl.className = 'label';
      lbl.textContent = labels[voice];
      row.appendChild(lbl);
      cells.push([]);
      for (let step = 0; step < 16; step++) {
        const c = document.createElement('div');
        c.className = 'cell' + (step % 4 === 0 ? ' beat-strong' : '');
        c.dataset.voice = voice;
        c.dataset.step = step;
        c.addEventListener('click', () => { c.classList.toggle('on'); send(); });
        row.appendChild(c);
        cells[voice].push(c);
      }
      root.appendChild(row);
    }

    function send() {
      for (let step = 0; step < 16; step++) {
        let bits = 0;
        for (let v = 0; v < 7; v++) {
          if (cells[v][step].classList.contains('on')) bits |= (1 << v);
        }
        global.setParameter(base + step, bits);
      }
    }

    function setStepFromSysex(stepIdx, bits) {
      for (let v = 0; v < 7; v++) {
        cells[v][stepIdx].classList.toggle('on', !!((bits >> v) & 1));
      }
    }

    // Register a virtual widget per step address so sysex echo / preset load works.
    for (let step = 0; step < 16; step++) {
      const addr = base + step;
      W.register(addr, {
        element: root,
        meta: { address: addr, name: 'rhythm step ' + step, defaultRaw: 0, dataType: 'int', min: 0, max: 127 },
        setFromSysex(raw) { setStepFromSysex(step, Math.round(Number(raw))); },
        getRawValue() {
          let bits = 0;
          for (let v = 0; v < 7; v++) if (cells[v][step].classList.contains('on')) bits |= (1 << v);
          return bits;
        }
      });
    }

    return { element: root };
  }

  global.VstViz = {
    WaveformPicker, ADSRPanel, FilterResponse, LFOMini, RhythmGrid,
    WAVEFORM_LABELS, WAVEFORM_PATHS
  };
})(window);
