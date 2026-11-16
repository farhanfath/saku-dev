import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';

const root = await mkdtemp(path.join(tmpdir(), 'desktop-local-tools-close-'));
const fixture = path.join(root, 'draft.txt');
await writeFile(fixture, 'Close tests never apply a rename.');

try {
  // Never attach to an existing debugging session belonging to another app run.
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(19344, '127.0.0.1', () => probe.close(resolve));
  });
  for (const dirty of [false, true]) {
    const app = spawn(path.resolve('src-tauri/target/debug/saku.exe'), [], { windowsHide: true, stdio: 'ignore' });
    const exited = new Promise(resolve => app.once('exit', resolve));
    let browser;
    const errors = [];
    try {
      let endpoint;
      for (let attempt = 0; attempt < 100; attempt++) {
        try { endpoint = (await (await fetch('http://127.0.0.1:19344/json/version')).json()).webSocketDebuggerUrl; break; }
        catch { await new Promise(resolve => setTimeout(resolve, 100)); }
      }
      assert.ok(endpoint, 'Test WebView2 did not start. Close other app instances first.');
      browser = await chromium.connectOverCDP(endpoint);
      const page = browser.contexts()[0].pages()[0];
      page.on('pageerror', error => errors.push(String(error)));
      await page.waitForSelector('#choose-files');
      await expect(page.locator('#add-files')).toBeEnabled();
      if (dirty) {
        await page.evaluate(file => window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
          event: 'tauri://drag-drop', payload: { paths: [file], position: { x: 400, y: 300 } },
        }), fixture);
        await page.locator('.name-input').fill('unsaved');
        await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }));
        await expect(page.locator('#confirm-dialog')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#confirm-dialog')).not.toBeVisible();
        await expect(page.locator('.name-input')).toHaveValue('unsaved');
      }
      await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }));
      if (dirty) {
        await expect(page.locator('#confirm-dialog')).toBeVisible();
        await page.locator('#confirm-accept').click();
      }
      let timeout;
      const closed = await Promise.race([
        exited.then(() => true),
        new Promise(resolve => { timeout = setTimeout(() => resolve(false), 3000); }),
      ]);
      clearTimeout(timeout);
      assert.ok(closed, `${dirty ? 'Confirmed dirty' : 'Clean'} close left the app running. ${errors.join(' | ')}`);
      assert.deepEqual(errors, []);
      console.log(`PASS: ${dirty ? 'dirty draft cancels safely, then closes after confirmation' : 'clean window closes'} and app process exits.`);
    } finally {
      app.kill();
      await exited;
      if (browser) await browser.close().catch(() => {});
    }
  }
} finally {
  const resolved = path.resolve(root);
  if (path.dirname(resolved) === path.resolve(tmpdir()) && path.basename(resolved).startsWith('desktop-local-tools-close-')) {
    await rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
