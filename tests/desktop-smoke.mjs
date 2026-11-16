import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = await mkdtemp(path.join(tmpdir(), 'desktop-local-tools-smoke-'));
const review = path.resolve('.impeccable/review');
await mkdir(review, { recursive: true });
const journal = path.join(process.env.LOCALAPPDATA, 'local.desktop.tools.smoke', 'last-rename.json');
try { await access(journal); throw new Error('Existing undo journal found. Undo your last batch before running the isolated desktop smoke test.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

const fixtures = ['catatan-awal.txt', 'ringkasan.txt', 'README'];
for (const [index, name] of fixtures.entries()) await writeFile(path.join(root, name), `fixture ${index}`);
const app = spawn(path.resolve('src-tauri/target/debug/saku.exe'), [], {
  windowsHide: true,
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
let activePage;
let logs = '';
app.stderr.on('data', data => { logs += data; });
app.stdout.on('data', data => { logs += data; });
app.on('error', error => { logs += error; });
try {
  let endpoint;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const response = await fetch('http://127.0.0.1:19344/json/version'); endpoint = (await response.json()).webSocketDebuggerUrl; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert.ok(endpoint, `Desktop WebView2 did not start: ${logs}`);
  browser = await chromium.connectOverCDP(endpoint);
  const page = browser.contexts()[0].pages()[0];
  activePage = page;
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.waitForSelector('#choose-files');
  await expect(page.locator('.brand')).toHaveText('Saku');
  await expect(page).toHaveTitle(/Saku$/);
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(review, 'empty.png'), fullPage: true });
  await mkdir(path.join(review, 'markdown'), { recursive: true });
  await page.locator('#nav-markdown').click();
  await expect(page).toHaveTitle('Markdown · Saku');
  await expect(page.locator('#md-empty')).toBeVisible();
  await page.screenshot({ path: path.join(review, 'markdown/empty.png') });
  await page.locator('#nav-batch').click();
  // Emit the same Tauri event as a native file drop; all filesystem commands use real Rust IPC.
  await page.evaluate(paths => window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
    event: 'tauri://drag-drop', payload: { paths, position: { x: 400, y: 300 } },
  }), fixtures.map(name => path.join(root, name)));
  await expect(page.locator('.name-input')).toHaveCount(3);
  const inputs = page.locator('.name-input');
  await expect(inputs.nth(0)).toHaveValue('catatan-awal');
  assert.ok(await page.locator('.extension').first().evaluate(element => element.clientWidth >= 20), 'Protected extension must remain visibly readable');
  await inputs.nth(0).fill('catatan-final');
  await inputs.nth(0).press('Enter');
  await expect(inputs.nth(1)).toBeFocused();
  await inputs.nth(1).fill('catatan-final');
  await expect(page.locator('tr.invalid')).toHaveCount(2);
  await expect(page.locator('#apply-names')).toBeDisabled();
  await page.screenshot({ path: path.join(review, 'error.png'), fullPage: true });
  await inputs.nth(1).fill('ringkasan');
  await expect(page.locator('#apply-names')).toBeEnabled();
  await inputs.nth(0).focus();
  await page.screenshot({ path: path.join(review, 'desktop.png'), fullPage: true });
  await access(path.join(root, 'catatan-awal.txt'));
  await page.locator('#apply-names').click();
  await expect(page.locator('#message')).toContainText('1 file berhasil');
  assert.equal(await readFile(path.join(root, 'catatan-final.txt'), 'utf8'), 'fixture 0');
  await expect(page.locator('#undo-batch')).toBeEnabled();
  await page.locator('#undo-batch').click();
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  await page.screenshot({ path: path.join(review, 'confirm.png'), fullPage: true });
  await page.getByRole('button', { name: 'Batal', exact: true }).click();
  await access(path.join(root, 'catatan-final.txt'));
  await page.locator('#undo-batch').click();
  await page.locator('#confirm-accept').click();
  await expect(page.locator('#message')).toContainText('berhasil dikembalikan');
  assert.equal(await readFile(path.join(root, 'catatan-awal.txt'), 'utf8'), 'fixture 0');
  await expect(page.locator('#undo-batch')).toBeDisabled();
  await page.locator('#protect-extension').uncheck();
  await expect(page.locator('.name-input').first()).toHaveValue('catatan-awal.txt');
  await page.locator('.name-input').first().fill('catatan-dengan-nama-yang-cukup-panjang-untuk-menguji-lebar-kolom-dan-ekstensi.txt');
  await expect(page.locator('#apply-names')).toBeEnabled();
  await page.setViewportSize({ width: 760, height: 640 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(review, 'compact.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(review, 'mobile.png') });
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }));
  await expect(page.locator('#confirm-title')).toHaveText('Tutup dan buang draft?');
  await page.keyboard.press('Escape');
  await expect(page.locator('#confirm-dialog')).not.toBeVisible();
  await expect(page.locator('#reset-draft')).toBeEnabled();
  await page.locator('#reset-draft').click();
  await page.locator('#confirm-accept').click();
  await expect(page.locator('.name-input').first()).toHaveValue('catatan-awal.txt');
  await expect(page.locator('#apply-names')).toBeDisabled();
  await page.locator('.remove-file').first().click();
  await expect(page.locator('#empty-state')).toBeVisible();
  assert.deepEqual(errors, []);
  console.log('PASS: real Windows WebView2 import, protected extension, Enter navigation, duplicate validation, apply, content preservation, undo confirmation/cancel, real undo, unlocked extension, draft reset, row removal, and responsive overflow.');
} catch (error) {
  if (activePage) {
    console.log(await activePage.locator('body').innerText().catch(() => 'Page unavailable'));
    await activePage.screenshot({ path: path.join(review, 'failure.png'), fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  if (browser) await browser.close().catch(() => {});
  app.kill();
  // Cleanup is restricted to the uniquely created smoke-test folder under the OS temp directory.
  const resolved = path.resolve(root);
  if (path.dirname(resolved) === path.resolve(tmpdir()) && path.basename(resolved).startsWith('desktop-local-tools-smoke-')) {
    await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(error => console.log(`Fixture cleanup pending: ${error.message}`));
  }
}
