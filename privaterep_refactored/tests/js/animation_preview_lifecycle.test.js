const assert = require('node:assert');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const managerFactory = require(path.join(__dirname, '..', '..', 'ni_votes', 'web', 'static', 'js', 'animation_preview_manager.js'));

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const { window } = dom;

global.window = window;
global.document = window.document;
global.CustomEvent = window.CustomEvent;
global.Event = window.Event;

document.body.innerHTML = '';

function createPreviewContainer(index) {
  const wrapper = document.createElement('div');
  wrapper.className = 'election-animation-wrapper';
  wrapper.dataset.animationFor = String(index);
  const preview = document.createElement('div');
  preview.className = 'animation-preview';
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.animationPreview = String(index);
  preview.appendChild(button);
  wrapper.appendChild(preview);
  return wrapper;
}

async function main() {
  // Repeated preview activation restores preview without leaking listeners.
  {
    const toggles = [];
    const manager = managerFactory.createManager({
      startAnimation: (container) => {
        container.__animationState = { timer: null };
        const content = document.createElement('div');
        content.setAttribute('data-role', 'animation');
        container.appendChild(content);
        return true;
      },
      resolveElection: (index) => ({ index }),
      updateToggle: (index, active) => toggles.push({ index, active }),
    });

    const root = document.createElement('div');
    const wrapper = createPreviewContainer(0);
    root.appendChild(wrapper);
    document.body.appendChild(root);

    manager.initialize(root);

    let button = wrapper.querySelector('[data-animation-preview]');
    assert(button, 'preview button should exist after initialise');
    button.click();
    assert(wrapper.querySelector('[data-role="animation"]'), 'animation content should mount');

    wrapper.dispatchEvent(new window.CustomEvent('election-animation:stopped'));
    button = wrapper.querySelector('[data-animation-preview]');
    assert(button, 'preview button should be restored after stop');
    assert.strictEqual(wrapper.querySelectorAll('[data-animation-preview]').length, 1, 'only one preview trigger should exist');

    button.click();
    wrapper.dispatchEvent(new window.CustomEvent('election-animation:stopped'));
    const restoredAgain = wrapper.querySelector('[data-animation-preview]');
    assert(restoredAgain, 'preview button should exist after second cycle');
    assert.strictEqual(wrapper.querySelectorAll('[data-animation-preview]').length, 1, 'listener count should remain stable');

    assert.deepStrictEqual(
      toggles,
      [
        { index: 0, active: true },
        { index: 0, active: false },
        { index: 0, active: true },
        { index: 0, active: false },
      ],
      'toggle updates should fire for each activation cycle'
    );

    document.body.removeChild(root);
  }

  // Failed start should restore preview and keep listeners stable.
  {
    const toggles = [];
    const errors = [];
    const manager = managerFactory.createManager({
      startAnimation: () => false,
      resolveElection: () => ({ id: 'test' }),
      updateToggle: (index, active) => toggles.push({ index, active }),
      onError: (err) => errors.push(err),
    });

    const root = document.createElement('div');
    const wrapper = createPreviewContainer(0);
    root.appendChild(wrapper);
    document.body.appendChild(root);

    manager.initialize(root);

    const button = wrapper.querySelector('[data-animation-preview]');
    button.click();

    const restored = wrapper.querySelector('[data-animation-preview]');
    assert(restored, 'preview should remain available when start fails');
    assert.strictEqual(wrapper.querySelectorAll('[data-animation-preview]').length, 1, 'listener count should reset after failure');
    assert.deepStrictEqual(toggles, [{ index: 0, active: false }], 'toggle callback should record failure as inactive state');
    assert.strictEqual(errors.length, 0, 'onError should not be called when start returns false');

    document.body.removeChild(root);
  }

  // Exceptions during start should surface via onError and keep preview usable.
  {
    const errors = [];
    const manager = managerFactory.createManager({
      startAnimation: () => {
        throw new Error('boom');
      },
      resolveElection: () => ({ id: 'example' }),
      updateToggle: () => {},
      onError: (err) => errors.push(err.message || String(err)),
    });

    const root = document.createElement('div');
    const wrapper = createPreviewContainer(0);
    root.appendChild(wrapper);
    document.body.appendChild(root);

    manager.initialize(root);

    const button = wrapper.querySelector('[data-animation-preview]');
    button.click();

    const restored = wrapper.querySelector('[data-animation-preview]');
    assert(restored, 'preview should be restored after start throws');
    assert.strictEqual(wrapper.querySelectorAll('[data-animation-preview]').length, 1, 'listener count should remain one after exception');
    assert.strictEqual(errors.length, 1, 'error handler should capture thrown error');

    document.body.removeChild(root);
  }

  // Starting animation from an external toggle should also restore preview after stop.
  {
    const manager = managerFactory.createManager({
      startAnimation: (container) => {
        container.__animationState = { timer: null };
        const node = document.createElement('div');
        node.setAttribute('data-role', 'animation');
        container.appendChild(node);
        return true;
      },
      resolveElection: (index) => ({ index }),
      updateToggle: () => {},
    });

    const root = document.createElement('div');
    const wrapper = createPreviewContainer(0);
    root.appendChild(wrapper);
    document.body.appendChild(root);

    manager.initialize(root);

    const started = await manager.startFromToggle(wrapper, 0, { index: 0 });
    assert.strictEqual(started, true, 'startFromToggle should resolve true');
    assert(wrapper.querySelector('[data-role="animation"]'), 'toggle start should mount animation content');

    wrapper.dispatchEvent(new window.CustomEvent('election-animation:stopped'));
    const restored = wrapper.querySelector('[data-animation-preview]');
    assert(restored, 'preview should return after toggle-driven stop');
    assert.strictEqual(wrapper.querySelectorAll('[data-animation-preview]').length, 1, 'preview listener should remain singular after toggle cycle');

    document.body.removeChild(root);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
