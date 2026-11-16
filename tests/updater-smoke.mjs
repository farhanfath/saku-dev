import { chromium, expect } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Run only with installers built using tauri.updater-test.json, never Saku's normal installer.
const [installer, artifactUrl, signatureFile] = process.argv.slice(2);
assert.ok(installer && artifactUrl && signatureFile, 'Usage: node tests/updater-smoke.mjs <0.3.0 test installer> <0.3.1 test asset URL> <0.3.1 signature>');
assert.match(path.basename(installer), /^Saku Updater Test_0\.3\.0_x64-setup\.exe$/);
assert.equal(artifactUrl, 'https://github.com/farhanfath/saku-dev/releases/download/v0.3.1/Saku_0.3.1_x64-setup.exe');
const run = promisify(execFile);
const root = path.resolve('test-results/updater');
const installed = path.join(root, 'installed');
const executable = path.join(installed, 'saku-updater-test.exe');
const review = path.resolve('.impeccable/review/updater');
await mkdir(installed, { recursive: true });
await mkdir(review, { recursive: true });
const signature = (await readFile(signatureFile, 'utf8')).trim();
const badLines = Buffer.from(signature, 'base64').toString('utf8').split('\n');
assert.ok(badLines[1]?.length > 40, 'Expected a minisign signature');
badLines[1] = badLines[1].slice(0, 30) + (badLines[1][30] === 'A' ? 'B' : 'A') + badLines[1].slice(31);
const badSignature = Buffer.from(badLines.join('\n')).toString('base64');
let invalid = true;
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({
    version: '0.3.1', notes: 'Isolated signed updater verification.', pub_date: '2026-11-16T00:00:00Z',
    platforms: { 'windows-x86_64': { url: artifactUrl, signature: invalid ? badSignature : signature } },
  }));
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(19346, '127.0.0.1', resolve); });
let app;
let browser;
let page;
async function connect() {
  let endpoint;
  for (let n = 0; n < 300; n++) {
    try { endpoint = (await (await fetch('http://127.0.0.1:19345/json/version')).json()).webSocketDebuggerUrl; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  assert.ok(endpoint, 'Isolated updater app must start CDP');
  browser = await chromium.connectOverCDP(endpoint);
  page = browser.contexts()[0].pages()[0];
  await page.waitForSelector('#update-panel');
}
const appVersion = () => page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|version'));
try {
  await run(path.resolve(installer), ['/S', `/D=${installed}`], { windowsHide: true, timeout: 120000 });
  await access(executable);
  app = spawn(executable, [], { windowsHide: true, stdio: 'ignore' });
  await connect();
  assert.equal(await appVersion(), '0.3.0');
  await expect(page.locator('#update-download')).toBeVisible({ timeout: 30000 });
  await page.locator('#update-download').click();
  await expect(page.locator('#update-status')).toContainText('Unduhan gagal', { timeout: 120000 });
  assert.equal(await appVersion(), '0.3.0', 'Bad signature must leave old version running');
  await expect(page.locator('#update-install')).toBeHidden();

  invalid = false;
  await page.locator('#update-check').click();
  await expect(page.locator('#update-download')).toBeVisible();
  await page.locator('#update-download').click();
  await expect(page.locator('#update-install')).toBeVisible({ timeout: 120000 });

  const fixture = path.join(root, 'draft.txt');
  await writeFile(fixture, 'Preserve this source.');
  await page.evaluate(file => window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
    event: 'tauri://drag-drop', payload: { paths: [file], position: { x: 400, y: 300 } },
  }), fixture);
  await expect(page.locator('.name-input')).toHaveCount(1);
  await page.locator('.name-input').fill('draft-renamed');
  await expect(page.locator('#apply-names')).toBeEnabled();
  await page.locator('#update-install').click();
  await expect(page.locator('#update-message')).toContainText('draft rename');
  assert.equal(await readFile(fixture, 'utf8'), 'Preserve this source.');
  await page.locator('#reset-draft').click();
  await page.locator('#confirm-accept').click();

  await page.locator('#nav-markdown').click();
  await page.locator('#md-new').click();
  await page.locator('.cm-content').click();
  await page.keyboard.type('Unsaved document must survive.');
  await page.locator('#update-install').click();
  await expect(page.locator('#update-message')).toContainText('Simpan dokumen');
  await expect(page.locator('.cm-content')).toContainText('Unsaved document must survive.');
  await page.screenshot({ path: path.join(review, 'dirty-blocked.png') });
  await page.keyboard.press('Control+w');
  await page.locator('#confirm-accept').click();

  const data = path.join(process.env.LOCALAPPDATA, 'local.desktop.tools.updater-test');
  const marker = path.join(data, 'upgrade-check.txt');
  await writeFile(marker, 'Keep existing app data.');
  const oldAppExited = new Promise(resolve => app.once('exit', resolve));
  await page.locator('#update-install').click();
  await oldAppExited;
  await browser.close().catch(() => {});
  browser = null;
  // NSIS relaunches the updated executable after replacing the isolated installation.
  await new Promise(resolve => setTimeout(resolve, 1500));
  await connect();
  await expect.poll(appVersion, { timeout: 30000 }).toBe('0.3.1');
  assert.equal(await readFile(marker, 'utf8'), 'Keep existing app data.');
  assert.equal(await readFile(fixture, 'utf8'), 'Preserve this source.');
  await expect(page.locator('#update-status')).toContainText('sudah versi terbaru', { timeout: 30000 });
  await page.screenshot({ path: path.join(review, 'upgraded.png') });
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }));
  console.log('PASS: real NSIS0.3.0→0.3.1 update, invalid signature rejection, rename/Markdown draft guards, restart and data preservation');
} finally {
  if (browser) await browser.close().catch(() => {});
  if (app && app.exitCode === null) app.kill();
  await new Promise(resolve => server.close(resolve));
}
