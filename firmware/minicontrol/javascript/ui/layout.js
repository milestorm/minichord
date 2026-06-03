/* ============================================================
 * layout.js — builds tabs, panels, and decides widget type per param.
 * ========================================================== */

(function (global) {
  'use strict';
  const W = global.VstWidgets;
  const V = global.VstViz;

  // Hue per group color (used for accent on knobs/panels)
  const GROUP_COLORS = {
    'Settings': 'hsl(210, 70%, 55%)',
    'MIDI':       '#888',
    'Effects':    '#1ec8c8',
    'Potentiometer': '#9d6cff',
    'General':    'hsl(210, 70%, 55%)',
    'Oscillator': '#50c878',
    'Envelope':   '#f5a623',
    'Low pass filter': '#7a78ff',
    'Output filter': '#7a78ff',
    'Tremolo':    '#ff5f8b',
    'Vibrato':    '#ff5f8b',
    'Transient':  '#ffb13d',
    'Rythm':      '#ffb13d'
  };

  const KEY_LABELS = ['C','G','D','A','E','B','F','Bb','Eb','Ab','Db','Gb'];

  // Custom labels for a few enumerated params
  const ENUM_LABELS = {
    35: KEY_LABELS,                         // chord key signature
    87: ['soft', 'mid', 'hard'],            // crunch type harp
    186: ['soft', 'mid', 'hard'],           // crunch type chord
    23: ['I', 'II', 'III'],                 // slash level
    21: ['off', 'on'],                       // retrigger chords
    22: ['off', 'on'],                       // change held strings
    31: ['sharp', 'flat'],
    33: ['off', 'on'],
    108: ['split', 'single']
  };

  // Mapping of (section, group) -> composite layout. Each composite "claims"
  // a list of sysex addresses so they aren't re-rendered as plain knobs.
  // Section keys: 'global', 'harp', 'chord'
  function buildCompositesForSection(section, paramsInGroup, paramMeta) {
    const composites = [];        // [{element, claims: [addr,...], titleSuffix}]
    const claimed = new Set();

    // Helper to find a param entry by name within group
    const byName = {};
    for (const p of paramsInGroup) byName[p.name] = p;

    const groupName = paramsInGroup[0]?.group;

    function findByNamePart(part) {
      return paramsInGroup.find(p => p.name.toLowerCase() === part.toLowerCase());
    }

    if (groupName === 'Envelope' || groupName === 'Vibrato') {
      // ADSR if attack & release present
      const a = findByNamePart('attack');
      const h = findByNamePart('hold');
      const d = findByNamePart('decay');
      const s = findByNamePart('sustain');
      const r = findByNamePart('release');
      const rt = findByNamePart('retrigger release');
      if (a && r) {
        const addrs = {
          attack: a.sysex_adress,
          hold: h && h.sysex_adress,
          decay: d && d.sysex_adress,
          sustain: s && s.sysex_adress,
          release: r.sysex_adress,
          retrigger: rt && rt.sysex_adress
        };
        const adsr = V.ADSRPanel(groupName, addrs, paramMeta, { color: GROUP_COLORS[groupName] });
        Object.values(addrs).forEach(x => { if (x != null) claimed.add(x); });
        composites.push({ element: adsr.element, claims: claimed });
      }
    }

    if (groupName === 'Low pass filter' || groupName === 'Output filter') {
      // Filter response, picks frequency/resonance/lp/bp/hp + adsr if present.
      const freq = paramsInGroup.find(p => p.name === 'frequency' || p.name === 'base frequency');
      const res = paramsInGroup.find(p => p.name === 'resonance');
      const lp = paramsInGroup.find(p => p.name === 'lowpass');
      const bp = paramsInGroup.find(p => p.name === 'bandpass');
      const hp = paramsInGroup.find(p => p.name === 'highpass');
      const kt = paramsInGroup.find(p => p.name === 'keytrack value');
      const sens = paramsInGroup.find(p => p.name === 'filter sensitivity');
      const lfoFreq = paramsInGroup.find(p => p.name === 'LFO frequency');
      const lfoAmp = paramsInGroup.find(p => p.name === 'LFO amplitude');
      const lfoWf = paramsInGroup.find(p => p.name === 'LFO waveform');

      const addrs = {};
      if (freq) addrs.frequency = freq.sysex_adress;
      if (res) addrs.resonance = res.sysex_adress;
      if (lp) addrs.lowpass = lp.sysex_adress;
      if (bp) addrs.bandpass = bp.sysex_adress;
      if (hp) addrs.highpass = hp.sysex_adress;
      if (kt) addrs.keytrack = kt.sysex_adress;
      if (sens) addrs.sensitivity = sens.sysex_adress;
      if (lfoFreq) addrs.lfo_freq = lfoFreq.sysex_adress;
      if (lfoAmp) addrs.lfo_amp = lfoAmp.sysex_adress;
      if (lfoWf) addrs.lfo_waveform = lfoWf.sysex_adress;

      if (Object.keys(addrs).length > 0) {
        const fr = V.FilterResponse(addrs, paramMeta, { color: GROUP_COLORS[groupName] });
        Object.values(addrs).forEach(x => claimed.add(x));
        composites.push({ element: fr.element, claims: claimed });
      }

      // ADSR for filter envelope (attack/hold/decay/sustain/release of the filter)
      const a = paramsInGroup.find(p => p.name === 'attack');
      const h = paramsInGroup.find(p => p.name === 'hold');
      const d = paramsInGroup.find(p => p.name === 'decay');
      const s = paramsInGroup.find(p => p.name === 'sustain');
      const r = paramsInGroup.find(p => p.name === 'release');
      const rt = paramsInGroup.find(p => p.name === 'retrigger release');
      if (a && r) {
        const eAddrs = {
          attack: a.sysex_adress,
          hold: h && h.sysex_adress,
          decay: d && d.sysex_adress,
          sustain: s && s.sysex_adress,
          release: r.sysex_adress,
          retrigger: rt && rt.sysex_adress
        };
        const adsr = V.ADSRPanel('filter env', eAddrs, paramMeta, { color: '#f5a623' });
        Object.values(eAddrs).forEach(x => { if (x != null) claimed.add(x); });
        composites.push({ element: adsr.element, claims: claimed, header: 'filter envelope' });
      }
    }

    if (groupName === 'Tremolo' || (groupName === 'Vibrato' && false)) {
      // LFO mini for tremolo
      const wf = paramsInGroup.find(p => p.name === 'waveform');
      const fq = paramsInGroup.find(p => p.name === 'frequency');
      const am = paramsInGroup.find(p => p.name === 'amplitude');
      if (wf || fq || am) {
        const addrs = {};
        if (wf) addrs.waveform = wf.sysex_adress;
        if (fq) addrs.frequency = fq.sysex_adress;
        if (am) addrs.amplitude = am.sysex_adress;
        const lfo = V.LFOMini(addrs, paramMeta, { color: GROUP_COLORS[groupName] });
        Object.values(addrs).forEach(x => claimed.add(x));
        composites.push({ element: lfo.element, claims: claimed });
      }
    }

    if (groupName === 'Oscillator' || groupName === 'Transient') {
      // Use waveform picker for any "waveform"/"waveform N" int param of range 0..11
      for (const p of paramsInGroup) {
        if (/^waveform/.test(p.name) && p.max_value === 11 && p.data_type === 'int') {
          const picker = V.WaveformPicker(W.metaFromParam(p), { color: GROUP_COLORS[groupName], label: p.name });
          claimed.add(p.sysex_adress);
          composites.push({ element: picker.element, claims: claimed });
        }
      }
    }

    return { composites, claimed };
  }

  function decideWidget(p) {
    const m = W.metaFromParam(p);
    const range = p.max_value - p.min_value;
    const color = GROUP_COLORS[p.group] || 'var(--accent)';
    // Hue 0..360 for bank color
    if (p.sysex_adress === 20) return W.ColorWheel(m, { color });
    // Boolean toggle
    if (p.data_type === 'int' && p.min_value === 0 && p.max_value === 1) {
      const labels = ENUM_LABELS[p.sysex_adress];
      return W.Toggle(m, { color, label: labels ? `${p.name}` : p.name });
    }
    // Small enumerated int (<= 11 options): segmented OR dropdown
    if (p.data_type === 'int' && range > 1 && range <= 11) {
      const labels = ENUM_LABELS[p.sysex_adress];
      // For waveform indices we'd already use picker; here generic.
      if (range >= 7 || labels) {
        return W.Dropdown(m, { color, labels });
      }
      return W.Segmented(m, { color, labels });
    }
    // Default: knob
    return W.Knob(m, { color });
  }

  function makePanel(title, color) {
    const panel = document.createElement('section');
    panel.className = 'vst-panel';
    if (color) panel.style.setProperty('--panel-color', color);
    if (color) panel.style.setProperty('--knob-color', color);
    const head = document.createElement('div');
    head.className = 'vst-panel-head';
    head.innerHTML = `<span class="swatch"></span><h3>${title}</h3>`;
    panel.appendChild(head);
    return panel;
  }

  // Build a section ('global'|'harp'|'chord') from its parameter list.
  // Returns {pane, advancedExtras}: advancedExtras = panels for 'hidden' group.
  function buildSection(sectionId, paramList, paramMeta) {
    const pane = document.createElement('div');
    pane.className = 'vst-tab-pane';
    pane.dataset.section = sectionId;
    const grid = document.createElement('div');
    grid.className = 'vst-panel-grid';
    pane.appendChild(grid);

    // Group params by their group name, preserving order
    const groupOrder = [];
    const groups = {};
    for (const p of paramList) {
      if (!groups[p.group]) { groups[p.group] = []; groupOrder.push(p.group); }
      groups[p.group].push(p);
    }

    const advancedPanels = [];

    for (const gName of groupOrder) {
      const params = groups[gName];
      if (gName === 'hidden') {
        // Render compactly into Advanced tab
        const panel = makePanel(`${sectionId} · advanced`, GROUP_COLORS[gName] || '#777');
        const row = document.createElement('div');
        row.className = 'vst-knob-row';
        for (const p of params) {
          const w = decideWidget(p);
          row.appendChild(w.element);
        }
        panel.appendChild(row);
        advancedPanels.push(panel);
        continue;
      }
      const panel = makePanel(gName.toLowerCase(), GROUP_COLORS[gName]);

      const compositeRes = buildCompositesForSection(sectionId, params, paramMeta);
      const finalClaimed = compositeRes.claimed;

      for (const c of compositeRes.composites) {
        if (c.header) {
          const sub = document.createElement('div');
          sub.style.fontSize = '0.7em';
          sub.style.color = 'var(--text-faint)';
          sub.style.textTransform = 'uppercase';
          sub.style.letterSpacing = '0.05em';
          sub.style.margin = '8px 0 4px';
          sub.textContent = c.header;
          panel.appendChild(sub);
        }
        panel.appendChild(c.element);
      }

      // Remaining knobs/toggles row
      const remaining = params.filter(p => !finalClaimed.has(p.sysex_adress));
      if (remaining.length) {
        const row = document.createElement('div');
        row.className = 'vst-knob-row';
        for (const p of remaining) {
          const w = decideWidget(p);
          row.appendChild(w.element);
        }
        panel.appendChild(row);
      }

      // Wider panel for some groups
      if (['Rythm', 'Low pass filter', 'Output filter', 'Effects'].includes(gName)) {
        panel.classList.add('span-2');
      }
      grid.appendChild(panel);
    }

    // Special: Rhythm grid for chord section
    if (sectionId === 'chord') {
      const panel = makePanel('rhythm grid', GROUP_COLORS['Rythm']);
      panel.classList.add('full');
      const grid_ = V.RhythmGrid({ color: GROUP_COLORS['Rythm'] });
      panel.appendChild(grid_.element);
      pane.querySelector('.vst-panel-grid').appendChild(panel);
    }

    return { pane, advancedPanels };
  }

  // Build whole UI inside the given container
  async function buildAll(container) {
    const res = await fetch('./json/parameters.json');
    const data = await res.json();

    const allParams = [];
    const paramMeta = {};
    for (const sec of ['global_parameter', 'harp_parameter', 'chord_parameter']) {
      for (const p of data[sec]) {
        allParams.push(p);
        paramMeta[p.sysex_adress] = p;
      }
    }

    const tabs = document.createElement('div');
    tabs.className = 'vst-tabs';
    container.appendChild(tabs);

    const panes = document.createElement('div');
    container.appendChild(panes);

    const sections = [
      { id: 'global', label: 'Global', list: data.global_parameter },
      { id: 'harp', label: 'Harp', list: data.harp_parameter },
      { id: 'chord', label: 'Chord', list: data.chord_parameter }
    ];

    const advancedAll = [];
    for (const s of sections) {
      const { pane, advancedPanels } = buildSection(s.id, s.list, paramMeta);
      panes.appendChild(pane);
      const tab = document.createElement('button');
      tab.className = 'vst-tab';
      tab.type = 'button';
      tab.textContent = s.label;
      tab.addEventListener('click', () => activate(s.id));
      tab.dataset.tab = s.id;
      tabs.appendChild(tab);
      if (advancedPanels.length) {
        for (const p of advancedPanels) {
          // Tag with section so we can group
          const wrap = document.createElement('div');
          wrap.appendChild(p);
          advancedAll.push({ section: s.label, panel: p });
        }
      }
    }

    // Advanced tab
    if (advancedAll.length) {
      const pane = document.createElement('div');
      pane.className = 'vst-tab-pane';
      pane.dataset.section = 'advanced';
      const grid = document.createElement('div');
      grid.className = 'vst-panel-grid';
      pane.appendChild(grid);
      for (const a of advancedAll) grid.appendChild(a.panel);
      panes.appendChild(pane);

      const tab = document.createElement('button');
      tab.className = 'vst-tab';
      tab.type = 'button';
      tab.textContent = 'Advanced';
      tab.addEventListener('click', () => activate('advanced'));
      tab.dataset.tab = 'advanced';
      tabs.appendChild(tab);
    }

    function activate(id) {
      tabs.querySelectorAll('.vst-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id));
      panes.querySelectorAll('.vst-tab-pane').forEach(p => p.classList.toggle('active', p.dataset.section === id));
      try { localStorage.setItem('minicontrol.tab', id); } catch (_) {}
    }
    const remembered = (() => { try { return localStorage.getItem('minicontrol.tab'); } catch (_) { return null; }})();
    activate(remembered && document.querySelector(`.vst-tab[data-tab=\"${remembered}\"]`) ? remembered : 'global');

    return { paramMeta };
  }

  global.VstLayout = { buildAll };
})(window);
