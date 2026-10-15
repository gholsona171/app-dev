import { cleanVin, validateVin, extractVins, decodeVins } from './vin.js?v=20261015T1458';
import {
  OPTIONAL_FIELDS, classCriteria, criteriaKey, criteriaLabel, summarizeClasses, comboSize, planLoads,
} from './grouping.js?v=20261015T1458';
import { loadState, saveState, clearState, defaultState } from './storage.js?v=20261015T1458';
import { planRows, toCsv, downloadBlob, downloadXlsx, loadXlsx, readPdfText } from './export.js?v=20261015T1458';
import { VinScanner } from './scanner.js?v=20261015T1458';
import { isImageFile, readPhotoVins } from './photo.js?v=20261015T1458';

// Must match <meta name="app-version"> in index.html. Both are set by `npm run stamp`.
const APP_VERSION = '20261015T1458';

// If a cache served index.html and this file from different deploys, offer a reload.
function checkVersion() {
  try {
    const pageVersion = document.querySelector('meta[name="app-version"]')?.content;
    if (pageVersion === APP_VERSION || document.querySelector('.version-banner')) return;
    const banner = document.createElement('button');
    banner.type = 'button';
    banner.className = 'version-banner';
    banner.textContent = 'A newer version is available. Tap to reload.';
    banner.addEventListener('click', () => location.reload());
    document.body.prepend(banner);
  } catch {
    // Never block the app over this check.
  }
}
checkVersion();

const INPUT_METHODS = [
  { key: 'paste', label: 'Type or paste VINs' },
  { key: 'file', label: 'Upload a file (photo, PDF, Excel, CSV)' },
  { key: 'scan', label: 'Scan barcodes (camera or handheld scanner)' },
];

let state = loadState();
let activeTab = 'vehicles';
let editor = null; // Combination being created or edited.
let lastPlan = null;

const $ = (id) => document.getElementById(id);

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);

function save() {
  if (!saveState(state)) showStatus('Could not save to this browser. Changes will be lost when the page closes.', 'error');
}

function showStatus(text, type = 'info') {
  $('status').innerHTML = text ? `<div class="msg ${type === 'error' ? 'error' : ''}">${esc(text)}</div>` : '';
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------- Tabs ----------

function setTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.id !== `tab-${tab}`; });
  render();
}

function render() {
  if (activeTab === 'vehicles') renderVehicles();
  if (activeTab === 'combos') renderCombos();
  if (activeTab === 'plan') renderPlan();
  if (activeTab === 'settings') renderSettings();
}

// ---------- Vehicles ----------

function addVins(rawList) {
  const existing = new Set(state.vehicles.map((v) => v.vin));
  let added = 0;
  let duplicates = 0;
  let invalid = 0;
  for (const raw of rawList) {
    const check = validateVin(raw);
    if (!check.vin) continue;
    if (existing.has(check.vin)) {
      duplicates++;
      continue;
    }
    existing.add(check.vin);
    state.vehicles.push({
      id: uid(),
      vin: check.vin,
      status: check.valid ? 'pending' : 'invalid',
      error: check.error || '',
      warning: check.warning || '',
      decoded: false,
    });
    added++;
    if (!check.valid) invalid++;
  }
  save();
  const parts = [`Added ${plural(added, 'VIN')}`];
  if (invalid) parts.push(`${invalid} invalid`);
  if (duplicates) parts.push(`${plural(duplicates, 'duplicate')} skipped`);
  showStatus(`${parts.join(', ')}.`);
  render();
  decodePending();
  return added;
}

let decoding = false;

async function decodePending() {
  if (decoding) return;
  decoding = true;
  try {
    while (true) {
      const pending = state.vehicles.filter((v) => v.status === 'pending');
      if (!pending.length) break;

      const toFetch = [];
      for (const v of pending) {
        const cached = state.decodeCache[v.vin];
        if (cached) applyDecoded(v, cached);
        else toFetch.push(v);
      }
      if (!toFetch.length) {
        save();
        continue;
      }

      let results;
      try {
        results = await decodeVins(toFetch.map((v) => v.vin), {
          onProgress: (done, total) => showStatus(`Decoding VINs… ${done} of ${total}`),
        });
      } catch {
        for (const v of toFetch) {
          v.status = 'failed';
          v.error = 'Could not reach the decoder. Check the connection and retry.';
        }
        save();
        showStatus('Could not reach the NHTSA decoder. Use "Retry decoding" when back online.', 'error');
        break;
      }

      let failed = 0;
      for (const v of toFetch) {
        const r = results.get(v.vin);
        if (r && r.decoded) {
          state.decodeCache[v.vin] = r;
          applyDecoded(v, r);
        } else {
          v.status = 'failed';
          v.error = r?.decodeNote || 'No match found in the NHTSA database.';
          failed++;
        }
      }
      save();
      showStatus(failed ? `Decoding finished. ${plural(failed, 'VIN')} could not be decoded.` : 'Decoding finished.', failed ? 'error' : 'info');
    }
  } finally {
    decoding = false;
    render();
  }
}

