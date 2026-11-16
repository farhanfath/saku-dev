import '@phosphor-icons/web/regular';
import './style.css';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';
import { check as checkUpdate } from '@tauri-apps/plugin-updater';
import { splitName, sizeLabel, summarize } from './model.js';
import { confirmAction } from './dialog.js';
import { createMarkdown } from './markdown.js';
import { createUpdateController } from './update-controller.js';
import { isSafeUpdate } from './update-policy.js';

const $ = (id) => document.getElementById(id);
const native = isTauri();
let rows = [];
let busy = false;
let checking = false;
let validationFailed = false;
let status = { undoCount: 0, recovery: false };
let timer;
let revision = 0;
let allowClose = false;
let activeTool = 'batch';
let updatesLocked = false;
const markdown = createMarkdown();

function showTool(tool) {
  activeTool = tool;
  $('rename-tool').hidden = tool !== 'batch';
  $('markdown-tool').hidden = tool !== 'markdown';
  $('main').classList.toggle('markdown-active', tool === 'markdown');
  document.querySelectorAll('[data-tool]').forEach(link => {
    if (link.dataset.tool === tool) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.title = `${tool === 'markdown' ? 'Markdown' : 'Batch Rename'} · Saku`;
}
document.querySelectorAll('[data-tool]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); showTool(link.dataset.tool); }));

function icon(name) {
  const element = document.createElement('i');
  element.className = `ph ph-${name}`;
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function notify(text, kind = 'info') {
  const element = $('message');
  element.className = `notice ${kind}`;
  element.replaceChildren(icon(kind === 'error' ? 'warning-circle' : kind === 'success' ? 'check-circle' : 'info'), document.createTextNode(text));
  element.hidden = !text;
  element.setAttribute('role', kind === 'error' ? 'alert' : 'status');
}

function updateUI() {
  const { changed, issues } = summarize(rows);
  $('file-count').textContent = rows.length;
  $('empty-state').hidden = rows.length > 0;
  $('file-table').hidden = !rows.length;
  $('add-files').disabled = busy || updatesLocked || !native || status.recovery;
  $('choose-files').disabled = busy || updatesLocked || !native || status.recovery;
  $('clear-files').disabled = busy || updatesLocked || !rows.length;
  $('reset-draft').disabled = busy || updatesLocked || !changed;
  $('protect-extension').disabled = busy || updatesLocked;
  $('apply-names').disabled = busy || updatesLocked || !changed || !!issues || checking || validationFailed || status.recovery;
  $('undo-batch').disabled = busy || updatesLocked || !status.undoCount || status.recovery;
  $('recover').disabled = busy || updatesLocked;
  $('recovery-note').hidden = !status.recovery;
  $('summary-title').textContent = busy ? 'Memproses file…' : issues ? `${issues} file perlu diperiksa` : changed ? `${changed} nama siap diubah` : 'Belum ada perubahan';
  $('summary-description').textContent = busy ? 'Tunggu sampai operasi selesai.' : checking ? 'Memeriksa nama dan konflik…' : validationFailed ? 'Pemeriksaan gagal. Cek pesan di atas lalu coba edit lagi.' : issues ? 'Perbaiki nama yang ditandai sebelum Apply.' : changed ? 'Periksa nama baru, lalu terapkan saat sudah yakin.' : rows.length ? 'Edit kolom nama baru. File asli belum berubah.' : 'Tambahkan file untuk mulai mengedit nama.';
  $('summary-icon').classList.toggle('has-issues', !!issues || validationFailed);
  $('list-hint').textContent = rows.length ? `${rows.length - changed} tetap · ${changed} berubah` : 'Perubahan masih berupa draft.';
  for (const input of document.querySelectorAll('.name-input, .remove-file')) input.disabled = busy || updatesLocked;
}

function paintRow(row) {
  const tr = document.getElementById(`row-${row.id}`);
  if (!tr) return;
  const changed = row.newName !== row.name;
  tr.classList.toggle('changed', changed);
  tr.classList.toggle('invalid', !!row.issue);
  const input = tr.querySelector('.name-input');
  input.setAttribute('aria-invalid', String(!!row.issue));
  const issue = tr.querySelector('.row-issue');
  issue.textContent = row.issue || '';
  issue.hidden = !row.issue;
  const state = tr.querySelector('.row-status');
  state.replaceChildren(icon(row.issue ? 'warning-circle' : changed ? 'pencil-simple' : 'minus'), document.createTextNode(row.issue ? 'Periksa' : changed ? 'Diubah' : 'Tetap'));
}

function renderRows() {
  const fragment = document.createDocumentFragment();
  rows.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.id = `row-${row.id}`;
    const number = document.createElement('td');
    number.className = 'row-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const original = document.createElement('td');
    original.className = 'original-cell';
    const originalWrap = document.createElement('div');
    originalWrap.className = 'original-wrap';
    const fileIcon = icon('file');
    fileIcon.classList.add('file-icon');
    const details = document.createElement('div');
    const name = document.createElement('span');
    name.className = 'original-name';
    name.textContent = row.name;
    name.title = row.name;
    const parent = document.createElement('small');
    parent.textContent = `${sizeLabel(row.size)} · ${row.parent}`;
    parent.title = row.path;
    details.append(name, parent);
    originalWrap.append(fileIcon, details);
    original.append(originalWrap);

    const editCell = document.createElement('td');
    editCell.className = 'edit-cell';
    const inputWrap = document.createElement('div');
    inputWrap.className = 'input-wrap';
    const input = document.createElement('input');
    input.className = 'name-input';
    input.type = 'text';
    input.value = row.extension ? row.newName.slice(0, -row.extension.length) : row.newName;
    input.setAttribute('aria-label', `Nama baru untuk ${row.name}`);
    input.setAttribute('aria-describedby', `issue-${row.id}`);
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.addEventListener('input', () => {
      row.newName = input.value + row.extension;
      row.issue = null;
      paintRow(row);
      scheduleValidation();
    });
    input.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        const inputs = [...document.querySelectorAll('.name-input')];
        const next = inputs[index + (event.shiftKey ? -1 : 1)];
        if (next) { next.focus(); next.select(); }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        row.newName = row.name;
        row.extension = $('protect-extension').checked ? splitName(row.name).extension : '';
        renderRows();
        const restored = document.querySelectorAll('.name-input')[index];
        restored.focus(); restored.select();
        scheduleValidation();
      }
    });
    inputWrap.append(input);
    if (row.extension) {
      const suffix = document.createElement('span');
      suffix.className = 'extension'; suffix.textContent = row.extension;
      suffix.title = 'Ekstensi dilindungi'; inputWrap.append(suffix);
    }
    const issue = document.createElement('p');
    issue.className = 'row-issue'; issue.id = `issue-${row.id}`; issue.hidden = true;
    editCell.append(inputWrap, issue);
    const statusCell = document.createElement('td');
    const state = document.createElement('span'); state.className = 'row-status'; statusCell.append(state);
    const removeCell = document.createElement('td');
    const remove = document.createElement('button');
    remove.className = 'icon-button remove-file';
    remove.setAttribute('aria-label', `Keluarkan ${row.name} dari daftar`);
    remove.title = 'Keluarkan dari daftar'; remove.append(icon('x'));
    remove.addEventListener('click', () => { rows = rows.filter(r => r.id !== row.id); renderRows(); scheduleValidation(); });
    removeCell.append(remove);
    tr.append(number, original, editCell, statusCell, removeCell);
    fragment.append(tr);
  });
  $('file-rows').replaceChildren(fragment);
  rows.forEach(paintRow);
  updateUI();
}

