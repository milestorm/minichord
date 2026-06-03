/* ============================================================
 * widgets.js — VST-style control primitives
 * Each widget shares unified UX:
 *   - drag (vertical) / wheel to change
 *   - right-click → numeric popover with min/max
 *   - double-click → reset to default
 *   - all values funnel through window.setParameter(address, raw)
 *   - registry exposes setFromSysex() for inbound sysex echo
 * ========================================================== */

(function (global) {
  'use strict';

  // --- Registry ---------------------------------------------
  const registry = new Map(); // sysex address -> widget instance

  function register(addr, w) {
    if (addr == null) return;
    registry.set(Number(addr), w);
  }
  function get(addr) { return registry.get(Number(addr)); }

  // --- Math helpers (mirror legacy handlechange / set_slider_to_value)
  // For exponential int params:
  //   raw (sysex) = exp((ln(max)/max) * uiPos), where uiPos in [0..max] linear
  // For linear:   raw = uiPos
  // For float:    raw = round(uiPos * float_multiplier)
  function uiToSysex(uiPos, meta) {
    let raw;
    if (meta.curve === 'exponential') {
      raw = Math.exp((Math.log(meta.max) / meta.max) * uiPos);
    } else {
      raw = uiPos;
    }
    if (meta.dataType === 'float') {
      raw = Math.round(raw * (global.miniChordController?.float_multiplier || 100));
    } else {
      raw = Math.round(raw);
    }
    return raw;
  }
  function sysexToUi(rawValue, meta) {
    let v;
    if (meta.dataType === 'float') {
      v = Number(rawValue) / (global.miniChordController?.float_multiplier || 100);
    } else {
      v = Number(rawValue);
    }
    if (!Number.isFinite(v)) v = meta.min;
    if (meta.curve === 'exponential' && v > 0 && meta.max > 1) {
      v = (meta.max * Math.log(v)) / Math.log(meta.max);
    }
    if (!Number.isFinite(v)) v = meta.min;
    return v;
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function formatValue(uiValue, meta) {
    if (meta.dataType === 'int') {
      // For exponential we display the *sysex* value (ms etc), not the linear ui pos
      if (meta.curve === 'exponential') {
        const raw = Math.round(Math.exp((Math.log(meta.max) / meta.max) * uiValue));
        return String(raw);
      }
      return String(Math.round(uiValue));
    }
    return Number(uiValue).toFixed(2);
  }

  // --- Number popover (right-click input) -------------------
  let activePopover = null;
  function closePopover() {
    if (activePopover) {
      activePopover.remove();
      activePopover = null;
      document.removeEventListener('mousedown', onDocClick, true);
    }
  }
  function onDocClick(e) {
    if (activePopover && !activePopover.contains(e.target)) closePopover();
  }
  function openPopover(anchor, meta, currentRaw, onCommit) {
    closePopover();
    const el = document.createElement('div');
    el.className = 'vst-popover';
    const dispMin = meta.dataType === 'float' ? meta.min : meta.min;
    const dispMax = meta.dataType === 'float' ? meta.max : meta.max;
    const step = meta.dataType === 'float' ? 0.01 : 1;
    el.innerHTML = `
      <div class="pop-title">${meta.name}</div>
      <div class="pop-range"><span>min ${dispMin}</span><span>max ${dispMax}</span></div>
      <input type="number" min="${dispMin}" max="${dispMax}" step="${step}" />
      <div class="pop-actions">
        <button class="vst-btn" data-act="cancel">cancel</button>
        <button class="vst-btn primary" data-act="ok">apply</button>
      </div>
      <div class="pop-help">enter to apply · esc to cancel</div>
    `;
    document.body.appendChild(el);
    const input = el.querySelector('input');
    // current raw is sysex value; show it in human terms
    let displayed;
    if (meta.dataType === 'float') displayed = (currentRaw / (global.miniChordController?.float_multiplier || 100));
    else displayed = currentRaw;
    input.value = Number(displayed).toFixed(meta.dataType === 'float' ? 2 : 0);
    // Position
    const r = anchor.getBoundingClientRect();
    el.style.left = Math.min(window.innerWidth - 220, r.left) + 'px';
    el.style.top = (r.bottom + 6) + 'px';
    // Focus
    setTimeout(() => { input.focus(); input.select(); }, 0);
    activePopover = el;
    setTimeout(() => document.addEventListener('mousedown', onDocClick, true), 0);

    function commit() {
      let v = parseFloat(input.value);
      if (isNaN(v)) { closePopover(); return; }
      v = clamp(v, dispMin, dispMax);
      let raw;
      if (meta.dataType === 'float') {
        raw = Math.round(v * (global.miniChordController?.float_multiplier || 100));
      } else {
        raw = Math.round(v);
      }
      onCommit(raw);
      closePopover();
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); closePopover(); }
    });
    el.querySelector('[data-act=ok]').addEventListener('click', commit);
    el.querySelector('[data-act=cancel]').addEventListener('click', closePopover);
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopover(); });

  // --- Tooltip ---------------------------------------------
  let activeTip = null;
  function showTip(el, text) {
    if (!text) return;
    if (activeTip) activeTip.remove();
    const t = document.createElement('div');
    t.className = 'vst-tip';
    t.textContent = text;
    document.body.appendChild(t);
    const r = el.getBoundingClientRect();
    t.style.left = Math.min(window.innerWidth - 250, r.left) + 'px';
    t.style.top = (r.bottom + 6) + 'px';
    activeTip = t;
  }
  function hideTip() { if (activeTip) { activeTip.remove(); activeTip = null; } }

  function attachTip(el, text) {
    if (!text) return;
    el.addEventListener('mouseenter', () => showTip(el, text));
    el.addEventListener('mouseleave', hideTip);
  }

  // --- BaseControl ------------------------------------------
  // shared right-click + double-click + focus behaviour
  function attachShared(el, meta, ctl) {
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openPopover(el, meta, ctl.getRawValue(), (raw) => ctl.setFromSysex(raw, true));
    });
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      const def = meta.defaultRaw;
      ctl.setFromSysex(def, true);
    });
  }

  // --- Knob -------------------------------------------------
  // SVG knob, drag-vertical to change, wheel to nudge.
  function Knob(meta, opts = {}) {
    const root = document.createElement('div');
    root.className = 'vst-knob' + (opts.compact ? ' compact' : '') + (opts.large ? ' large' : '');
    if (opts.bipolar) root.classList.add('bipolar');
    if (opts.color) root.style.setProperty('--knob-color', opts.color);

    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 60 60');
    svg.classList.add('dial');
    svg.setAttribute('tabindex', '0');
    // Arc: from -135deg to +135deg (270deg total)
    const cx = 30, cy = 32, R = 22;
    const startA = Math.PI * 0.75; // 135deg
    const endA = Math.PI * 2.25;   // 405deg (135 around bottom)
    function polar(a, r) {
      return [cx + Math.cos(a) * r, cy - Math.sin(a) * r];
    }
    function arcPath(a0, a1, r) {
      const [x0, y0] = polar(a0, r);
      const [x1, y1] = polar(a1, r);
      const large = (a1 - a0) > Math.PI ? 1 : 0;
      // SVG y is flipped; we flipped y in polar.
      return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 0 ${x1} ${y1}`;
    }
    // Background full ring
    const ringBg = document.createElementNS(NS, 'path');
    ringBg.setAttribute('class', 'ring-bg');
    // We use angles measured CCW; draw with a sweep flag. Simpler: build with angle interpolation.
    // For robustness, build ring as 32 line segments.
    function buildArc(elem, frac0, frac1) {
      // frac in [0..1] mapping into the 270deg arc
      const a0 = Math.PI * 1.25 - Math.PI * 1.5 * frac0;  // start at 225deg, go CW
      const a1 = Math.PI * 1.25 - Math.PI * 1.5 * frac1;
      // Build polyline
      const pts = [];
      const steps = 28;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = a0 + (a1 - a0) * t;
        pts.push(polar(a, R));
      }
      const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ');
      elem.setAttribute('d', d);
    }
    buildArc(ringBg, 0, 1);
    svg.appendChild(ringBg);

    const ringFg = document.createElementNS(NS, 'path');
    ringFg.setAttribute('class', 'ring-fg');
    svg.appendChild(ringFg);

    // Body
    const body = document.createElementNS(NS, 'circle');
    body.setAttribute('class', 'body');
    body.setAttribute('cx', cx); body.setAttribute('cy', cy);
    body.setAttribute('r', 16);
    svg.appendChild(body);

    // Indicator line
    const indicator = document.createElementNS(NS, 'line');
    indicator.setAttribute('class', 'indicator');
    svg.appendChild(indicator);

    root.appendChild(svg);

    const nameEl = document.createElement('div');
    nameEl.className = 'name';
    nameEl.textContent = opts.label || meta.name;
    root.appendChild(nameEl);

    const valEl = document.createElement('div');
    valEl.className = 'value';
    root.appendChild(valEl);

    let uiValue = sysexToUi(meta.defaultRaw, meta);

    function render() {
      // map uiValue range [meta.min..meta.max] -> frac [0..1]
      const span = (meta.max - meta.min) || 1;
      let frac = (uiValue - meta.min) / span;
      if (!Number.isFinite(frac)) frac = 0;
      frac = clamp(frac, 0, 1);
      if (opts.bipolar) {
        const center = 0.5;
        const a0 = Math.min(center, frac);
        const a1 = Math.max(center, frac);
        buildArc(ringFg, a0, a1);
      } else {
        buildArc(ringFg, 0, frac);
      }
      // Indicator from center to outer
      const ang = Math.PI * 1.25 - Math.PI * 1.5 * frac;
      const [x1, y1] = polar(ang, 5);
      const [x2, y2] = polar(ang, 14);
      indicator.setAttribute('x1', x1.toFixed(2)); indicator.setAttribute('y1', y1.toFixed(2));
      indicator.setAttribute('x2', x2.toFixed(2)); indicator.setAttribute('y2', y2.toFixed(2));
      // Value label
      valEl.textContent = formatValue(uiValue, meta);
    }

    function commit(send) {
      uiValue = clamp(uiValue, meta.min, meta.max);
      render();
      if (send) {
        const raw = uiToSysex(uiValue, meta);
        global.setParameter(meta.address, raw);
      }
      api.onChange && api.onChange();
    }

    // Drag
    let dragging = false, dragY0 = 0, ui0 = 0;
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      dragY0 = e.clientY;
      ui0 = uiValue;
      svg.setPointerCapture(e.pointerId);
      root.classList.add('dragging');
      e.preventDefault();
    });
    svg.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = dragY0 - e.clientY;
      const range = meta.max - meta.min;
      const speed = e.shiftKey ? 0.0008 : 0.004;
      uiValue = ui0 + dy * range * speed;
      commit(true);
    });
    svg.addEventListener('pointerup', (e) => {
      if (dragging) {
        dragging = false;
        root.classList.remove('dragging');
        try { svg.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    });
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const range = meta.max - meta.min;
      const step = (meta.dataType === 'int' && !meta.fineWheel) ? 1 : range * 0.01;
      uiValue += (e.deltaY < 0 ? 1 : -1) * step;
      commit(true);
    }, { passive: false });
    svg.addEventListener('keydown', (e) => {
      const range = meta.max - meta.min;
      const step = meta.dataType === 'int' ? 1 : range * 0.01;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { uiValue += step; commit(true); e.preventDefault(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { uiValue -= step; commit(true); e.preventDefault(); }
    });

    const api = {
      element: root,
      meta,
      setFromSysex(raw, send = false) {
        uiValue = sysexToUi(raw, meta);
        commit(send);
      },
      getRawValue() { return uiToSysex(uiValue, meta); },
      onChange: null
    };
    attachShared(root, meta, api);
    attachTip(root, meta.tooltip);
    register(meta.address, api);
    render();
    return api;
  }

  // --- Toggle (0/1 int) -------------------------------------
  function Toggle(meta, opts = {}) {
    const root = document.createElement('div');
    root.className = 'vst-toggle';
    if (opts.color) root.style.setProperty('--knob-color', opts.color);
    const sw = document.createElement('div');
    sw.className = 'switch';
    sw.tabIndex = 0;
    root.appendChild(sw);
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = opts.label || meta.name;
    root.appendChild(name);

    let val = Number(meta.defaultRaw);
    function render() { root.classList.toggle('on', val === 1); }
    function commit(send) {
      val = val ? 1 : 0;
      render();
      if (send) global.setParameter(meta.address, val);
      api.onChange && api.onChange();
    }
    sw.addEventListener('click', () => { val = val ? 0 : 1; commit(true); });
    sw.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { val = val ? 0 : 1; commit(true); e.preventDefault(); }
    });

    const api = {
      element: root, meta,
      setFromSysex(raw, send = false) { val = Number(raw) ? 1 : 0; commit(send); },
      getRawValue() { return val; },
      onChange: null
    };
    attachShared(root, meta, api);
    attachTip(root, meta.tooltip);
    register(meta.address, api);
    render();
    return api;
  }

  // --- Segmented (small int range) --------------------------
  function Segmented(meta, opts = {}) {
    const root = document.createElement('div');
    root.className = 'vst-segmented';
    if (opts.color) root.style.setProperty('--knob-color', opts.color);
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = opts.label || meta.name;
    root.appendChild(name);
    const opts_div = document.createElement('div');
    opts_div.className = 'options';
    const labels = opts.labels || null;
    const min = meta.min, max = meta.max;
    const buttons = [];
    for (let v = min; v <= max; v++) {
      const b = document.createElement('button');
      b.className = 'seg';
      b.type = 'button';
      b.textContent = labels ? labels[v - min] : String(v);
      b.addEventListener('click', () => { val = v; commit(true); });
      opts_div.appendChild(b);
      buttons.push(b);
    }
    root.appendChild(opts_div);

    let val = Number(meta.defaultRaw);
    function render() {
      buttons.forEach((b, i) => b.classList.toggle('active', (min + i) === val));
    }
    function commit(send) {
      val = clamp(val, min, max);
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
    attachShared(root, meta, api);
    attachTip(root, meta.tooltip);
    register(meta.address, api);
    render();
    return api;
  }

  // --- Dropdown --------------------------------------------
  function Dropdown(meta, opts = {}) {
    const root = document.createElement('div');
    root.className = 'vst-dropdown';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = opts.label || meta.name;
    root.appendChild(name);
    const sel = document.createElement('select');
    sel.className = 'vst-select';
    const labels = opts.labels || null;
    for (let v = meta.min; v <= meta.max; v++) {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = labels ? labels[v - meta.min] : String(v);
      sel.appendChild(o);
    }
    root.appendChild(sel);

    let val = Number(meta.defaultRaw);
    function render() { sel.value = String(val); }
    function commit(send) {
      val = clamp(Math.round(val), meta.min, meta.max);
      render();
      if (send) global.setParameter(meta.address, val);
      api.onChange && api.onChange();
    }
    sel.addEventListener('change', () => { val = parseInt(sel.value, 10); commit(true); });

    const api = {
      element: root, meta,
      setFromSysex(raw, send = false) { val = Math.round(Number(raw)); commit(send); },
      getRawValue() { return val; },
      onChange: null
    };
    attachShared(root, meta, api);
    attachTip(root, meta.tooltip);
    register(meta.address, api);
    render();
    return api;
  }

  // --- ColorWheel (hue 0..360 int) --------------------------
  function ColorWheel(meta, opts = {}) {
    const root = document.createElement('div');
    root.className = 'vst-colorwheel';
    const wheel = document.createElement('div');
    wheel.className = 'wheel';
    const marker = document.createElement('div');
    marker.className = 'marker';
    wheel.appendChild(marker);
    root.appendChild(wheel);
    const name = document.createElement('div');
    name.className = 'name'; name.textContent = opts.label || meta.name;
    root.appendChild(name);
    const valEl = document.createElement('div');
    valEl.className = 'value';
    root.appendChild(valEl);

    let val = Number(meta.defaultRaw);
    function render() {
      const ang = (val / 360) * Math.PI * 2 - Math.PI / 2;
      const r = 38;
      const cx = 44, cy = 44;
      marker.style.left = (cx + Math.cos(ang) * r) + 'px';
      marker.style.top = (cy + Math.sin(ang) * r) + 'px';
      marker.style.background = `hsl(${val}, 90%, 55%)`;
      valEl.textContent = String(Math.round(val)) + '°';
    }
    function commit(send) {
      val = ((Math.round(val) % 360) + 360) % 360;
      render();
      if (send) global.setParameter(meta.address, val);
      api.onChange && api.onChange();
    }
    function fromEvent(e) {
      const r = wheel.getBoundingClientRect();
      const x = e.clientX - r.left - r.width / 2;
      const y = e.clientY - r.top - r.height / 2;
      const ang = Math.atan2(y, x) + Math.PI / 2;
      let deg = (ang * 180) / Math.PI;
      if (deg < 0) deg += 360;
      val = deg;
      commit(true);
    }
    let drag = false;
    wheel.addEventListener('pointerdown', (e) => {
      drag = true; wheel.setPointerCapture(e.pointerId); fromEvent(e);
    });
    wheel.addEventListener('pointermove', (e) => { if (drag) fromEvent(e); });
    wheel.addEventListener('pointerup', (e) => { drag = false; try { wheel.releasePointerCapture(e.pointerId); } catch(_){} });

    const api = {
      element: root, meta,
      setFromSysex(raw, send = false) { val = Number(raw); commit(send); },
      getRawValue() { return Math.round(val); },
      onChange: null
    };
    attachShared(root, meta, api);
    attachTip(root, meta.tooltip);
    register(meta.address, api);
    render();
    return api;
  }

  // Build a normalized meta from a parameters.json entry
  function metaFromParam(p) {
    return {
      address: p.sysex_adress,
      name: p.name,
      tooltip: p.tooltip,
      group: p.group,
      curve: p.curve,
      dataType: p.data_type,
      min: p.min_value,
      max: p.max_value,
      // defaultRaw is in *sysex* units (what we'd send/receive)
      defaultRaw: p.data_type === 'float'
        ? Math.round(p.default_value * 100)
        : p.default_value,
      defaultUi: p.default_value,
      iterate: p.iterate,
      version: p.introduction_version
    };
  }

  global.VstWidgets = {
    Knob, Toggle, Segmented, Dropdown, ColorWheel,
    metaFromParam,
    registry, register, get,
    sysexToUi, uiToSysex,
    closePopover
  };
})(window);
