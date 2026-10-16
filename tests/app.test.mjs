import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

// These are DOM behavior tests, not a replacement for real-browser visual QA.
test('the complete interface supports experiments, inspection, and saved replay', async (t) => {
  const { window } = parseHTML('<!doctype html><html><body><div id="app"></div></body></html>');
  const store = new Map();
  const savedGlobals = new Map();
  const install = (key, value) => {
    savedGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  };
  for (const key of [
    'window',
    'document',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLTextAreaElement',
    'HTMLSelectElement',
    'HTMLButtonElement',
  ])
    install(key, key === 'document' ? window.document : key === 'window' ? window : window[key]);
  install('localStorage', {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  });
  install('setInterval', () => 0);
  window.HTMLElement.prototype.showModal = function () {
    this.open = true;
  };
  window.HTMLElement.prototype.close = function () {
    this.open = false;
  };
  const click = (selector) => {
    const e = window.document.querySelector(selector);
    assert.ok(e, `Missing ${selector}`);
    e.dispatchEvent(new window.Event('click', { bubbles: true }));
  };
  const find = (selector) => window.document.querySelector(selector);
  const getText = (selector) => find(selector)?.textContent;
  try {
    await import('../dist/assets/app.js');
    await t.test('startup shows computed metrics and all five services', () => {
      assert.match(getText('h1'), /Break things/);
      assert.equal(window.document.querySelectorAll('[data-service]').length, 5);
      assert.equal(getText('#sim-time'), '00:12');
      assert.equal(getText('#metric-success'), '100.0');
      assert.ok(Number(getText('#metric-throughput')) > 0);
    });
    await t.test('run, pause, step, and reset controls change simulation state', () => {
      click('[data-action="run"]');
      assert.equal(getText('#run-status'), 'Running');
      click('[data-action="run"]');
      assert.equal(getText('#run-status'), 'Paused');
      click('[data-action="step"]');
      assert.equal(getText('#sim-time'), '00:13');
      click('[data-action="reset"]');
      assert.equal(getText('#sim-time'), '00:12');
    });
    await t.test('service inspection and injected latency update the correct service', () => {
      click('[data-service="catalog"]');
      assert.match(getText('#service-info'), /Catalog API/);
      click('[data-action="inject"]');
      assert.equal(getText('#node-status-catalog'), 'latency');
      assert.equal(getText('#run-status'), 'Running');
      click('[data-action="recover"]');
      assert.equal(getText('#node-status-catalog'), 'Healthy');
    });
    await t.test('request explorer filters and opens real request details', () => {
      click('[data-page="traces"]');
      assert.ok(window.document.querySelectorAll('[data-trace]').length > 0);
      const search = find('#trace-search');
      search.value = 'not-a-request';
      search.dispatchEvent(new window.Event('input'));
      assert.match(getText('#trace-rows'), /No matching/);
      search.value = '';
      search.dispatchEvent(new window.Event('input'));
      click('[data-trace]');
      assert.equal(find('#dialog').open, true);
      assert.match(getText('#dialog-content'), /Visited route/);
      click('[data-action="close"]');
      assert.equal(find('#dialog').open, false);
    });
    await t.test('guided outage presets apply their configured failure', () => {
      click('[data-page="experiments"]');
      assert.equal(window.document.querySelectorAll('.scenario-card').length, 4);
      click('[data-preset="breaker"]');
      assert.equal(getText('#node-status-database'), 'outage');
      assert.match(getText('.experiment-title'), /breather/);
    });
    await t.test('comparisons compute three strategies', async () => {
      click('[data-page="experiments"]');
      click('[data-action="benchmark"]');
      await new Promise((resolve) => setTimeout(resolve, 120));
      assert.equal(window.document.querySelectorAll('.comparison-table tbody tr').length, 3);
      assert.match(getText('#benchmark-results'), /Retries \+ breaker/);
    });
    await t.test('a saved session replays to the same metrics', () => {
      click('[data-page="playground"]');
      click('[data-action="step"]');
      const metrics = getText('#metric-success');
      click('[data-page="saved"]');
      click('[data-action="save"]');
      find('#session-name').value = 'My reproducible experiment';
      find('#save-form').dispatchEvent(
        new window.Event('submit', { bubbles: true, cancelable: true }),
      );
      assert.match(getText('main'), /My reproducible experiment/);
      assert.equal(JSON.parse(store.get('tracelab-sessions-v1')).length, 1);
      click('[data-load]');
      assert.equal(getText('#sim-time'), '00:13');
      assert.equal(getText('#metric-success'), metrics);
    });
    await t.test('delete requires the explicit confirmation button', () => {
      click('[data-page="saved"]');
      click('[data-delete]');
      assert.equal(JSON.parse(store.get('tracelab-sessions-v1')).length, 1);
      click('#confirm-delete');
      assert.equal(JSON.parse(store.get('tracelab-sessions-v1')).length, 0);
      assert.match(getText('main'), /Keep your first discovery/);
    });
    await t.test('help and architecture explain actual implementation', () => {
      click('[data-action="help"]');
      assert.match(getText('#dialog-content'), /Start the traffic/);
      click('[data-action="close"]');
      click('[data-action="architecture"]');
      assert.match(getText('#dialog-content'), /min-heap/);
      click('[data-action="close"]');
    });
  } finally {
    for (const [key, descriptor] of savedGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
