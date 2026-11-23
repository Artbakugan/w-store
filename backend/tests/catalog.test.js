const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { createDegradedMode, createResilientClient } = require('../../frontend/resilience');

const catalog = readFileSync(join(__dirname, '../../frontend/index.html'), 'utf8');
const catalogScript = catalog.match(/<script>([\s\S]*?)<\/script>/)[1];

function makeElement() {
  return {
    disabled: false,
    textContent: '',
    style: {},
    addEventListener(event, listener) { this[event] = listener; },
  };
}

test('the catalog shows the overload banner, disables all action buttons and restores them', async () => {
  const buttons = ['loadBtn', 'createBtn', 'doubleBtn'];
  const elements = Object.fromEntries(
    [...buttons, 'degradedBanner', 'itemsList', 'log'].map((name) => [name, makeElement()])
  );
  const { loadBtn, degradedBanner, log } = elements;
  const cooldowns = [];
  const attempts = [];
  let status = 503;

  runInNewContext(catalogScript, {
    document: {
      getElementById: (id) => elements[id],
      createElement: () => ({ append() {} }),
    },
    location: { protocol: 'http:', search: '' },
    Headers,
    URLSearchParams,
    createDegradedMode: (onChange) => createDegradedMode(onChange, (callback, delay) => {
      cooldowns.push({ callback, delay });
    }),
    createResilientClient: (options) => createResilientClient({
      ...options,
      fetchRequest: async (url) => {
        attempts.push(url);
        return new Response(status === 200 ? '[]' : null, { status });
      },
      sleep: async () => {},
      newRequestId: () => `catalog-${attempts.length + 1}`,
    }),
  });
  elements.itemsList.replaceChildren = () => {};

  for (let count = 1; count <= 2; count++) {
    await loadBtn.click();
    assert.equal(attempts.length, count * 3);
    assert.equal(cooldowns.length, 0);
    assert.ok(buttons.every((id) => !elements[id].disabled));
  }

  await loadBtn.click();
  assert.equal(attempts.length, 9);
  assert.ok(attempts.every((path) => path === '/items'));
  assert.equal(degradedBanner.style.display, 'block');
  assert.ok(buttons.every((id) => elements[id].disabled));
  assert.equal(cooldowns.length, 1);
  assert.equal(cooldowns[0].delay, 5000);
  assert.match(log.textContent, /Повтор №2/);

  await loadBtn.click();
  assert.equal(attempts.length, 9);

  cooldowns[0].callback();
  assert.equal(degradedBanner.style.display, 'none');
  assert.ok(buttons.every((id) => !elements[id].disabled));
  status = 200;
  await loadBtn.click();
  assert.equal(attempts.length, 10);
  assert.match(log.textContent, /Завантажено товарів: 0/);
});
