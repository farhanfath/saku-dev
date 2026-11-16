import { chromium, expect } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';

await new Promise((resolve, reject) => { const server = createServer(); server.once('error', reject); server.listen(19344, '127.0.0.1', () => server.close(resolve)); });
const root = await mkdtemp(path.join(tmpdir(), 'desktop-local-tools-markdown-'));
const file = path.join(root, 'catatan-proyek.md');
const other = path.join(root, 'dokumen-kedua.md');
const copy = path.join(root, 'salinan.md');
const review = path.resolve('.impeccable/review/markdown');
await mkdir(review, { recursive: true });
const content = ['---', 'title: Catatan proyek', '---', '# Catatan proyek', '', 'Dokumen uji lokal untuk membaca, mengedit, dan melihat diagram.', '', '## Rencana minggu ini', '', '- [x] Menentukan alur utama', '- [ ] Menguji hasil simpan', '', '| Bagian | Status |', '| --- | --- |', '| Reader | Siap diuji |', '| Diagram | Flowchart dan sequence |', '', '## Alur kerja', '', '```mermaid', 'flowchart LR', '  Ide --> Rencana --> Implementasi', '```', '', '```mermaid', 'sequenceDiagram', '  Pengguna->>Aplikasi: Buka dokumen', '  Aplikasi-->>Pengguna: Tampilkan preview', '```', '', '## Contoh kode', '', '```js', 'const status = "lokal";', '```', '', '![Gambar lokal](gambar.png)', '', '![Gambar web](https://example.com/never-load.png)', '', '<script>window.markdownInjected = true;</script>', '', '```mermaid', 'flowchart LR', '  A[invalid', '```', ''].join('\r\n');
await writeFile(file, '\ufeff' + content);
await writeFile(other, '# Dokumen kedua\n\nDibuka dari instance yang sudah aktif.\n');
await writeFile(path.join(root, 'gambar.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=', 'base64'));
const executable = path.resolve('src-tauri/target/debug/saku.exe');
const app = spawn(executable, [file], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const exited = new Promise(resolve => app.once('exit', resolve));
let browser;
let page;
let logs = '';
app.stdout.on('data', b => { logs += b; }); app.stderr.on('data', b => { logs += b; });
try {
  let endpoint;
  for (let n = 0; n < 150; n++) {
    try { endpoint = (await (await fetch('http://127.0.0.1:19344/json/version')).json()).webSocketDebuggerUrl; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(endpoint, `WebView did not start: ${logs}`);
  browser = await chromium.connectOverCDP(endpoint);
  page = browser.contexts()[0].pages()[0];
  const errors = [];
  const externalRequests = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('request', r => { if (r.url().startsWith('https://example.com')) externalRequests.push(r.url()); });
  await expect(page.locator('#md-filename')).toHaveText('catatan-proyek.md');
  await expect(page.locator('#nav-markdown')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#md-preview h1')).toHaveText('Catatan proyek');
  await expect(page.locator('.md-diagram svg')).toHaveCount(2, { timeout: 30000 });
  await expect(page.locator('.md-diagram svg').first()).toContainText('Implementasi');
  await expect(page.locator('.md-diagram-error')).toHaveCount(1);
  await expect(page.locator('#md-preview img[src^="data:image/png"]')).toHaveCount(1);
  await expect(page.locator('#md-preview img[src="https://example.com/never-load.png"]')).toHaveCount(1);
  assert.equal(await page.evaluate(() => window.markdownInjected), undefined);
  await expect(page.locator('.md-tab')).toHaveCount(1);
  await expect(page.locator('.md-tab.active .md-tab-title')).toHaveText('catatan-proyek.md');
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(review, 'read.png') });
  await page.locator('.md-diagram').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(review, 'diagram.png') });
  await page.locator('#md-preview-pane').evaluate(element => { element.scrollTop = 0; });
  await page.locator('button[data-mode="split"]').click();
  await expect(page.locator('#md-editor-pane')).toBeVisible();
  await page.screenshot({ path: path.join(review, 'split.png') });
  await page.locator('#md-search-toggle').click();
  await page.locator('#md-search').fill('dokumen');
  await expect(page.locator('.md-search-match').first()).toBeVisible();
  await page.locator('#md-search-close').click();
  const editor = page.locator('.cm-content');
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.type('\nTambahan dari editor.');
  await expect(page.locator('#md-dirty')).toBeVisible();
  await page.locator('#nav-batch').click(); await page.locator('#nav-markdown').click();
  await expect(editor).toContainText('Tambahan dari editor.');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#md-message')).toContainText('berhasil disimpan');
  const saved = await readFile(file);
  assert.ok(saved.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
  assert.match(saved.toString('utf8'), /Tambahan dari editor/);
  assert.ok(saved.toString('utf8').includes('\r\n'));
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.type('\nDraft lokal belum disimpan.');
  await writeFile(file, '# Versi dari editor lain\n');
  await page.locator('#md-save').click();
  await expect(page.locator('#md-conflict')).toBeVisible();
  await expect(editor).toContainText('Draft lokal belum disimpan.');
  assert.equal(await readFile(file, 'utf8'), '# Versi dari editor lain\n');
  await page.screenshot({ path: path.join(review, 'conflict.png') });
  const saveClick = page.locator('#md-save-copy').click();
  const native = await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('tests/save-markdown-dialog.ps1'), '-AppProcessId', String(app.pid), '-TargetPath', copy], { windowsHide: true, timeout: 30000 });
  console.log(native.stdout.trim()); await saveClick;
  await expect(page.locator('#md-filename')).toHaveText('salinan.md');
  assert.match(await readFile(copy, 'utf8'), /Draft lokal belum disimpan/);
  assert.equal(await readFile(file, 'utf8'), '# Versi dari editor lain\n');
  const second = spawn(executable, [other], { windowsHide: true, stdio: 'ignore' });
  let handoffTimer;
  const handedOff = await Promise.race([new Promise(resolve => second.once('exit', () => resolve(true))), new Promise(resolve => { handoffTimer = setTimeout(() => resolve(false), 5000); })]);
  clearTimeout(handoffTimer);
  if (!handedOff) second.kill();
  assert.ok(handedOff, 'Second instance must forward its file and exit.');
  await expect(page.locator('#md-filename')).toHaveText('dokumen-kedua.md');
  await expect(page.locator('#md-preview h1')).toHaveText('Dokumen kedua');
  await expect(page.locator('.md-tab')).toHaveCount(2);
  await expect(page.locator('.md-tab.active .md-tab-title')).toHaveText('dokumen-kedua.md');

  // Verify tab switching
  await page.locator('.md-tab').first().click();
  await expect(page.locator('#md-filename')).toHaveText('salinan.md');
  await page.locator('.md-tab').nth(1).click();
  await expect(page.locator('#md-filename')).toHaveText('dokumen-kedua.md');

  // Verify adding a new tab via '+'
  await page.locator('#md-tab-new').click();
  await expect(page.locator('.md-tab')).toHaveCount(3);
  await expect(page.locator('#md-filename')).toHaveText('Tanpa judul.md');

  // Edit the new tab and check dirty indicator
  await editor.click();
  await page.keyboard.type('# Dokumen baru\n\nDraft belum disimpan.');
  await expect(page.locator('.md-tab.active .md-tab-dirty')).toBeVisible();

  // Closing dirty tab prompts confirmation
  await page.locator('.md-tab.active .md-tab-close').click();
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#confirm-dialog')).not.toBeVisible();
  await expect(page.locator('.md-tab')).toHaveCount(3);

  // Switch to dokumen-kedua.md and edit it
  await page.locator('.md-tab').nth(1).click();
  await page.locator('button[data-mode="edit"]').click();
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.type('\nDraft terakhir');
  await expect(page.locator('.md-tab.active .md-tab-dirty')).toBeVisible();
  await page.setViewportSize({ width: 760, height: 640 });
  await page.locator('button[data-mode="read"]').click();
  const outlineToggle = page.locator('#md-outline-toggle');
  if (await outlineToggle.getAttribute('aria-pressed') === 'true') await outlineToggle.click();
  await outlineToggle.click();
  await expect(page.locator('#md-outline')).toBeVisible();
  await page.screenshot({ path: path.join(review, 'outline-compact.png') });
  await page.locator('.md-outline-item').first().click();
  await expect(page.locator('#md-outline')).not.toBeVisible();
  await expect(page.locator('#md-preview h1')).toBeVisible();
  await page.locator('button[data-mode="split"]').click();
  await outlineToggle.click();
  await expect(page.locator('#md-outline')).toBeVisible();
  await page.locator('.md-outline-item').first().click();
  await expect(page.locator('#md-outline')).not.toBeVisible();
  await page.locator('button[data-mode="edit"]').click();
  await expect(outlineToggle).toBeDisabled();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(review, 'compact.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(review, 'mobile.png') });
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }));
  await expect(page.locator('#confirm-title')).toHaveText('Tutup dan buang draft?');
  await page.keyboard.press('Escape');
  await expect(editor).toContainText('Draft terakhir');
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }));
  await page.locator('#confirm-accept').click();
  let timer;
  assert.ok(await Promise.race([exited.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 3000); })]), 'Markdown dirty close must terminate app after approval');
  clearTimeout(timer);
  assert.deepEqual(errors, []);
  console.log('PASS: startup file, read/edit/split, two Mermaid types + invalid diagram, local image + web image, multi-tab switching, new tab +, dirty tab close confirmation, blocked remote HTML, search, retained draft across tools, real Save, external conflict, native Save As, single-instance file handoff, discard cancel, responsive layout and dirty close.');
} catch (error) {
  if (page && !page.isClosed()) { console.log(await page.locator('body').innerText()); await page.screenshot({ path: path.join(review, 'failure.png') }).catch(() => {}); }
  throw error;
} finally {
  app.kill(); await exited;
  if (browser) await browser.close().catch(() => {});
  const resolved = path.resolve(root);
  if (path.dirname(resolved) === path.resolve(tmpdir()) && path.basename(resolved).startsWith('desktop-local-tools-markdown-')) await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