const edits = () => rows.map(row => ({ id: row.id, newName: row.newName }));

function scheduleValidation() {
  clearTimeout(timer);
  const version = ++revision;
  checking = rows.length > 0;
  validationFailed = false;
  updateUI();
  if (!rows.length) return;
  timer = setTimeout(async () => {
    try {
      const results = await invoke('preview_names', { edits: edits() });
      if (version !== revision) return;
      for (const result of results) {
        const row = rows.find(r => r.id === result.id);
        if (row) { row.issue = result.issue; paintRow(row); }
      }
    } catch (error) {
      if (version !== revision) return;
      validationFailed = true;
      notify(String(error), 'error');
    } finally {
      if (version === revision) { checking = false; updateUI(); }
    }
  }, 180);
}

async function refreshStatus() {
  try { status = await invoke('session_status'); }
  catch (error) { validationFailed = true; notify(String(error), 'error'); }
  updateUI();
}

const updater = createUpdateController({
  async check() {
    const update = await checkUpdate({ target: 'windows-x86_64', timeout: 15000 });
    if (!update) return null;
    if (!isSafeUpdate(update)) {
      await update.close();
      throw new Error('Metadata update tidak valid.');
    }
    return update;
  },
  onState: renderUpdateState,
  canInstall() {
    if (busy || checking || markdown.isBusy()) return 'Tunggu operasi file selesai sebelum memasang pembaruan.';
    if (summarize(rows).changed || markdown.isDirty()) return 'Simpan dokumen Markdown dan selesaikan atau reset draft rename sebelum memasang pembaruan.';
    return '';
  },
  setLocked(value) {
    updatesLocked = value;
    markdown.setUpdatesLocked(value);
    updateUI();
  },
  install: update => update.install(),
});

