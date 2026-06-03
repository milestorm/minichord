/* ============================================================
 * minicontrol — orchestrator (VST-style UI)
 *
 * Responsibilities:
 *   - own MiniChordController instance
 *   - build the UI from parameters.json (delegated to VstLayout)
 *   - expose setParameter() used by every widget
 *   - relay sysex echo / preset load / random preset back into widgets
 *   - sharing: export/import/save/reset/random
 *
 * UX guarantees provided by widgets.js:
 *   drag/scroll to change · right-click → numeric popover (min/max shown)
 *   double-click → reset to default · keyboard arrows when focused
 * ========================================================== */

const miniChordController = new MiniChordController();
let active_bank_number = -1;
let parameterMeta = {};   // sysex address -> raw param entry from JSON

// --- Public: set a parameter via UI ------------------------
window.setParameter = function (address, sysexValue) {
  if (!miniChordController.isConnected()) {
    document.getElementById('information_zone').focus();
    return;
  }
  miniChordController.sendParameter(address, sysexValue);

  // Bank-color hue: drive global accent
  if (address === miniChordController.color_hue_sysex_adress) {
    document.documentElement.style.setProperty('--accent-hue', String(Math.round(sysexValue)));
  }

  // Recompute composite visualizers (ADSR/filter/LFO) attached to this address
  // The widget itself fires onChange, but composites listen to their own knobs.
  // Nothing more to do here.
};

// --- Helpers ----------------------------------------------
function setBodyConnected(connected) {
  document.body.classList.toggle('disconnected', !connected);
}

function applySysexSnapshot(parameters) {
  // For each address received, push to widget if registered.
  for (let i = 0; i < parameters.length; i++) {
    if (parameters[i] === undefined) continue;
    const w = VstWidgets.get(i);
    if (w) w.setFromSysex(parameters[i], false);
  }
  // Update accent hue from bank color
  const hueAddr = miniChordController.color_hue_sysex_adress;
  if (parameters[hueAddr] !== undefined) {
    document.documentElement.style.setProperty('--accent-hue', String(Math.round(parameters[hueAddr])));
  }
  // Rythm grid steps are registered as virtual widgets, but the controller
  // returns rhythmData separately — applied in onDataReceived.
}

// --- Controller callbacks ---------------------------------
miniChordController.onConnectionChange = function (connected, message) {
  const status = document.getElementById('status_zone');
  status.classList.remove('connected', 'disconnected');
  const stepsEl = document.getElementById('conn_steps');
  const infoText = document.getElementById('information_text');
  if (connected) {
    status.classList.add('connected');
    document.getElementById('status_value').textContent = 'connected';
    document.getElementById('step3').classList.remove('unsatisfied');
    if (infoText) infoText.textContent = '';
    if (stepsEl) stepsEl.style.display = 'none';
    setBodyConnected(true);
  } else {
    status.classList.add('disconnected');
    document.getElementById('status_value').textContent = 'disconnected';
    if (infoText) infoText.textContent = message || '';
    if (stepsEl) stepsEl.style.display = '';
    setBodyConnected(false);
    if (message && message.includes('disconnected')) {
      window.scrollTo(0, 0);
    }
  }
};

miniChordController.onDataReceived = function (data) {
  // 1) plain parameters
  applySysexSnapshot(data.parameters);

  // 2) rhythm grid
  for (let step = 0; step < (data.rhythmData || []).length; step++) {
    const bits = data.rhythmData[step];
    if (!bits) continue;
    let mask = 0;
    for (let v = 0; v < 7; v++) if (bits[v]) mask |= (1 << v);
    const w = VstWidgets.get(miniChordController.base_adress_rythm + step);
    if (w) w.setFromSysex(mask, false);
  }

  // 3) bank selection
  const bankSel = document.getElementById('bank_number_selection');
  if (bankSel) bankSel.value = data.bankNumber;
  active_bank_number = data.bankNumber;

  // 4) connection dot
  miniChordController.onConnectionChange(true, '');
};

// --- Init -------------------------------------------------
async function initializeMidiController() {
  try {
    const ok = await miniChordController.initialize();
    if (ok) {
      document.getElementById('step1').classList.remove('unsatisfied');
      document.getElementById('step2').classList.remove('unsatisfied');
    } else {
      document.getElementById('information_text').textContent = '> please use a compatible browser';
    }
  } catch (err) {
    console.error(err);
    document.getElementById('information_text').textContent = '> please reload and grant MIDI authorisation';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Build the UI
  const root = document.getElementById('vst-root');
  const { paramMeta } = await VstLayout.buildAll(root);
  parameterMeta = paramMeta;

  // theme persistence
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') document.body.classList.add('dark-mode');

  // randomize button
  const rnd = document.getElementById('randomise_btn');
  if (rnd) rnd.addEventListener('click', generateRandomPreset);

  // Start MIDI
  initializeMidiController();
});

