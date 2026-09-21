import { icons } from './assets/icons.js';
import { FEATURES, CLASSES, DEFAULT_SAMPLE, PRESETS, SIGNAL_RULES, GUIDANCE, validateValue, validPrediction, validRecord } from './telemetry.js';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'trace-rca.history.v1';
const HISTORY_LIMIT = 30;
let history = [];
let currentRecord = null;
let busy = false;
let statusBusy = false;
let toastTimer;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of icons[name] || []) {
    const child = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, value] of Object.entries(attrs)) child.setAttribute(key, value);
    svg.append(child);
  }
  return svg;
}

document.querySelectorAll('[data-icon]').forEach(node => node.replaceWith(icon(node.dataset.icon)));

function buildInputs() {
  const groups = [
    ['compute', 'COMPUTE', 'cpu'],
    ['network', 'NETWORK & THROUGHPUT', 'network'],
    ['runtime', 'RELIABILITY & DATABASE', 'database'],
  ];
  for (const [key, label, glyph] of groups) {
    const group = element('div', 'metric-group');
    const heading = element('h4', 'group-label');
    heading.append(icon(glyph), document.createTextNode(label));
    const grid = element('div', `metric-grid ${key === 'runtime' ? 'runtime-grid' : ''}`);
    for (const feature of FEATURES.filter(item => item.group === key)) {
      const metric = element('div', 'metric');
      metric.id = `metric-${feature.key}`;
      const fieldLabel = element('label', '', feature.label);
      fieldLabel.htmlFor = feature.key;
      const wrap = element('div', 'input-wrap');
      const input = element('input');
      Object.assign(input, { type: 'number', id: feature.key, name: feature.key, required: true, step: feature.integer ? '1' : 'any', min: String(feature.min), inputMode: feature.integer ? 'numeric' : 'decimal' });
      if (feature.max !== undefined) input.max = String(feature.max);
      input.setAttribute('aria-describedby', `range-${feature.key} error-${feature.key}`);
      input.title = `Synthetic training range: ${feature.range.join(' to ')} ${feature.unit}`;
      const unit = element('span', 'unit', feature.unit);
      unit.setAttribute('aria-hidden', 'true');
      wrap.append(input, unit);
      const scale = element('div', 'metric-scale');
      scale.setAttribute('aria-hidden', 'true');
      scale.append(element('span'));
      const range = element('span', 'sr-only', `${feature.unit}. Synthetic training range: ${feature.range.join(' to ')}.`);
      range.id = `range-${feature.key}`;
      const error = element('p', 'metric-error');
      error.id = `error-${feature.key}`;
      error.hidden = true;
      const warning = element('p', 'range-warning', 'Outside training range');
      warning.hidden = true;
      metric.append(fieldLabel, wrap, scale, range, error, warning);
      input.addEventListener('input', () => {
        refreshInputs(false);
        setInputState('Manual snapshot');
        $('form-error').hidden = true;
      });
      input.addEventListener('blur', () => refreshInputs(true, feature.key));
      grid.append(metric);
    }
    group.append(heading, grid);
    $('metric-groups').append(group);
  }
}

function payload() {
  return Object.fromEntries(FEATURES.map(feature => [feature.key, $(feature.key).value === '' ? null : Number($(feature.key).value)]));
}

function refreshInputs(showErrors = false, onlyKey = null) {
  let valid = 0;
  for (const feature of FEATURES) {
    const input = $(feature.key);
    const issue = validateValue(feature, input.value);
    const metric = $(`metric-${feature.key}`);
    const value = Number(input.value);
    if (!issue) valid++;
    if (showErrors && (!onlyKey || onlyKey === feature.key) || input.getAttribute('aria-invalid') === 'true') {
      input.setAttribute('aria-invalid', String(Boolean(issue)));
      metric.classList.toggle('invalid', Boolean(issue));
      const error = $(`error-${feature.key}`);
      error.textContent = issue;
      error.hidden = !issue;
    }
    metric.querySelector('.metric-scale span').style.width = `${issue ? 0 : Math.min(100, value / feature.range[1] * 100)}%`;
    const elevated = SIGNAL_RULES.some(rule => rule.key === feature.key && value >= rule.threshold);
    metric.classList.toggle('elevated', !issue && elevated);
    metric.querySelector('.range-warning').hidden = Boolean(issue) || value >= feature.range[0] && value <= feature.range[1];
  }
  $('signal-count').textContent = `${valid} / 10 signals`;
  $('request-json').textContent = JSON.stringify(payload(), null, 2);
  $('copy-payload').disabled = valid !== FEATURES.length;
  $('stale-note').hidden = !currentRecord || FEATURES.every(feature => payload()[feature.key] === currentRecord.telemetry[feature.key]);
  return valid === FEATURES.length;
}