function renderUpdateState(state) {
  const panel = $('update-panel');
  panel.hidden = !native;
  $('update-status').textContent = ({
    idle: 'Versi aplikasi',
    checking: 'Memeriksa versi terbaru…',
    'up-to-date': 'Aplikasi sudah versi terbaru.',
    available: `Versi ${state.version} tersedia.`,
    downloading: `Mengunduh versi ${state.version}…`,
    ready: `Versi ${state.version} siap dipasang.`,
    installing: `Memasang versi ${state.version}…`,
    installed: 'Pembaruan dimulai. Aplikasi akan dibuka ulang.',
    dismissed: 'Pengingat ditutup untuk sesi ini.',
    error: state.message,
  })[state.status] || 'Versi aplikasi';
  const message = $('update-message');
  message.textContent = state.message || '';
  message.hidden = state.status === 'error' || !state.message;
  const notes = $('update-notes');
  notes.textContent = state.notes ? state.notes.slice(0, 12000) : '';
  notes.hidden = !state.notes;
  const progress = $('update-progress');
  progress.hidden = state.status !== 'downloading';
  if (state.total > 0) {
    progress.max = state.total;
    progress.value = Math.min(state.received || 0, state.total);
    progress.setAttribute('aria-label', `Unduhan ${Math.floor(progress.value / progress.max * 100)} persen`);
  } else {
    progress.removeAttribute('value');
    progress.setAttribute('aria-label', 'Unduhan berjalan');
  }
  $('update-check').disabled = ['checking', 'downloading', 'installing', 'installed'].includes(state.status);
  $('update-check').textContent = state.status === 'error' ? 'Coba lagi' : 'Cek pembaruan';
  $('update-later').hidden = !['available', 'ready'].includes(state.status);
  $('update-download').hidden = state.status !== 'available';
  $('update-install').hidden = state.status !== 'ready';
  $('update-download').disabled = state.status === 'downloading';
  $('update-install').disabled = state.status === 'installing';
}

$('update-check').addEventListener('click', () => updater.check(true));
$('update-download').addEventListener('click', () => updater.download());
$('update-install').addEventListener('click', () => updater.install());
$('update-later').addEventListener('click', () => updater.later());

function setFiles(files) {
  rows = files.map(file => ({ ...file, newName: file.name, extension: $('protect-extension').checked ? splitName(file.name).extension : '', issue: null }));
  renderRows(); scheduleValidation();
}

async function importPaths(paths) {
  if (busy || updatesLocked || status.recovery || !paths.length) return;
  busy = true; notify(''); updateUI();
  try {
    const files = await invoke('import_files', { paths });
    for (const file of files) {
      if (!rows.some(r => r.id === file.id)) rows.push({ ...file, newName: file.name, extension: $('protect-extension').checked ? splitName(file.name).extension : '', issue: null });
    }
    renderRows();
  } catch (error) { notify(String(error), 'error'); }
  finally { busy = false; scheduleValidation(); }
}

async function chooseFiles() {
  if (!native || busy || updatesLocked || status.recovery) return;
  try {
    const paths = await open({ multiple: true, directory: false, title: 'Pilih file untuk Batch Rename' });
    if (paths) await importPaths(Array.isArray(paths) ? paths : [paths]);
  } catch (error) { notify(`Tidak bisa memilih file: ${error}`, 'error'); }
}

