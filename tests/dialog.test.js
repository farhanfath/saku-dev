import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmAction } from '../src/dialog.js';

test('reopening a confirmation waits for the previous queued close event', async () => {
  const dialog = Object.assign(new EventTarget(), {
    open: false, returnValue: '', showModal() { this.open = true; },
  });
  const labels = {};
  globalThis.document = { getElementById: id => id === 'confirm-dialog' ? dialog : (labels[id] ||= {}) };
  try {
    const first = confirmAction('First', '', 'Continue');
    assert.equal(await confirmAction('Overlapping', '', 'Continue'), false);
    // The browser closes the dialog before its queued `close` event is delivered.
    dialog.open = false;
    const second = confirmAction('Second', '', 'Continue');
    assert.equal(dialog.open, false);
    dialog.dispatchEvent(new Event('close'));
    assert.equal(await first, false);
    assert.equal(dialog.open, true);
    assert.equal(labels['confirm-title'].textContent, 'Second');
    dialog.returnValue = 'accept';
    dialog.open = false;
    dialog.dispatchEvent(new Event('close'));
    assert.equal(await second, true);
  } finally {
    delete globalThis.document;
  }
});