function applyDecoded(v, r) {
  Object.assign(v, {
    make: r.make, model: r.model, year: r.year, trim: r.trim, body: r.body, fuel: r.fuel, drive: r.drive, plant: r.plant,
    decoded: true, status: 'decoded', error: '',
  });
}

function statusTag(v) {
  if (v.status === 'decoded') {
    return v.warning
      ? `<span class="tag warn" title="${esc(v.warning)}">Decoded · check digit</span>`
      : '<span class="tag ok">Decoded</span>';
  }
  if (v.status === 'pending') return '<span class="tag pending">Decoding…</span>';
  const label = v.status === 'invalid' ? 'Invalid' : 'Not decoded';
  return `<span class="tag bad" title="${esc(v.error)}">${label}</span><div class="meta">${esc(v.error)}</div>`;
}

function renderVehicles() {
  for (const card of document.querySelectorAll('#input-methods [data-method]')) {
    card.hidden = !state.settings.inputMethods[card.dataset.method];
  }

  const toggles = state.settings.matchFields;
  const detail = ['Make', 'Model', ...OPTIONAL_FIELDS.filter((f) => toggles[f.key]).map((f) => f.label)];
  $('detail-note').textContent = `Grouped by: ${detail.join(', ')}`;

  const classes = summarizeClasses(state.vehicles, toggles);
  $('class-summary').innerHTML = classes.length
    ? `<div class="table-wrap"><table><thead><tr><th>Vehicle</th><th class="num">Count</th></tr></thead><tbody>
        ${classes.map((c) => `<tr><td>${esc(c.label)}</td><td class="num">${c.count}</td></tr>`).join('')}
      </tbody></table></div>`
    : '<p class="empty">No decoded vehicles yet.</p>';

  $('vehicle-count').textContent = state.vehicles.length ? `(${state.vehicles.length})` : '';
  $('retry-decode').disabled = !state.vehicles.some((v) => v.status === 'failed');
  $('clear-vehicles').disabled = !state.vehicles.length;

  const rows = [...state.vehicles].reverse();
  $('vehicle-table').innerHTML = rows.length
    ? `<table><thead><tr><th>VIN</th><th>Year</th><th>Make</th><th>Model</th><th>Trim</th><th>Body / cab</th><th>Fuel</th><th>Status</th><th></th></tr></thead><tbody>
        ${rows.map((v) => `<tr>
          <td class="vin">${esc(v.vin)}</td><td>${esc(v.year)}</td><td>${esc(v.make)}</td><td>${esc(v.model)}</td>
          <td>${esc(v.trim)}</td><td>${esc(v.body)}</td><td>${esc(v.fuel)}</td><td>${statusTag(v)}</td>
          <td><button class="btn icon danger" data-remove="${esc(v.id)}" aria-label="Remove ${esc(v.vin)}">Remove</button></td>
        </tr>`).join('')}
      </tbody></table>`
    : '<p class="empty">Add VINs above to get started.</p>';
}

const SPREADSHEET_TYPES = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];

// iOS may hand over a file without the expected extension, so also check the type.
const isPdf = (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
const isSpreadsheet = (file) => /\.xlsx?$/i.test(file.name) || SPREADSHEET_TYPES.includes(file.type);

async function handleFile(file) {
  try {
    let text;
    if (isSpreadsheet(file)) {
      showStatus('Reading spreadsheet…');
      const XLSX = await loadXlsx();
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      text = book.SheetNames.map((name) => XLSX.utils.sheet_to_csv(book.Sheets[name])).join('\n');
    } else if (isPdf(file)) {
      showStatus('Reading PDF…');
      text = await readPdfText(await file.arrayBuffer());
    } else {
      text = await file.text();
    }
    const vins = extractVins(text);
    if (!vins.length && isPdf(file)) showStatus(`No VIN text found in ${file.name}. If it is a scanned image, use the camera scanner instead.`, 'error');
    else if (!vins.length) showStatus(`No VINs found in ${file.name}.`, 'error');
    else addVins(vins);
  } catch (err) {
    showStatus(`Could not read ${file.name}: ${err.message}`, 'error');
  }
}

// ---------- Camera scanner ----------

let scanner = null;
let scanAdded = 0;
let lastDetect = { vin: '', at: 0 };
let autoReviewVin = null;
let audioCtx = null;

function beep() {
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = 1200;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.12);
  } catch {
    // Sound unavailable.
  }
}

function scannerStatus(text, type = '') {
  $('scanner-status').textContent = text;
  $('scanner-status').className = `scanner-status ${type}`;
}

function updateScanCount() {
  $('scanner-count').textContent = scanAdded ? `${plural(scanAdded, 'VIN')} added` : '';
}