$('add-files').addEventListener('click', chooseFiles);
$('choose-files').addEventListener('click', chooseFiles);
$('protect-extension').addEventListener('change', () => {
  for (const row of rows) row.extension = $('protect-extension').checked ? splitName(row.newName).extension : '';
  renderRows(); scheduleValidation();
});
$('clear-files').addEventListener('click', async () => {
  if (busy || updatesLocked) return;
  if (summarize(rows).changed && !await confirmAction('Buang draft dan kosongkan daftar?', 'Nama file di perangkat belum berubah. Draft nama baru akan dibuang.', 'Kosongkan daftar')) return;
  try { await invoke('clear_files'); rows = []; renderRows(); scheduleValidation(); notify(''); }
  catch (error) { notify(String(error), 'error'); }
});
$('reset-draft').addEventListener('click', async () => {
  if (busy || updatesLocked) return;
  if (!await confirmAction('Reset semua nama baru?', 'Semua edit di daftar ini akan kembali ke nama asli. File di perangkat tidak berubah.', 'Reset draft')) return;
  setFiles(rows); notify('Draft kembali ke nama asli.');
});
$('apply-names').addEventListener('click', async () => {
  if ($('apply-names').disabled || updatesLocked) return;
  const count = summarize(rows).changed;
  busy = true; ++revision; clearTimeout(timer); updateUI();
  try { setFiles(await invoke('apply_names', { edits: edits() })); notify(`${count} file berhasil di-rename. Batch ini bisa dikembalikan lewat Undo.`, 'success'); }
  catch (error) { notify(String(error), 'error'); }
  finally { busy = false; await refreshStatus(); scheduleValidation(); }
});

async function undoBatch() {
  if (busy || updatesLocked) return;
  const description = status.recovery ? 'Aplikasi akan mencari file batch ini dan mengembalikannya ke nama semula. File penghalang tidak akan ditimpa.' : 'Nama file dari batch terakhir akan dikembalikan. Draft yang sedang diedit akan dibuang.';
  if (!await confirmAction(status.recovery ? 'Pulihkan batch yang terputus?' : 'Kembalikan batch terakhir?', description, status.recovery ? 'Pulihkan batch' : 'Undo batch')) return;
  busy = true; ++revision; clearTimeout(timer); updateUI();
  try { setFiles(await invoke('undo_batch')); notify('Nama file berhasil dikembalikan.', 'success'); }
  catch (error) { notify(String(error), 'error'); }
  finally { busy = false; await refreshStatus(); scheduleValidation(); }
}
$('undo-batch').addEventListener('click', undoBatch);
$('recover').addEventListener('click', undoBatch);
document.addEventListener('keydown', event => {
  if (updatesLocked) { event.preventDefault(); return; }
  if ($('confirm-dialog').open) return;
  if (activeTool === 'markdown') { if (!event.defaultPrevented) markdown.keydown(event); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); chooseFiles(); }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); $('apply-names').click(); }
});
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => event.preventDefault());

if (native) {
  const window = getCurrentWindow();
  window.onDragDropEvent(event => {
    $('drop-area').classList.toggle('dragging', activeTool === 'batch' && !busy && !updatesLocked && ['enter', 'over'].includes(event.payload.type));
    if (event.payload.type === 'drop') {
      if (updatesLocked) return;
      if (activeTool === 'markdown') markdown.drop(event.payload.paths);
      else importPaths(event.payload.paths);
    }
  }).catch(error => notify(`Drag-and-drop belum tersedia: ${error}. Gunakan tombol Tambah file.`, 'error'));
  window.onCloseRequested(async event => {
    if (allowClose) return;
    if (updatesLocked) return;
    if (busy || markdown.isBusy()) { event.preventDefault(); (activeTool === 'markdown' ? markdown.notify : notify)('Tunggu operasi file selesai sebelum menutup aplikasi.'); return; }
    if (summarize(rows).changed || markdown.isDirty()) {
      event.preventDefault();
      const description = markdown.isDirty() ? 'Ada perubahan Markdown yang belum disimpan. Perubahan tersebut dan draft rename yang belum diterapkan akan dibuang.' : 'Nama file belum berubah. Draft yang belum diterapkan akan dibuang.';
      if (await confirmAction('Tutup dan buang draft?', description, 'Tutup aplikasi')) { allowClose = true; await window.close(); }
    }
  }).catch(error => notify(`Peringatan saat menutup belum tersedia: ${error}`, 'error'));
  await refreshStatus();
  getVersion().then(version => {
    if (updater.state.status === 'idle') $('update-status').textContent = `Versi ${version}`;
  }).catch(() => {});
  updater.check();
  async function openPendingMarkdown() {
    const path = await invoke('take_pending_markdown');
    if (path) { showTool('markdown'); await markdown.openPath(path); }
  }
  await listen('markdown-open', openPendingMarkdown);
  await openPendingMarkdown();
} else { $('browser-note').hidden = false; }
updateUI();
