import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateController } from '../src/update-controller.js';
import { isSafeUpdate } from '../src/update-policy.js';

function makeUpdate() {
  return {
    version: '0.3.0', body: '<script>unsafe</script>', closed: false, installed: false,
    async close() { this.closed = true; },
    async download(onEvent) { onEvent({ event: 'Started', data: { contentLength: 10 } }); onEvent({ event: 'Progress', data: { chunkLength: 10 } }); onEvent({ event: 'Finished' }); },
    async install() { this.installed = true; },
  };
}

test('updater separates check, download, and explicit install', async () => {
  const update = makeUpdate();
  const states = [];
  let locked = false;
  const controller = createUpdateController({
    check: async () => update,
    onState: state => states.push(state),
    canInstall: () => '',
    setLocked: value => { locked = value; },
    install: item => item.install(),
  });

  await controller.check();
  assert.equal(controller.state.status, 'available');
  assert.equal(update.installed, false);
  await controller.download();
  assert.equal(controller.state.status, 'ready');
  assert.equal(update.installed, false);
  await controller.install();
  assert.equal(update.installed, true);
  assert.equal(locked, true);
  assert.deepEqual(states.map(state => state.status), ['checking', 'available', 'downloading', 'downloading', 'downloading', 'ready', 'installing', 'installed']);
});

test('dirty or busy guard blocks installation without discarding the update', async () => {
  const update = makeUpdate();
  let locked = false;
  let reason = 'Simpan draft dahulu.';
  const controller = createUpdateController({
    check: async () => update,
    onState: () => {},
    canInstall: () => reason,
    setLocked: value => { locked = value; },
    install: item => item.install(),
  });
  await controller.check();
  await controller.download();
  await controller.install();
  assert.equal(controller.state.status, 'ready');
  assert.equal(controller.state.message, reason);
  assert.equal(locked, false);
  assert.equal(update.installed, false);

  reason = '';
  await controller.install();
  assert.equal(update.installed, true);
});

test('failed installation restores controls and keeps the update ready for retry', async () => {
  const update = makeUpdate();
  let locked = false;
  const controller = createUpdateController({
    check: async () => update, onState: () => {}, canInstall: () => '',
    setLocked: value => { locked = value; }, install: async () => { throw new Error('failed'); },
  });
  await controller.check();
  await controller.download();
  await controller.install();
  assert.equal(controller.state.status, 'ready');
  assert.match(controller.state.message, /Pemasangan gagal/);
  assert.equal(locked, false);
});

test('duplicate checks are ignored while a check is pending', async () => {
  let resolveCheck;
  let calls = 0;
  const controller = createUpdateController({
    check: () => { calls++; return new Promise(resolve => { resolveCheck = resolve; }); },
    onState: () => {}, canInstall: () => '', setLocked: () => {}, install: async () => {},
  });
  const first = controller.check();
  await controller.check(true);
  assert.equal(calls, 1);
  resolveCheck(null);
  await first;
});

test('release metadata must be stable, bounded, signed, and hosted by this repository', () => {
  const update = {
    version: '0.3.1', body: 'Perbaikan.',
    rawJson: { platforms: { 'windows-x86_64': {
      url: 'https://github.com/farhanfath/saku-dev/releases/download/v0.3.1/Saku_0.3.1_x64-setup.nsis.zip',
      signature: 'signed-update',
    } } },
  };
  assert.equal(isSafeUpdate(update), true);
  assert.equal(isSafeUpdate({ ...update, version: '0.3.1-rc.1' }), false);
  assert.equal(isSafeUpdate({ ...update, body: 'x'.repeat(12001) }), false);
  assert.equal(isSafeUpdate({ ...update, rawJson: { ...update.rawJson, platforms: { 'windows-x86_64': { url: 'https://evil.example/update', signature: 'signed' } } } }), false);
});