const reviewing = () => !$('scanner-review').hidden;

async function openScanner() {
  $('scanner').hidden = false;
  document.body.classList.add('scanning');
  scanAdded = 0;
  skippedAutoVins.clear();
  autoReviewVin = null;
  updateScanCount();
  showReview(null);
  $('scanner-torch').hidden = true;
  $('scanner-zoom-wrap').hidden = true;
  scannerStatus('Starting camera…');
  try {
    // Created during the tap so phones allow the success beep.
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
  } catch {
    // Sound unavailable.
  }

  const current = new VinScanner({
    video: $('scanner-video'),
    guide: $('scanner-guide'),
    onDetect: handleDetect,
    onTextReady: (ok) => {
      if (scanner === current && !reviewing()) {
        scannerStatus(ok ? 'Ready. Reading barcodes and VIN text.' : 'Ready. Reading barcodes (text reading unavailable).');
      }
    },
  });
  scanner = current;
  try {
    await current.start();
    if (scanner !== current) return;
    if (!reviewing()) scannerStatus('Ready. Reading barcodes…');
    const caps = current.capabilities();
    $('scanner-torch').hidden = !caps.torch;
    $('scanner-torch').setAttribute('aria-pressed', 'false');
    $('scanner-zoom-wrap').hidden = !caps.zoom;
    if (caps.zoom) Object.assign($('scanner-zoom'), { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step, value: caps.zoom.min });
  } catch (err) {
    const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
    scannerStatus(denied
      ? 'Camera access is blocked. Allow camera access for this site in your browser settings, then try again.'
      : `Could not start the camera: ${err?.message || err}`, 'error');
  }
}

function closeScanner() {
  scanner?.stop();
  scanner = null;
  $('scanner').hidden = true;
  document.body.classList.remove('scanning');
}

function flashGuide() {
  $('scanner-guide').classList.add('hit');
  setTimeout(() => $('scanner-guide').classList.remove('hit'), 600);
}

// VINs the user already rejected in this scanning session.
const skippedAutoVins = new Set();

// Automatic reads from the live camera. Sure reads are added right away;
// text reads that needed a correction pause and ask the user to confirm.
function handleDetect(vin, source, confidence) {
  if (reviewing() || skippedAutoVins.has(vin)) return;
  const now = Date.now();
  if (vin === lastDetect.vin && now - lastDetect.at < 4000) return;
  lastDetect = { vin, at: now };
  if (confidence === 'high') {
    addScannedVin(vin, source === 'barcode' ? 'barcode' : 'VIN text');
    return;
  }
  if (state.vehicles.some((v) => v.vin === vin)) return;
  scanner?.pause();
  autoReviewVin = vin;
  showReview(vin);
  beep();
  scannerStatus('VIN read from text. Please check it before adding.');
}

function addScannedVin(vin, how) {
  flashGuide();
  if (state.vehicles.some((v) => v.vin === vin)) {
    scannerStatus(`${vin} is already in the list.`);
    return;
  }
  addVins([vin]);
  scanAdded++;
  updateScanCount();
  beep();
  navigator.vibrate?.(80);
  scannerStatus(`Added ${vin} (${how})`, 'ok');
}

async function captureNow() {
  if (!scanner) return;
  $('scanner-capture').disabled = true;
  autoReviewVin = null;
  scannerStatus('Reading…');
  try {
    const result = await scanner.capture();
    if (!scanner) return;
    showReview(result ? result.vin : '');
    if (!result) scannerStatus('No VIN found. Type it below, or retake closer and steadier.', 'error');
    else if (result.confidence === 'high') scannerStatus('VIN found.', 'ok');
    else scannerStatus('VIN found. Please double-check it.');
  } catch (err) {
    showReview('');
    scannerStatus(`Capture failed: ${err.message}`, 'error');
  } finally {
    $('scanner-capture').disabled = false;
  }
}

// vin === null hides the review form; '' shows it empty for typing.
function showReview(vin) {
  const show = vin !== null;
  $('scanner-review').hidden = !show;
  $('scanner-controls').hidden = show;
  if (!show) return;
  $('scanner-vin').value = vin;
  updateReviewCheck();
  if (!vin) $('scanner-vin').focus();
}

// Check-digit wording shared by the scanner and photo review. kind: '', 'bad', 'warn', 'ok'.
function describeCheck(raw) {
  const check = validateVin(raw);
  if (!check.vin) return { check, text: '', kind: '' };
  if (!check.valid) return { check, text: check.error, kind: 'bad' };
  if (check.warning) return { check, text: `${check.warning}. A character may be misread.`, kind: 'warn' };
  return { check, text: 'Check digit is correct.', kind: 'ok' };
}

function updateReviewCheck() {
  const { text, kind } = describeCheck($('scanner-vin').value);
  const el = $('scanner-check');
  el.textContent = text;
  el.className = `scanner-check ${kind}`.trim();
}