// --- Theme ------------------------------------------------
window.toggleTheme = function () {
  document.body.classList.toggle('dark-mode');
  localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
};

// --- Communication wrappers (header buttons) --------------
window.reset_memory = function () {
  if (miniChordController.isConnected()) miniChordController.resetMemory();
};
window.save_current_settings = function () {
  if (miniChordController.isConnected()) {
    const bank = document.getElementById('bank_number_selection').value;
    miniChordController.saveCurrentSettings(bank);
  }
};
window.reset_current_bank = function () {
  if (miniChordController.isConnected()) miniChordController.resetCurrentBank();
};

// --- Settings export / import (preserves legacy preset code) ---
function collectSysexArray() {
  const arr = new Array(miniChordController.parameter_size).fill(0);
  for (const [addr, w] of VstWidgets.registry.entries()) {
    if (typeof w.getRawValue !== 'function') continue;
    arr[addr] = w.getRawValue();
  }
  return arr;
}

window.generate_settings = function () {
  if (!miniChordController.isConnected()) {
    document.getElementById('information_zone').focus();
    return;
  }
  const arr = collectSysexArray();
  let base64 = '';
  for (let i = 0; i < miniChordController.parameter_size; i++) base64 += arr[i] + ';';
  const encoded = btoa(base64);
  navigator.clipboard.writeText(encoded);
  alert('Preset code copied to clipboard');
};

window.load_settings = function () {
  if (!miniChordController.isConnected()) {
    document.getElementById('information_zone').focus();
    return;
  }
  const code = prompt('Paste preset code');
  if (!code) return;
  let parts;
  try { parts = atob(code).split(';'); } catch (e) { alert('malformed preset code'); return; }
  if (parts.length !== miniChordController.parameter_size) {
    alert('malformed preset code');
    return;
  }
  for (let i = 2; i < miniChordController.parameter_size; i++) {
    miniChordController.sendParameter(i, parts[i]);
  }
  miniChordController.sendParameter(0, 0); // ask device to refresh UI
};

// --- Random preset (port of legacy logic, sends through controller) ---
function normalRandom(mean, sigma) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return z * sigma + mean;
}

async function loadParameterRanges() {
  const [pRes, sRes] = await Promise.all([
    fetch('./json/parameters.json'),
    fetch('./json/shared_presets.json')
  ]);
  const params = await pRes.json();
  const presets = await sRes.json();
  const random = presets.shared_presets[Math.floor(Math.random() * presets.shared_presets.length)];
  const decoded = atob(random.value).split(';').map(v => parseFloat(v));
  const ranges = {};
  ['global_parameter', 'harp_parameter', 'chord_parameter'].forEach(cat => {
    params[cat].forEach(p => {
      const v = decoded[p.sysex_adress];
      let def = p.default_value;
      if (v !== undefined && !isNaN(v)) {
        def = (p.data_type === 'float') ? v / 100 : v;
      }
      ranges[p.sysex_adress] = {
        min: p.min_value, max: p.max_value, type: p.data_type,
        default: def, original_default: p.default_value
      };
    });
  });
  return ranges;
}

async function generateRandomPreset() {
  if (!miniChordController.isConnected()) {
    document.getElementById('information_zone').focus();
    return;
  }
  const ranges = await loadParameterRanges();
  const weirdness = 0.10;
  const preset = new Array(miniChordController.parameter_size).fill(0);
  const fixed = [32, 33, 34, 35, 41, 97, 106, 107, 108, 197];
  Object.entries(ranges).forEach(([idxStr, p]) => {
    const idx = parseInt(idxStr, 10);
    if (idx < 19 || fixed.includes(idx)) {
      preset[idx] = p.original_default;
    } else {
      const range = p.max - p.min;
      let v = normalRandom(p.default, range * weirdness);
      if (v < 0) v = -v / 4.0;
      v = Math.max(p.min, Math.min(p.max, v));
      preset[idx] = (p.type === 'int') ? Math.round(v) : Math.round(v * 100) / 100;
    }
  });
  for (let i = 2; i < miniChordController.parameter_size; i++) {
    let val = preset[i];
    if (ranges[i] && ranges[i].type === 'float') val = Math.round(preset[i] * 100);
    miniChordController.sendParameter(i, Math.round(val));
  }
  miniChordController.sendParameter(0, 0);
}