function setInputState(text) {
  $('input-state').replaceChildren(element('span', 'status-dot'), document.createTextNode(text));
}

function populate(values, state) {
  for (const feature of FEATURES) {
    const input = $(feature.key);
    input.value = values[feature.key];
    input.removeAttribute('aria-invalid');
    $(`metric-${feature.key}`).classList.remove('invalid');
    $(`error-${feature.key}`).hidden = true;
  }
  $('form-error').hidden = true;
  refreshInputs();
  setInputState(state);
}

function showError(message) {
  $('form-error').textContent = message;
  $('form-error').hidden = false;
}

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
}

function renderProbabilities(result = null) {
  const entries = result ? Object.entries(result.probabilities).sort((a, b) => b[1] - a[1]) : CLASSES.map(name => [name, null]);
  $('probabilities').replaceChildren();
  for (const [name, value] of entries) {
    const row = element('div', `probability-row${result ? ' has-result' : ''}`);
    const label = element('div', 'probability-label');
    const percent = value === null ? '--' : `${(value * 100).toFixed(2)}%`;
    const number = element('span', 'probability-value', percent);
    if (value !== null) number.title = `Exact probability: ${value}`;
    label.append(element('span', '', name), number);
    const track = element('div', 'probability-track');
    track.setAttribute('aria-hidden', 'true');
    const fill = element('div', 'probability-fill');
    fill.style.setProperty('--probability', `${value === null ? 0 : value * 100}%`);
    track.append(fill);
    row.append(label, track);
    $('probabilities').append(row);
  }
}

function renderFollowup(record) {
  $('analysis-followup').hidden = false;
  $('observed-signals').replaceChildren();
  const observations = SIGNAL_RULES.filter(rule => record.telemetry[rule.key] >= rule.threshold);
  for (const rule of observations) {
    const feature = FEATURES.find(item => item.key === rule.key);
    const row = element('div', 'signal-observation');
    const label = element('span', '', rule.label);
    label.append(element('small', '', `UI threshold: >= ${rule.threshold} ${feature.unit}`));
    row.append(label, element('strong', '', `${record.telemetry[rule.key]} ${feature.unit}`));
    $('observed-signals').append(row);
  }
  if (!observations.length) $('observed-signals').append(element('p', 'small-note', 'No configured thresholds crossed. This does not establish that the system is healthy.'));
  $('investigation-steps').replaceChildren(...GUIDANCE[record.result.root_cause].map(step => element('li', '', step)));
}