function retake() {
  if (autoReviewVin) skippedAutoVins.add(autoReviewVin);
  autoReviewVin = null;
  showReview(null);
  scanner?.resume();
  scannerStatus('Ready.');
}

// ---------- Combinations ----------

function loadTypeName(id) {
  return state.loadTypes.find((t) => t.id === id)?.name || 'Unknown';
}

function comboAutoName(combo) {
  return combo.items.map((i) => `${i.qty} × ${i.criteria.model || 'Vehicle'}`).join(' + ');
}

function comboName(combo) {
  return combo.name || comboAutoName(combo);
}

// Vehicle choices for combination items: decoded vehicles at the current
// detail level, plus anything already used in a combination.
function vehicleCatalog() {
  const map = new Map();
  for (const c of summarizeClasses(state.vehicles, state.settings.matchFields)) {
    map.set(c.key, { key: c.key, criteria: c.criteria, label: `${c.label} (${c.count} in list)` });
  }
  for (const combo of state.combos) {
    for (const item of combo.items) {
      const key = criteriaKey(item.criteria);
      if (!map.has(key)) map.set(key, { key, criteria: item.criteria, label: criteriaLabel(item.criteria) });
    }
  }
  return [...map.values()];
}

function openEditor(combo) {
  editor = combo
    ? { id: combo.id, name: combo.name, loadTypeId: combo.loadTypeId, items: combo.items.map((i) => ({ key: criteriaKey(i.criteria), criteria: i.criteria, qty: i.qty })) }
    : { id: null, name: '', loadTypeId: state.loadTypes[0]?.id, items: [{ key: '', criteria: null, qty: 1 }] };
  renderCombos();
}

// Reads the editor form back into `editor` so re-renders keep typed values.
function syncEditor() {
  if (!editor) return;
  const form = $('combo-editor');
  editor.name = form.querySelector('[name="name"]').value.trim();
  editor.loadTypeId = form.querySelector('[name="loadType"]').value;
  const catalog = new Map(vehicleCatalog().map((c) => [c.key, c]));
  editor.items = [...form.querySelectorAll('.item-row')].map((row) => {
    const key = row.querySelector('select').value;
    const qty = Math.max(0, parseInt(row.querySelector('[name="qty"]').value, 10) || 0);
    if (key === '__manual') {
      const criteria = {};
      row.querySelectorAll('[data-field]').forEach((input) => {
        const value = input.value.trim();
        const field = input.dataset.field;
        if (field === 'make') criteria.make = value.toUpperCase();
        else if (field === 'model' || value) criteria[field] = value;
      });
      return { key, criteria, qty };
    }
    return { key, criteria: catalog.get(key)?.criteria || null, qty };
  });
}

