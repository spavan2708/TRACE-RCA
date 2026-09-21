// Optional: install Playwright separately, or set PLAYWRIGHT_MODULE to its ESM
// entry point. Set CHROME_PATH for system Chrome, TRACE_RCA_TEST_URL for the
// server, and TRACE_RCA_SCREENSHOTS for a temporary screenshot directory.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRESETS } from '../frontend/telemetry.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.TRACE_RCA_TEST_URL || 'http://127.0.0.1:8000';
const screenshots = process.env.TRACE_RCA_SCREENSHOTS || join(tmpdir(), 'trace-rca-screenshots');
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const checks = [];
const errors = [];
const check = name => { checks.push(name); console.log(`PASS ${name}`); };

async function visible(page, selector) {
  await page.locator(selector).waitFor({ state: 'visible' });
}
async function noOverflow(page) {
  const overflowing = await page.evaluate(() => {
    const width = innerWidth;
    return [...document.querySelectorAll('main *, .topbar *')].filter(node => {
      const bounds = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return bounds.width > 0 && style.position !== 'absolute' && (bounds.right > width + 1 || bounds.left < -1);
    }).map(node => `${node.tagName}.${node.className}`);
  });
  assert.deepEqual(overflowing, []);
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const requests = [];
  page.on('request', request => { if (request.url().endsWith('/predict')) requests.push(request.postDataJSON()); });
  await page.goto(url);
  await page.getByText('API connected', { exact: true }).waitFor();
  assert.equal(await page.locator('input[type="number"]').count(), 10);
  assert.equal(await page.locator('#history-count').textContent(), '0');
  assert.equal(await page.locator('#result-empty').isVisible(), true);
  await noOverflow(page);
  await page.screenshot({ path: join(screenshots, 'desktop-empty.png'), fullPage: true });
  check('initial desktop, real model status, ten inputs, honest empty state');

  const canvasPixels = await page.locator('#signal-canvas').evaluate(canvas => [...canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data].filter((value, index) => index % 4 === 3 && value > 0).length);
  assert.ok(canvasPixels > 100);
  check('classifier schematic renders nonblank');

  await page.locator('#cpu_usage').fill('');
  await page.getByRole('button', { name: 'Run RCA Analysis' }).click();
  await visible(page, '#form-error');
  assert.equal(requests.length, 0);
  assert.equal(await page.locator('#cpu_usage').getAttribute('aria-invalid'), 'true');
  await page.locator('#cpu_usage').fill('101');
  await page.getByRole('button', { name: 'Run RCA Analysis' }).click();
  assert.equal(requests.length, 0);
  await page.getByRole('button', { name: 'Reset telemetry', exact: true }).click();
  check('blank and invalid values block requests; reset restores sample');

  for (const [name, telemetry] of Object.entries(PRESETS)) {
    await page.locator('#preset').selectOption(name);
    await page.getByRole('button', { name: 'Load sample', exact: true }).click();
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/predict'));
    await page.getByRole('button', { name: 'Run RCA Analysis' }).click();
    const response = await responsePromise;
    assert.equal(response.status(), 200);
    const actual = await response.json();
    await page.getByText('Analysis complete', { exact: true }).waitFor();
    assert.deepEqual(requests.at(-1), telemetry);
    assert.equal(await page.locator('#root-cause').textContent(), actual.root_cause);
    assert.equal(await page.locator('.probability-row').count(), 5);
    console.log(`  ${name}: ${actual.root_cause} (${(actual.confidence * 100).toFixed(4)}%)`);
  }
  assert.equal(await page.locator('#history-count').textContent(), '5');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('#toast').waitFor({ state: 'hidden' });
  await page.screenshot({ path: join(screenshots, 'desktop-result.png'), fullPage: true });
  check('all five presets use exact raw payloads and real model predictions');

  await page.locator('#cpu_usage').fill('61');
  await visible(page, '#stale-note');
  await page.locator('#history-rows .history-actions button[title="Reload this telemetry"]').first().click();
  assert.equal(await page.locator('#cpu_usage').inputValue(), String(PRESETS.database.cpu_usage));
  assert.equal(await page.locator('#stale-note').isVisible(), false);
  await page.locator('#history-rows .history-actions .button').first().click();
  assert.equal(await page.locator('#result-status').textContent(), 'Saved analysis');
  check('saved snapshot reload and stale result distinction');

  await page.getByRole('button', { name: 'Copy analysis JSON', exact: true }).click();
  const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  assert.deepEqual(copied.telemetry, PRESETS.database);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export analysis JSON', exact: true }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.deepEqual(exported, copied);
  await page.locator('.request-inspector summary').click();
  await page.getByRole('button', { name: 'Copy request JSON', exact: true }).click();
  assert.deepEqual(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())), PRESETS.database);
  check('request inspector, clipboard and lossless JSON export');

  await page.reload();
  await page.getByText('API connected', { exact: true }).waitFor();
  assert.equal(await page.locator('#history-count').textContent(), '5');
  check('localStorage history persists after reload');

  let releaseRequest;
  const gate = new Promise(resolve => { releaseRequest = resolve; });
  await page.route('**/predict', async route => { await gate; await route.continue(); });
  const beforeBusy = requests.length;
  await page.getByRole('button', { name: 'Run RCA Analysis' }).click();
  assert.equal(await page.locator('#analyze').isDisabled(), true);
  assert.equal(await page.locator('#cpu_usage').isDisabled(), true);
  await page.keyboard.press('Control+Enter');
  assert.equal(requests.length, beforeBusy + 1);
  releaseRequest();
  await page.getByText('Analysis complete', { exact: true }).waitFor();
  await page.unroute('**/predict');
  check('pending request disables mutation and duplicate submissions');

  const countBeforeErrors = await page.locator('#history-count').textContent();
  const failures = [
    [422, { detail: 'invalid' }, 'rejected'],
    [503, { detail: 'unavailable' }, 'unavailable'],
    [500, {}, 'HTTP 500'],
    [200, { root_cause: 'Service Crash', confidence: 'bogus', probabilities: {} }, 'unexpected'],
  ];
  for (const [status, body, expected] of failures) {
    await page.route('**/predict', route => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }));
    await page.getByRole('button', { name: 'Run RCA Analysis' }).click();
    await visible(page, '#form-error');
    assert.ok((await page.locator('#form-error').textContent()).includes(expected));
    assert.equal(await page.locator('#history-count').textContent(), countBeforeErrors);
    assert.equal(await page.locator('#analyze').isEnabled(), true);
    await page.unroute('**/predict');
  }
  await page.route('**/predict', route => route.abort());
  await page.getByRole('button', { name: 'Run RCA Analysis' }).click();
  await visible(page, '#form-error');
  assert.ok((await page.locator('#form-error').textContent()).includes('Could not reach'));
  await page.unroute('**/predict');
  check('422, unavailable model, server failure, malformed result, network failure');

  for (const width of [1920, 1440, 1280, 1024, 820, 768, 640, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Reset telemetry', exact: true }).click();
  await page.getByRole('button', { name: 'Run RCA Analysis' }).click();
  await page.getByText('Analysis complete', { exact: true }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(screenshots, 'mobile-result.png'), fullPage: true });
  assert.equal(await page.locator('#sidebar').evaluate(node => node.inert), true);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  assert.equal(await page.locator('#sidebar').getAttribute('aria-modal'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'), 'false');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.locator('[data-nav="model"]').click();
  assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#model').evaluate(node => node === document.activeElement), true);
  check('nine viewport widths without overflow; mobile navigation and keyboard focus');

  await page.getByRole('button', { name: 'Clear history', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.ok(Number(await page.locator('#history-count').textContent()) > 0);
  const secondPage = await context.newPage();
  await secondPage.goto(url);
  await secondPage.getByText('API connected', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Clear history', exact: true }).click();
  await page.locator('#confirm-clear').click();
  await page.locator('#history-empty').waitFor({ state: 'visible' });
  await secondPage.locator('#history-empty').waitFor({ state: 'visible' });
  await page.reload();
  await page.getByText('API connected', { exact: true }).waitFor();
  assert.equal(await page.locator('#history-count').textContent(), '0');
  check('clear confirmation, cancellation, persistence and cross-tab synchronization');

  if (process.env.AXE_PATH) {
    await page.addScriptTag({ path: process.env.AXE_PATH });
    const audit = await page.evaluate(async () => await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] }));
    const violations = audit.violations.map(item => ({ id: item.id, impact: item.impact, targets: item.nodes.map(node => node.target) }));
    assert.deepEqual(violations, []);
    check('WCAG A/AA automated accessibility audit');
  }
  const blockedContext = await browser.newContext();
  await blockedContext.addInitScript(() => {
    Object.defineProperty(Storage.prototype, 'getItem', { value() { throw new Error('Blocked'); } });
    Object.defineProperty(Storage.prototype, 'setItem', { value() { throw new Error('Blocked'); } });
  });
  const blockedPage = await blockedContext.newPage();
  blockedPage.on('pageerror', error => errors.push(error.message));
  await blockedPage.goto(url);
  await blockedPage.getByText('API connected', { exact: true }).waitFor();
  await blockedPage.getByRole('button', { name: 'Run RCA Analysis' }).click();
  await blockedPage.getByText('Analysis complete', { exact: true }).waitFor();
  assert.equal(await blockedPage.locator('#history-count').textContent(), '1');
  await visible(blockedPage, '#storage-note');
  check('storage unavailable degrades to in-memory history');
  assert.deepEqual(errors, []);
  check('no uncaught browser JavaScript errors');
  console.log(`${checks.length} browser checks passed. Screenshots: ${screenshots}`);
} finally {
  await browser.close();
}