function renderResult(record, historical = false) {
  currentRecord = record;
  $('result-empty').hidden = true;
  $('result-content').hidden = false;
  $('root-cause').textContent = record.result.root_cause;
  $('confidence').textContent = `${(record.result.confidence * 100).toFixed(2)}%`;
  $('confidence').title = `Exact probability: ${record.result.confidence}`;
  $('confidence-fill').style.width = `${record.result.confidence * 100}%`;
  $('result-status').textContent = historical ? 'Saved analysis' : 'Analysis complete';
  $('result-status').className = 'badge success';
  $('result-timing').textContent = `${historical ? 'Saved' : 'Response'} / ${Math.round(record.duration_ms)} ms / ${new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  $('result-timing').title = 'Elapsed browser request time, including network and model loading.';
  $('copy-result').disabled = false;
  $('export-result').disabled = false;
  renderProbabilities(record.result);
  renderFollowup(record);
  refreshInputs();
  $('analysis-announcement').textContent = `${historical ? 'Saved analysis.' : 'Analysis complete.'} Likely root cause: ${record.result.root_cause}. Model confidence ${(record.result.confidence * 100).toFixed(2)} percent.`;
}

function setBusy(value) {
  busy = value;
  $('telemetry-controls').disabled = value;
  $('diagnosis').setAttribute('aria-busy', String(value));
  $('analyze-label').textContent = value ? 'Analyzing...' : 'Run RCA Analysis';
  if (value) {
    $('result-status').textContent = 'Request in progress';
    $('result-status').className = 'badge';
    $('analysis-announcement').textContent = 'Telemetry submitted. Waiting for the classifier.';
  }
  document.querySelectorAll('[data-history-action]').forEach(button => { button.disabled = value; });
}

async function analyze(event) {
  event.preventDefault();
  if (busy) return;
  if (!refreshInputs(true)) {
    showError('Check the highlighted telemetry values before running analysis.');
    document.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }
  const telemetry = payload();
  $('form-error').hidden = true;
  setBusy(true);
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch('/predict', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(telemetry), signal: controller.signal });
    if (!response.ok) {
      if (response.status === 422) throw new Error('The API rejected these values. Check the numerical values and their ranges.');
      if (response.status === 503) throw new Error('The model is unavailable. Check the running server and saved model artifacts, then retry.');
      throw new Error(`Analysis could not be completed (HTTP ${response.status}). Please retry.`);
    }
    let result;
    try { result = await response.json(); } catch { throw new Error('The API returned an unreadable response. Please retry.'); }
    if (!validPrediction(result)) throw new Error('The API returned an unexpected prediction. No result was saved.');
    const record = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), duration_ms: performance.now() - started, telemetry, result };
    renderResult(record);
    history = [record, ...history].slice(0, HISTORY_LIMIT);
    persistHistory();
    renderHistory();
    setConnection(true);
    if (matchMedia('(max-width: 980px)').matches) $('diagnosis').scrollIntoView({ behavior: reducedMotion() ? 'instant' : 'smooth', block: 'start' });
  } catch (error) {
    const message = error.name === 'AbortError' ? 'The request timed out after 30 seconds. Check the server connection and retry.' : error instanceof TypeError ? 'Could not reach the API. Check that the local server is running, then retry.' : error.message;
    showError(message);
    $('result-status').textContent = currentRecord ? 'Previous result' : 'Analysis failed';
    $('result-status').className = 'badge warning';
    $('analysis-announcement').textContent = message;
    void refreshStatus();
  } finally {
    clearTimeout(timer);
    setBusy(false);
  }
}

function storageNotice(message) {
  $('storage-note').hidden = false;
  $('storage-note').textContent = message;
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { history = []; return; }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Invalid history');
    history = parsed.filter(validRecord).slice(0, HISTORY_LIMIT);
    if (history.length !== Math.min(parsed.length, HISTORY_LIMIT)) storageNotice('Some saved analyses could not be read and were omitted.');
  } catch {
    history = [];
    storageNotice('Saved history could not be read. New analyses remain available in this session.');
  }
}

function persistHistory() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    $('storage-note').hidden = true;
  } catch {
    storageNotice('Browser storage is unavailable or full. History is retained only until this page closes.');
  }
}

function renderHistory() {
  $('history-count').textContent = history.length;
  $('history-empty').hidden = history.length > 0;
  $('history-table').hidden = history.length === 0;
  $('clear-history').disabled = history.length === 0;
  $('history-rows').replaceChildren();
  if (history.length) {
    const latest = new Date(history[0].timestamp);
    $('last-analysis').replaceChildren(document.createTextNode(latest.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), element('small', '', latest.toLocaleDateString([], { month: 'short', day: 'numeric' })));
  } else {
    $('last-analysis').replaceChildren(document.createTextNode('No saved runs'), element('small', '', 'in this browser'));
  }
  for (const record of history) {
    const row = element('div', 'history-row');
    const date = new Date(record.timestamp);
    const time = element('time', '', date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
    time.dateTime = record.timestamp;
    const actions = element('div', 'history-actions');
    const view = element('button', 'button secondary', 'View');
    view.type = 'button';
    view.dataset.historyAction = 'view';
    view.setAttribute('aria-label', `View ${record.result.root_cause} analysis from ${date.toLocaleString()}`);
    view.addEventListener('click', () => {
      if (busy) return;
      renderResult(record, true);
      $('diagnosis').scrollIntoView({ behavior: reducedMotion() ? 'instant' : 'smooth', block: 'start' });
    });
    const reload = element('button', 'icon-button bordered');
    reload.type = 'button';
    reload.dataset.historyAction = 'reload';
    reload.title = 'Reload this telemetry';
    reload.setAttribute('aria-label', `Reload telemetry from ${date.toLocaleString()}`);
    reload.append(icon('rotate-ccw'));
    reload.addEventListener('click', () => {
      if (busy) return;
      populate(record.telemetry, 'Saved snapshot loaded');
      $('telemetry').scrollIntoView({ behavior: reducedMotion() ? 'instant' : 'smooth', block: 'start' });
      toast('Saved telemetry loaded.');
    });
    actions.append(view, reload);
    row.append(time, element('span', '', record.result.root_cause), element('span', 'history-confidence', `${(record.result.confidence * 100).toFixed(2)}%`), actions);
    $('history-rows').append(row);
  }
}

function setConnection(ready, apiReachable = ready) {
  document.querySelectorAll('[data-status-dot]').forEach(node => { node.className = `status-dot${ready ? '' : ' offline'}`; });
  document.querySelectorAll('[data-model-status]').forEach(node => { node.textContent = ready ? 'Model ready' : 'Model unavailable'; });
  $('api-status').textContent = ready ? 'API connected' : apiReachable ? 'Model unavailable' : 'API unavailable';
}

async function refreshStatus() {
  if (statusBusy) return;
  statusBusy = true;
  $('refresh-status').disabled = true;
  let reachable = false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('/api/model', { signal: controller.signal, cache: 'no-store' });
    reachable = true;
    if (!response.ok) throw new Error('Model unavailable');
    const info = await response.json();
    if (info.status !== 'ready' || !Array.isArray(info.classes) || !CLASSES.every(name => info.classes.includes(name)) || !Array.isArray(info.layers)) throw new Error('Unexpected metadata');
    setConnection(true);
    $('parameter-count').textContent = Number.isFinite(info.parameters) ? info.parameters.toLocaleString() : 'Unavailable';
    $('test-accuracy').textContent = Number.isFinite(info.evaluation?.['Test Accuracy']) ? `${(info.evaluation['Test Accuracy'] * 100).toFixed(1)}%` : 'Unavailable';
    $('macro-f1').textContent = Number.isFinite(info.evaluation?.['Macro F1-score']) ? info.evaluation['Macro F1-score'].toFixed(4) : 'Unavailable';
    $('layer-description').textContent = info.layers.join(' / ');
  } catch {
    setConnection(false, reachable);
    for (const id of ['parameter-count', 'test-accuracy', 'macro-f1']) $(id).textContent = 'Unavailable';
  } finally {
    clearTimeout(timer);
    statusBusy = false;
    $('refresh-status').disabled = false;
  }
}

async function copyJSON(value, message) {
  try {
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
    toast(message);
  } catch {
    toast('Clipboard access is unavailable. Use the JSON inspector or export.');
  }
}

const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
function reducedMotion() { return motionQuery.matches; }

// Schematic animation of the actual 10-input / 5-output classifier. It is not
// a live telemetry stream; positions are layout coordinates, not measured data.
function startSignalGraphic() {
  const canvas = $('signal-canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  let width = 0;
  let height = 117;
  let frame = null;
  function draw(time = 0) {
    ctx.clearRect(0, 0, width, height);
    const left = 16, center = width * .54, right = width - 16, middle = height / 2;
    ctx.strokeStyle = '#26382d';
    ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      const y = 14 + i * 10;
      ctx.beginPath(); ctx.moveTo(left + 5, y); ctx.bezierCurveTo(center * .66, y, center * .66, middle, center - 20, middle); ctx.stroke();
      ctx.fillStyle = i % 3 === 0 ? '#70ae89' : '#395443';
      ctx.fillRect(left, y - 2, 4, 4);
      if (!reducedMotion()) {
        const t = ((time / 4200 + i / 10) % 1);
        const x = (1 - t) ** 3 * (left + 5) + 3 * (1 - t) ** 2 * t * center * .66 + 3 * (1 - t) * t ** 2 * center * .66 + t ** 3 * (center - 20);
        const py = (1 - t) ** 3 * y + 3 * (1 - t) ** 2 * t * y + 3 * (1 - t) * t ** 2 * middle + t ** 3 * middle;
        ctx.fillStyle = '#7acb98'; ctx.fillRect(x - 1, py - 1, 2, 2);
      }
    }
    for (let i = 0; i < 5; i++) {
      const y = 20 + i * 19;
      ctx.strokeStyle = i === 2 ? '#527b60' : '#293f31';
      ctx.beginPath(); ctx.moveTo(center + 20, middle); ctx.bezierCurveTo(center + 60, middle, right - 40, y, right - 5, y); ctx.stroke();
      ctx.fillStyle = i === 2 ? '#73c794' : '#40604b'; ctx.fillRect(right - 4, y - 3, 6, 6);
    }
    ctx.fillStyle = '#1b2b20'; ctx.fillRect(center - 19, middle - 19, 38, 38);
    ctx.strokeStyle = '#527e60'; ctx.strokeRect(center - 19, middle - 19, 38, 38);
    ctx.strokeStyle = '#79c899'; ctx.strokeRect(center - 10, middle - 10, 20, 20);
    for (let i = -1; i <= 1; i++) { ctx.fillStyle = '#75b88f'; ctx.fillRect(center - 1, middle + i * 5 - 1, 2, 2); }
    if (!reducedMotion() && !document.hidden && width > 0) frame = requestAnimationFrame(draw);
  }
  function restart() {
    if (frame !== null) cancelAnimationFrame(frame);
    const box = canvas.getBoundingClientRect();
    width = box.width;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  }
  new ResizeObserver(restart).observe(canvas);
  motionQuery.addEventListener('change', restart);
  document.addEventListener('visibilitychange', restart);
}

const mobileQuery = matchMedia('(max-width: 720px)');
function closeMenu(restoreFocus = false) {
  $('sidebar').classList.remove('open');
  $('sidebar').inert = mobileQuery.matches;
  $('sidebar').removeAttribute('role');
  $('sidebar').removeAttribute('aria-modal');
  document.querySelector('.app-shell').inert = false;
  document.body.style.overflow = '';
  $('menu-toggle').setAttribute('aria-expanded', 'false');
  $('nav-overlay').hidden = true;
  if (restoreFocus) $('menu-toggle').focus();
}

$('menu-toggle').addEventListener('click', () => {
  const open = !$('sidebar').classList.contains('open');
  if (!open) { closeMenu(true); return; }
  $('sidebar').classList.toggle('open', open);
  $('sidebar').inert = false;
  $('sidebar').setAttribute('role', 'dialog');
  $('sidebar').setAttribute('aria-modal', 'true');
  document.querySelector('.app-shell').inert = true;
  document.body.style.overflow = 'hidden';
  $('menu-toggle').setAttribute('aria-expanded', String(open));
  $('nav-overlay').hidden = !open;
  $('sidebar').querySelector('a').focus();
});
$('nav-overlay').addEventListener('click', () => closeMenu(true));
mobileQuery.addEventListener('change', () => closeMenu());
closeMenu();
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('sidebar').classList.contains('open')) closeMenu(true);
  if (event.key === 'Tab' && $('sidebar').classList.contains('open')) {
    const links = [...$('sidebar').querySelectorAll('a')];
    const first = links[0], last = links.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !$('clear-dialog').open) { event.preventDefault(); $('telemetry-form').requestSubmit(); }
});
document.querySelectorAll('[data-nav]').forEach(link => link.addEventListener('click', () => {
  document.querySelectorAll('[data-nav]').forEach(item => { item.classList.remove('active'); item.removeAttribute('aria-current'); });
  link.classList.add('active');
  link.setAttribute('aria-current', 'location');
  closeMenu();
  const target = $(link.dataset.nav);
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}));
$('sidebar').querySelector('.brand').addEventListener('click', () => closeMenu());
$('telemetry-form').addEventListener('submit', analyze);
$('load-sample').addEventListener('click', () => { populate(PRESETS[$('preset').value], 'Sample loaded'); toast('Demo telemetry loaded.'); });
$('reset').addEventListener('click', () => { $('preset').value = 'crash'; populate(DEFAULT_SAMPLE, 'Sample reset'); });
$('refresh-status').addEventListener('click', refreshStatus);
$('copy-payload').addEventListener('click', () => { if (refreshInputs(true)) void copyJSON(payload(), 'Request JSON copied.'); });
$('copy-result').addEventListener('click', () => { if (currentRecord) void copyJSON(currentRecord, 'Analysis JSON copied.'); });
$('export-result').addEventListener('click', () => {
  if (!currentRecord) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(currentRecord, null, 2)], { type: 'application/json' }));
  const link = element('a');
  link.href = url;
  link.download = `trace-rca-${currentRecord.timestamp.replace(/[:.]/g, '-')}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('clear-history').addEventListener('click', () => $('clear-dialog').showModal());
$('cancel-clear').addEventListener('click', () => $('clear-dialog').close());
$('confirm-clear').addEventListener('click', () => {
  history = [];
  try { localStorage.removeItem(STORAGE_KEY); $('storage-note').hidden = true; }
  catch { storageNotice('History was cleared for this session, but browser storage could not be updated.'); }
  renderHistory();
  $('clear-dialog').close();
  toast('Local history cleared.');
});
window.addEventListener('storage', event => { if (event.key === STORAGE_KEY || event.key === null) { loadHistory(); renderHistory(); } });
window.addEventListener('focus', () => { void refreshStatus(); });
setInterval(() => { if (!document.hidden) void refreshStatus(); }, 60000);

buildInputs();
populate(DEFAULT_SAMPLE, 'Sample loaded');
renderProbabilities();
loadHistory();
renderHistory();
startSignalGraphic();
void refreshStatus();