function renderEditor() {
  const el = $('combo-editor');
  el.hidden = !editor;
  if (!editor) {
    el.innerHTML = '';
    return;
  }
  const catalog = vehicleCatalog();
  const manualFields = [
    { key: 'make', label: 'Make' }, { key: 'model', label: 'Model' },
    ...OPTIONAL_FIELDS.filter((f) => state.settings.matchFields[f.key]),
  ];
  const itemRow = (item, index) => {
    const manual = item.key === '__manual';
    return `<div class="item-row" data-index="${index}">
      <select aria-label="Vehicle">
        <option value="">Choose vehicle…</option>
        ${catalog.map((c) => `<option value="${esc(c.key)}" ${c.key === item.key ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
        <option value="__manual" ${manual ? 'selected' : ''}>Type a vehicle not in the list…</option>
      </select>
      <input type="number" name="qty" min="1" value="${esc(item.qty)}" aria-label="Quantity">
      <button type="button" class="btn icon danger" data-remove-item="${index}" aria-label="Remove item">Remove</button>
      ${manual ? `<div class="manual">${manualFields.map((f) => `<input type="text" data-field="${f.key}" placeholder="${esc(f.label)}${f.key === 'make' || f.key === 'model' ? ' (required)' : ''}" value="${esc(item.criteria?.[f.key] || '')}">`).join('')}</div>` : ''}
    </div>`;
  };
  el.innerHTML = `<form class="editor" id="combo-form">
    <h3>${editor.id ? 'Edit combination' : 'New combination'}</h3>
    <label class="field"><span>Name (optional)</span><input type="text" name="name" value="${esc(editor.name)}" placeholder="Auto: e.g. 3 × F-150 + 1 × Equinox"></label>
    <label class="field"><span>Load type</span><select name="loadType">
      ${state.loadTypes.map((t) => `<option value="${esc(t.id)}" ${t.id === editor.loadTypeId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
    </select></label>
    <div class="field"><span><strong>Vehicles in this load</strong></span>${editor.items.map(itemRow).join('')}</div>
    <div class="row">
      <button type="button" class="btn small" id="add-item">Add vehicle</button>
      <span style="flex:1"></span>
      <button type="button" class="btn small" id="cancel-combo">Cancel</button>
      <button type="submit" class="btn small primary">Save combination</button>
    </div>
  </form>`;
}

function saveEditor() {
  syncEditor();
  const items = editor.items.filter((i) => i.key !== '' || i.qty > 0);
  if (!items.length) return showStatus('Add at least one vehicle to the combination.', 'error');
  for (const item of items) {
    if (!item.criteria || !item.criteria.make || !item.criteria.model) {
      return showStatus('Each vehicle needs a make and model selected or typed in.', 'error');
    }
    if (item.qty < 1) return showStatus('Each quantity must be at least 1.', 'error');
  }
  // Merge duplicate vehicles into one line.
  const merged = new Map();
  for (const item of items) {
    const key = criteriaKey(item.criteria);
    if (merged.has(key)) merged.get(key).qty += item.qty;
    else merged.set(key, { criteria: item.criteria, qty: item.qty });
  }
  const combo = { id: editor.id || uid(), name: editor.name, loadTypeId: editor.loadTypeId, items: [...merged.values()] };
  const index = state.combos.findIndex((c) => c.id === combo.id);
  if (index >= 0) state.combos[index] = combo;
  else state.combos.push(combo);
  editor = null;
  save();
  showStatus('');
  renderCombos();
}

function renderCombos() {
  const used = new Set(state.combos.map((c) => c.loadTypeId));
  $('load-types').innerHTML = state.loadTypes.map((t) => `<div class="list-item">
    <span>${esc(t.name)} <span class="meta">${plural(state.combos.filter((c) => c.loadTypeId === t.id).length, 'combination')}</span></span>
    <div class="row">
      <button class="btn icon" data-rename-type="${esc(t.id)}">Rename</button>
      <button class="btn icon danger" data-delete-type="${esc(t.id)}" ${used.has(t.id) || state.loadTypes.length === 1 ? 'disabled title="In use or last load type"' : ''}>Delete</button>
    </div>
  </div>`).join('');

  renderEditor();

  $('combo-list').innerHTML = state.combos.length
    ? state.combos.map((c, i) => `<div class="list-item">
        <div>
          <strong>${i + 1}. ${esc(comboName(c))}</strong>
          <span class="meta"> · ${esc(loadTypeName(c.loadTypeId))} · ${plural(comboSize(c), 'vehicle')}</span>
          <ul class="combo-items">${c.items.map((it) => `<li>${it.qty} × ${esc(criteriaLabel(it.criteria))}</li>`).join('')}</ul>
        </div>
        <div class="row">
          <button class="btn icon" data-move="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">Up</button>
          <button class="btn icon" data-move="${i}" data-dir="1" ${i === state.combos.length - 1 ? 'disabled' : ''} aria-label="Move down">Down</button>
          <button class="btn icon" data-edit="${esc(c.id)}">Edit</button>
          <button class="btn icon" data-copy="${esc(c.id)}">Duplicate</button>
          <button class="btn icon danger" data-delete="${esc(c.id)}">Delete</button>
        </div>
      </div>`).join('')
    : (editor ? '' : '<p class="empty">No combinations yet. Add the vehicle mixes that fit in one load.</p>');
}

// ---------- Load plan ----------

function renderPlan() {
  const vehiclesById = new Map(state.vehicles.map((v) => [v.id, v]));
  const disableExports = (disabled) => ['print-plan', 'export-csv', 'export-xlsx'].forEach((id) => { $(id).disabled = disabled; });

  if (!state.vehicles.length || !state.combos.length) {
    lastPlan = null;
    disableExports(true);
    $('plan-summary').innerHTML = `<p class="empty">${!state.vehicles.length ? 'Add vehicles on the Vehicles tab.' : 'Add allowed combinations on the Combinations tab.'}</p>`;
    $('plan-output').innerHTML = '';
    return;
  }

  const plan = planLoads(state.vehicles, state.combos);
  lastPlan = plan;
  disableExports(false);

  const loaded = plan.loads.reduce((n, l) => n + l.vehicleIds.length, 0);
  const byType = new Map();
  for (const load of plan.loads) byType.set(load.loadTypeId, (byType.get(load.loadTypeId) || 0) + 1);
  const typeSummary = [...byType].map(([id, n]) => plural(n, loadTypeName(id))).join(', ');

  $('plan-summary').innerHTML = `<div class="stats">
      <div class="stat"><strong>${plan.loads.length}</strong><span>Loads${typeSummary ? ` (${esc(typeSummary)})` : ''}</span></div>
      <div class="stat"><strong>${loaded}</strong><span>Vehicles loaded</span></div>
      <div class="stat"><strong>${plan.unassigned.length}</strong><span>Not loaded</span></div>
    </div>
    ${plan.exhaustive ? '' : '<p class="hint" style="margin-top:10px">Large list: this is the best plan found within the search limit.</p>'}`;

  const vehicleTable = (rows) => `<div class="table-wrap"><table>
    <thead><tr><th>VIN</th><th>Year</th><th>Make</th><th>Model</th><th>Trim</th><th>Body / cab</th><th>Fuel</th>${rows[0]?.reason !== undefined ? '<th>Reason</th>' : ''}</tr></thead>
    <tbody>${rows.map(({ v, reason }) => `<tr><td class="vin">${esc(v.vin)}</td><td>${esc(v.year)}</td><td>${esc(v.make)}</td><td>${esc(v.model)}</td><td>${esc(v.trim)}</td><td>${esc(v.body)}</td><td>${esc(v.fuel)}</td>${reason !== undefined ? `<td>${esc(reason)}</td>` : ''}</tr>`).join('')}</tbody>
  </table></div>`;

  const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  $('plan-output').innerHTML = `
    <h2 class="print-title">Load plan · ${esc(date)} · ${plural(plan.loads.length, 'load')}, ${plural(loaded, 'vehicle')}</h2>
    ${plan.loads.length ? '' : '<div class="card"><p class="empty">No full loads can be made with the current vehicles and combinations.</p></div>'}
    ${plan.loads.map((load, i) => `<div class="card load-card">
      <h3><span>Load ${i + 1} · ${esc(loadTypeName(load.loadTypeId))}</span><span class="meta">${esc(comboName(state.combos.find((c) => c.id === load.comboId) || { items: [], name: load.comboName }))} · ${plural(load.vehicleIds.length, 'vehicle')}</span></h3>
      ${vehicleTable(load.vehicleIds.map((id) => ({ v: vehiclesById.get(id) })))}
    </div>`).join('')}
    ${plan.unassigned.length ? `<div class="card"><h3 style="margin-bottom:8px">Not loaded (${plan.unassigned.length})</h3>
      ${vehicleTable(plan.unassigned.map(({ id, reason }) => ({ v: vehiclesById.get(id), reason })))}</div>` : ''}`;
}

function exportRows() {
  const vehiclesById = new Map(state.vehicles.map((v) => [v.id, v]));
  const loadTypesById = new Map(state.loadTypes.map((t) => [t.id, t]));
  const plan = {
    ...lastPlan,
    loads: lastPlan.loads.map((l) => ({ ...l, comboName: comboName(state.combos.find((c) => c.id === l.comboId) || { items: [], name: l.comboName }) })),
  };
  return planRows(plan, vehiclesById, loadTypesById);
}

const fileDate = () => new Date().toISOString().slice(0, 10);

// ---------- Settings ----------

function renderSettings() {
  $('input-toggles').innerHTML = INPUT_METHODS.map((m) => `<label class="toggle">
    <input type="checkbox" data-input-method="${m.key}" ${state.settings.inputMethods[m.key] ? 'checked' : ''}> ${esc(m.label)}
  </label>`).join('');
  $('match-toggles').innerHTML = `<label class="toggle locked"><input type="checkbox" checked disabled> Make and model (always on)</label>
    ${OPTIONAL_FIELDS.map((f) => `<label class="toggle">
      <input type="checkbox" data-match-field="${f.key}" ${state.settings.matchFields[f.key] ? 'checked' : ''}> ${esc(f.label)}
    </label>`).join('')}`;
}

// ---------- Events ----------

document.querySelector('.tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]')?.dataset.tab;
  if (tab) setTab(tab);
});

$('paste-add').addEventListener('click', () => {
  const tokens = $('paste-input').value.split(/[\s,;]+/).filter(Boolean);
  if (!tokens.length) return;
  addVins(tokens);
  $('paste-input').value = '';
});

// ---------- Photo upload review ----------

let photoReview = null; // { files: [names], items: [{ vin, confidence, source }] }

function showPhotoReview() {
  const panel = $('photo-review');
  if (!photoReview?.items.length) {
    panel.hidden = true;
    return;
  }
  const { files, items } = photoReview;
  const where = files.length === 1 ? files[0] : `${files[0]} and ${plural(files.length - 1, 'other file')}`;
  $('photo-review-title').textContent = `Found ${plural(items.length, 'VIN')} in ${where}`;
  const existing = new Set(state.vehicles.map((v) => v.vin));
  $('photo-review-list').innerHTML = items.map((item, i) => `
    <li class="photo-item${item.confidence === 'low' ? ' unsure' : ''}">
      <input type="checkbox" data-index="${i}" aria-label="Add this VIN" ${existing.has(item.vin) || item.similarTo ? '' : 'checked'}>
      <div class="photo-item-main">
        <input type="text" class="photo-vin" data-index="${i}" value="${esc(item.vin)}" spellcheck="false" autocomplete="off" autocapitalize="characters" aria-label="VIN">
        <div class="photo-item-notes">
          ${item.confidence === 'low' ? '<span class="tag warn">Please check</span>' : ''}
          ${item.similarTo ? `<span class="hint">Similar to ${esc(item.similarTo)}, may be a misread</span>` : ''}
          <span class="photo-check"></span>
          <span class="photo-dup hint">Already in list</span>
        </div>
      </div>
    </li>`).join('');
  $('photo-review-list').querySelectorAll('.photo-vin').forEach(updatePhotoItem);
  panel.hidden = false;
}

function updatePhotoItem(input) {
  const row = input.closest('.photo-item');
  const { check, text, kind } = describeCheck(input.value);
  const el = row.querySelector('.photo-check');
  el.textContent = text;
  el.className = `photo-check ${kind}`.trim();
  row.querySelector('.photo-dup').hidden = !state.vehicles.some((v) => v.vin === check.vin);
}

function closePhotoReview() {
  photoReview = null;
  $('photo-review').hidden = true;
  $('photo-review-list').innerHTML = '';
}

$('photo-review-list').addEventListener('input', (e) => {
  if (!e.target.classList.contains('photo-vin')) return;
  updatePhotoItem(e.target);
  const box = e.target.closest('.photo-item').querySelector('input[type="checkbox"]');
  if (box) box.checked = Boolean(cleanVin(e.target.value));
});

$('photo-review-add').addEventListener('click', () => {
  const vins = [...$('photo-review-list').querySelectorAll('.photo-item')]
    .filter((row) => row.querySelector('input[type="checkbox"]').checked)
    .map((row) => row.querySelector('.photo-vin').value);
  closePhotoReview();
  if (vins.length) addVins(vins);
  else showStatus('No VINs selected.');
});

$('photo-review-cancel').addEventListener('click', () => {
  closePhotoReview();
  showStatus('');
});

async function handlePhoto(file) {
  const started = Date.now();
  const found = await readPhotoVins(file, { onProgress: (text) => showStatus(text) });
  if (!found.length) throw new Error(`No VINs found in ${file.name}. Try a sharper, closer photo, or crop it to the VINs.`);
  photoReview ||= { files: [], items: [] };
  photoReview.files.push(file.name);
  for (const item of found) {
    if (!photoReview.items.some((other) => other.vin === item.vin)) photoReview.items.push(item);
  }
  // Barcode and sure reads first, then ones to check.
  photoReview.items.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'high' ? -1 : 1));
  showPhotoReview();
  if (photoReview.files.length === 1) $('photo-review').scrollIntoView({ behavior: 'smooth', block: 'start' });
  console.info(`Read ${found.length} VINs from ${file.name} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

let fileQueue = Promise.resolve();

$('file-input').addEventListener('change', (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  fileQueue = fileQueue.then(async () => {
    const errors = [];
    for (const file of files) {
      if (!isImageFile(file)) {
        await handleFile(file);
        continue;
      }
      try {
        await handlePhoto(file);
      } catch (err) {
        errors.push(err.message);
      }
    }
    if (errors.length) showStatus(errors.join(' '), 'error');
    else if (photoReview && files.some(isImageFile)) showStatus('Check the VINs below, then tap Add selected.');
  });
});

$('scan-start').addEventListener('click', openScanner);
$('scanner-close').addEventListener('click', closeScanner);
$('scanner-capture').addEventListener('click', captureNow);
$('scanner-retake').addEventListener('click', retake);
$('scanner-vin').addEventListener('input', updateReviewCheck);
$('scanner-zoom').addEventListener('input', (e) => scanner?.setZoom(Number(e.target.value)).catch(() => {}));

$('scanner-torch').addEventListener('click', async (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  try {
    await scanner?.setTorch(on);
    e.currentTarget.setAttribute('aria-pressed', String(on));
  } catch {
    scannerStatus('The light could not be turned on.', 'error');
  }
});

$('scanner-review').addEventListener('submit', (e) => {
  e.preventDefault();
  const check = validateVin($('scanner-vin').value);
  if (!check.valid) {
    updateReviewCheck();
    return;
  }
  addScannedVin(check.vin, autoReviewVin ? 'VIN text' : 'capture');
  autoReviewVin = null;
  showReview(null);
  scanner?.resume();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('scanner').hidden) closeScanner();
});

$('scanner-input').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const value = e.target.value.trim();
  e.target.value = '';
  if (value) addVins([extractVins(value)[0] || value]);
});

$('vehicle-table').addEventListener('click', (e) => {
  const id = e.target.closest('[data-remove]')?.dataset.remove;
  if (!id) return;
  state.vehicles = state.vehicles.filter((v) => v.id !== id);
  save();
  renderVehicles();
});

$('retry-decode').addEventListener('click', () => {
  for (const v of state.vehicles) if (v.status === 'failed') v.status = 'pending';
  save();
  renderVehicles();
  decodePending();
});

$('clear-vehicles').addEventListener('click', () => {
  if (!confirm(`Remove all ${state.vehicles.length} vehicles?`)) return;
  state.vehicles = [];
  save();
  showStatus('');
  renderVehicles();
});

$('load-type-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('load-type-name').value.trim();
  if (!name) return;
  state.loadTypes.push({ id: uid(), name });
  $('load-type-name').value = '';
  save();
  syncEditor();
  renderCombos();
});

$('load-types').addEventListener('click', (e) => {
  const renameId = e.target.closest('[data-rename-type]')?.dataset.renameType;
  const deleteId = e.target.closest('[data-delete-type]')?.dataset.deleteType;
  syncEditor();
  if (renameId) {
    const type = state.loadTypes.find((t) => t.id === renameId);
    const name = prompt('Load type name', type.name)?.trim();
    if (name) type.name = name;
  }
  if (deleteId) state.loadTypes = state.loadTypes.filter((t) => t.id !== deleteId);
  save();
  renderCombos();
});

$('combo-new').addEventListener('click', () => openEditor(null));

$('combo-editor').addEventListener('click', (e) => {
  if (e.target.id === 'add-item') {
    syncEditor();
    editor.items.push({ key: '', criteria: null, qty: 1 });
    renderEditor();
  } else if (e.target.id === 'cancel-combo') {
    editor = null;
    showStatus('');
    renderCombos();
  } else if (e.target.dataset.removeItem !== undefined) {
    syncEditor();
    editor.items.splice(Number(e.target.dataset.removeItem), 1);
    renderEditor();
  }
});

$('combo-editor').addEventListener('change', (e) => {
  if (e.target.matches('.item-row select')) {
    syncEditor();
    renderEditor();
  }
});

$('combo-editor').addEventListener('submit', (e) => {
  e.preventDefault();
  saveEditor();
});

$('combo-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const { edit, copy, move, dir } = btn.dataset;
  if (edit) return openEditor(state.combos.find((c) => c.id === edit));
  if (copy) {
    const source = state.combos.find((c) => c.id === copy);
    state.combos.splice(state.combos.indexOf(source) + 1, 0, { ...structuredClone(source), id: uid(), name: source.name ? `${source.name} (copy)` : '' });
  }
  if (btn.dataset.delete) {
    const combo = state.combos.find((c) => c.id === btn.dataset.delete);
    if (!confirm(`Delete "${comboName(combo)}"?`)) return;
    state.combos = state.combos.filter((c) => c !== combo);
  }
  if (move !== undefined) {
    const i = Number(move);
    const j = i + Number(dir);
    [state.combos[i], state.combos[j]] = [state.combos[j], state.combos[i]];
  }
  save();
  syncEditor();
  renderCombos();
});

$('print-plan').addEventListener('click', () => window.print());
$('export-csv').addEventListener('click', () => {
  if (lastPlan) downloadBlob(toCsv(exportRows()), `load-plan-${fileDate()}.csv`, 'text/csv');
});
$('export-xlsx').addEventListener('click', async () => {
  if (!lastPlan) return;
  try {
    await downloadXlsx(exportRows(), `load-plan-${fileDate()}.xlsx`);
  } catch (err) {
    alert(`Excel export failed: ${err.message}. Try CSV instead.`);
  }
});

$('input-toggles').addEventListener('change', (e) => {
  const key = e.target.dataset.inputMethod;
  if (key) state.settings.inputMethods[key] = e.target.checked;
  save();
});

$('match-toggles').addEventListener('change', (e) => {
  const key = e.target.dataset.matchField;
  if (key) state.settings.matchFields[key] = e.target.checked;
  save();
});

$('backup').addEventListener('click', () => {
  downloadBlob(JSON.stringify(state, null, 2), `railcar-loader-backup-${fileDate()}.json`, 'application/json');
});

$('restore').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.vehicles) || !Array.isArray(data.combos) || !Array.isArray(data.loadTypes)) throw new Error('Not a Railcar Loader backup');
    if (!confirm('Replace all current data with this backup?')) return;
    const defaults = defaultState();
    state = {
      ...defaults,
      ...data,
      settings: {
        inputMethods: { ...defaults.settings.inputMethods, ...data.settings?.inputMethods },
        matchFields: { ...defaults.settings.matchFields, ...data.settings?.matchFields },
      },
      decodeCache: data.decodeCache || {},
    };
    save();
    renderSettings();
    alert('Backup restored.');
  } catch (err) {
    alert(`Could not restore: ${err.message}`);
  }
});

$('reset-all').addEventListener('click', () => {
  if (!confirm('Delete all vehicles, combinations, and settings? This cannot be undone.')) return;
  clearState();
  state = defaultState();
  editor = null;
  renderSettings();
});

render();
decodePending();
