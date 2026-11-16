import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { markdown as markdownLanguage } from '@codemirror/lang-markdown';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import DOMPurify from 'dompurify';
import 'highlight.js/styles/github.css';
import './markdown.css';
import { parseMarkdown, diagramAllowed } from './markdown-render.js';
import { confirmAction } from './dialog.js';
import {
  createTab,
  findTabByPath,
  findTabById,
  isTabDirty,
  addTab,
  updateTab,
  closeTabState,
  switchTabState,
  hasDirtyTabs,
} from './markdown-tab-state.js';

const $ = id => document.getElementById(id);
let mermaidPromise;
function getMermaid() {
  mermaidPromise ||= import('mermaid').then(module => {
    const mermaid = module.default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      suppressErrorRendering: true,
      maxTextSize: 30000,
      theme: 'base',
      themeVariables: {
        fontFamily: 'Segoe UI, sans-serif',
        primaryColor: '#edf8f4',
        primaryTextColor: '#253a40',
        primaryBorderColor: '#087f70',
        lineColor: '#566d75',
        secondaryColor: '#e6f0f4'
      },
      flowchart: { htmlLabels: false, maxEdges: 500 }
    });
    return mermaid;
  });
  return mermaidPromise;
}

export function createMarkdown() {
  const native = isTauri();
  let tabs = [];
  let activeTabId = null;
  let busy = false;
  let mode = 'read';
  let revision = 0;
  let renderTimer;
  let suppress = false;
  let searchIndex = -1;

  const activeTab = () => findTabById(tabs, activeTabId) || null;
  const hasTabs = () => tabs.length > 0 && activeTabId !== null;

  const editability = new Compartment();
  const text = () => editor.state.doc.toString();
  const dirty = (tab = activeTab()) => {
    if (!tab) return false;
    return isTabDirty(tab, tab.id === activeTabId ? text() : undefined);
  };
  const anyDirty = () => hasDirtyTabs(tabs, activeTabId, text);

  const extensions = () => [
    basicSetup,
    markdownLanguage(),
    EditorView.lineWrapping,
    editability.of(EditorView.editable.of(!busy)),
    EditorView.contentAttributes.of({ 'aria-label': 'Source Markdown', spellcheck: 'false' }),
    EditorView.updateListener.of(update => {
      if (update.docChanged && !suppress) {
        updateUI();
        updateTabDirtyIndicators();
        queueRender();
      }
    })
  ];

  const editor = new EditorView({
    state: EditorState.create({ doc: '', extensions: extensions() }),
    parent: $('md-editor')
  });

  function notify(message = '', kind = 'info') {
    const notice = $('md-message');
    notice.className = `notice ${kind}`;
    notice.textContent = message;
    notice.hidden = !message;
    notice.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  }

  function setBusy(value) {
    busy = value;
    editor.dispatch({ effects: editability.reconfigure(EditorView.editable.of(!value)) });
    updateUI();
  }

  function updateTabDirtyIndicators() {
    const current = activeTab();
    if (!current) return;
    const tabEl = document.querySelector(`.md-tab[data-tab-id="${current.id}"]`);
    if (tabEl) {
      const dirtyBullet = tabEl.querySelector('.md-tab-dirty');
      if (dirtyBullet) {
        dirtyBullet.hidden = !dirty(current);
      }
    }
  }

  function renderTabBar() {
    const bar = $('md-tab-bar');
    const list = $('md-tab-list');
    if (!bar || !list) return;

    if (tabs.length === 0) {
      bar.hidden = true;
      list.replaceChildren();
      return;
    }

    bar.hidden = false;
    list.replaceChildren();

    for (const tab of tabs) {
      const tabEl = document.createElement('div');
      const isActive = tab.id === activeTabId;
      tabEl.className = `md-tab ${isActive ? 'active' : ''}`;
      tabEl.role = 'tab';
      tabEl.setAttribute('aria-selected', String(isActive));
      tabEl.dataset.tabId = tab.id;
      tabEl.title = tab.path || tab.name;

      const icon = document.createElement('i');
      icon.className = 'ph ph-file-md md-tab-icon';
      icon.setAttribute('aria-hidden', 'true');

      const title = document.createElement('span');
      title.className = 'md-tab-title';
      title.textContent = tab.name;

      const dirtyBullet = document.createElement('span');
      dirtyBullet.className = 'md-tab-dirty';
      dirtyBullet.textContent = '•';
      dirtyBullet.hidden = !dirty(tab);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'md-tab-close';
      closeBtn.type = 'button';
      closeBtn.textContent = '×';
      closeBtn.title = 'Tutup tab';
      closeBtn.setAttribute('aria-label', `Tutup ${tab.name}`);
      closeBtn.addEventListener('click', event => {
        event.stopPropagation();
        closeTab(tab.id);
      });

      tabEl.addEventListener('click', () => {
        if (tab.id !== activeTabId) {
          switchTab(tab.id);
        }
      });

      tabEl.addEventListener('auxclick', event => {
        if (event.button === 1) {
          event.preventDefault();
          event.stopPropagation();
          closeTab(tab.id);
        }
      });

      tabEl.append(icon, title, dirtyBullet, closeBtn);
      list.append(tabEl);

      if (isActive) {
        tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }
  }

  function updateUI() {
    const current = activeTab();
    const active = hasTabs();
    const isCurrentDirty = current ? dirty(current) : false;

    $('md-filename').textContent = current?.name || (active ? 'Tanpa judul.md' : 'Belum ada dokumen');
    $('md-dirty').hidden = !active || (!isCurrentDirty && !!current?.path);
    $('md-empty').hidden = active;
    $('md-body').hidden = !active;
    $('md-tab-bar').hidden = !active;

    $('md-new').disabled = busy;
    $('md-empty-new').disabled = busy;
    const tabNew = $('md-tab-new');
    if (tabNew) tabNew.disabled = busy;

    $('md-open').disabled = busy || !native;
    $('md-empty-open').disabled = busy || !native;
    $('md-save').disabled = busy || !native || !active || (!isCurrentDirty && !!current?.path);
    $('md-save-as').disabled = busy || !native || !active;
    $('md-save-copy').disabled = busy || !active;
    $('md-reload').disabled = busy || !active || !current?.path;
    $('md-outline-toggle').disabled = !active || mode === 'edit';
    $('md-search-toggle').disabled = !active;

    document.querySelectorAll('[data-mode]').forEach(button => {
      if (button.tagName !== 'BUTTON') return;
      button.disabled = !active;
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    });

    $('md-status').textContent = busy
      ? 'Memproses dokumen…'
      : !active
        ? 'Buka file atau buat dokumen baru.'
        : `${isCurrentDirty || !current?.path ? 'Belum disimpan' : 'Tersimpan'} · ${editor.state.doc.lines} baris · ${current?.lineEnding || 'LF'}`;

    $('md-file-path').textContent = current?.path || (active ? 'Belum memiliki lokasi' : 'Semua file tetap lokal');
    $('md-file-path').title = current?.path || '';
  }

  function setMode(value) {
    mode = value;
    const current = activeTab();
    if (current) {
      current.mode = value;
    }
    $('md-body').dataset.mode = mode;
    $('md-editor-pane').hidden = mode === 'read';
    $('md-preview-pane').hidden = mode === 'edit';
    $('md-outline').hidden = mode === 'edit' || $('md-outline-toggle').getAttribute('aria-pressed') === 'false';
    updateUI();
    editor.requestMeasure();
    queueRender();
  }

  function switchTab(nextTabId) {
    if (!nextTabId || nextTabId === activeTabId) return;
    const target = findTabById(tabs, nextTabId);
    if (!target) return;

    const result = switchTabState(tabs, activeTabId, nextTabId, editor.state, mode);
    tabs = result.tabs;
    activeTabId = result.activeTabId;

    suppress = true;
    if (target.editorState) {
      editor.setState(target.editorState);
    } else {
      const state = EditorState.create({ doc: target.baseline, extensions: extensions() });
      editor.setState(state);
      target.editorState = state;
    }
    suppress = false;

    setMode(target.mode || 'read');
    $('md-conflict').hidden = true;
    renderTabBar();
    updateUI();
    queueRender();

    if (target.mode !== 'read') {
      editor.focus();
    }
  }

  function showError(error) {
    if (error?.kind === 'conflict') $('md-conflict').hidden = false;
    notify(error?.message || String(error), 'error');
  }

  async function openPath(path, options = {}) {
    if (busy || !path) return false;

    const existing = findTabByPath(tabs, path);
    if (existing && !options.forceReload) {
      switchTab(existing.id);
      return true;
    }

    setBusy(true);
    try {
      const tabId = existing?.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
      const info = await invoke('open_markdown', { tabId, path });

      // Save current active tab state before activating new one
      const current = activeTab();
      if (current && current.id !== tabId) {
        current.editorState = editor.state;
        current.mode = mode;
      }

      suppress = true;
      const newState = EditorState.create({ doc: info.text || '', extensions: extensions() });
      editor.setState(newState);
      suppress = false;

      if (existing) {
        tabs = updateTab(tabs, tabId, {
          path: info.path,
          name: info.name,
          baseline: info.text || '',
          lineEnding: info.lineEnding,
          warning: info.warning,
          editorState: newState,
        });
      } else {
        const newTab = createTab({
          id: tabId,
          path: info.path,
          name: info.name,
          baseline: info.text || '',
          mode: 'read',
          editorState: newState,
          lineEnding: info.lineEnding,
          warning: info.warning,
        });
        tabs = addTab(tabs, newTab);
      }

      activeTabId = tabId;
      setMode('read');
      $('md-conflict').hidden = true;
      renderTabBar();
      updateUI();
      notify(info.warning || '');
      queueRender();
      return true;
    } catch (error) {
      showError(error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function chooseFile() {
    if (!native || busy) return;
    setBusy(true);
    let path;
    try {
      path = await open({
        multiple: false,
        directory: false,
        title: 'Buka Markdown',
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
      });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
    if (path) await openPath(path);
  }

  async function newDocument() {
    if (busy) return;
    setBusy(true);
    try {
      const tabId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      if (native) {
        await invoke('new_markdown_tab', { tabId });
      }

      const current = activeTab();
      if (current) {
        current.editorState = editor.state;
        current.mode = mode;
      }

      suppress = true;
      const newState = EditorState.create({ doc: '', extensions: extensions() });
      editor.setState(newState);
      suppress = false;

      const newTab = createTab({
        id: tabId,
        path: null,
        name: 'Tanpa judul.md',
        baseline: '',
        mode: 'edit',
        editorState: newState,
        lineEnding: 'LF',
      });

      tabs = addTab(tabs, newTab);
      activeTabId = tabId;
      setMode('edit');
      $('md-conflict').hidden = true;
      notify('');
      renderTabBar();
      updateUI();
      queueRender();
      editor.focus();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function closeTab(tabId) {
    if (busy || !tabId) return;
    const tab = findTabById(tabs, tabId);
    if (!tab) return;

    const isDirtyTab = tab.id === activeTabId ? dirty(tab) : isTabDirty(tab);
    if (isDirtyTab) {
      const proceed = await confirmAction(
        'Buang perubahan Markdown?',
        `Perubahan pada "${tab.name}" belum disimpan. File di perangkat tetap memakai versi yang terakhir disimpan.`,
        'Buang perubahan'
      );
      if (!proceed) return;
    }

    setBusy(true);
    try {
      if (native) {
        await invoke('close_markdown_tab', { tabId });
      }

      const result = closeTabState(tabs, activeTabId, tabId);
      tabs = result.tabs;

      if (tab.id === activeTabId) {
        if (result.activeTabId) {
          const nextTab = findTabById(tabs, result.activeTabId);
          activeTabId = result.activeTabId;
          suppress = true;
          editor.setState(nextTab.editorState || EditorState.create({ doc: nextTab.baseline, extensions: extensions() }));
          suppress = false;
          setMode(nextTab.mode || 'read');
          $('md-conflict').hidden = true;
        } else {
          activeTabId = null;
          suppress = true;
          editor.setState(EditorState.create({ doc: '', extensions: extensions() }));
          suppress = false;
          mode = 'read';
          $('md-conflict').hidden = true;
        }
      }

      renderTabBar();
      updateUI();
      queueRender();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function saveDocument(asCopy = false) {
    const current = activeTab();
    if (busy || !current || !native) return;
    setBusy(true);
    try {
      let token = null;
      if (asCopy || !current.path) {
        const defaultPath = asCopy && current.path
          ? current.path.replace(/\.(md|markdown)$/i, '-salinan.md')
          : current.path || 'Catatan.md';
        const path = await save({
          title: 'Simpan Markdown',
          defaultPath,
          filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
        });
        if (!path) return;
        const target = await invoke('prepare_markdown_save', { tabId: current.id, path });
        if (target.exists && !await confirmAction('Timpa file yang sudah ada?', `File ${target.path} sudah ada. Isinya akan diganti dengan dokumen ini.`, 'Timpa file')) return;
        token = target.token;
      }
      const info = await invoke('save_markdown', { tabId: current.id, text: text(), token });
      tabs = updateTab(tabs, current.id, {
        path: info.path,
        name: info.name,
        baseline: text(),
        lineEnding: info.lineEnding,
        warning: info.warning,
      });
      $('md-conflict').hidden = true;
      renderTabBar();
      updateUI();
      notify('Dokumen berhasil disimpan.', 'success');
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  function highlightSearch() {
    const preview = $('md-preview');
    for (const mark of preview.querySelectorAll('mark.md-search-match')) {
      mark.replaceWith(document.createTextNode(mark.textContent));
    }
    preview.normalize();
    const query = $('md-search').value.trim().toLowerCase();
    if (!query || $('md-search-bar').hidden) {
      $('md-search-count').textContent = '0 hasil';
      return;
    }
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement.closest('svg,button,.md-properties') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let count = 0;
    for (const node of nodes) {
      let remaining = node.textContent;
      const fragment = document.createDocumentFragment();
      let index;
      while (count < 500 && (index = remaining.toLowerCase().indexOf(query)) !== -1) {
        fragment.append(document.createTextNode(remaining.slice(0, index)));
        const mark = document.createElement('mark');
        mark.className = 'md-search-match';
        mark.textContent = remaining.slice(index, index + query.length);
        fragment.append(mark);
        remaining = remaining.slice(index + query.length);
        count++;
      }
      fragment.append(document.createTextNode(remaining));
      node.replaceWith(fragment);
    }
    searchIndex = -1;
    $('md-search-count').textContent = `${count}${count === 500 ? '+' : ''} hasil`;
  }

  function queueRender() {
    clearTimeout(renderTimer);
    ++revision;
    if (!hasTabs() || mode === 'edit') return;
    renderTimer = setTimeout(renderPreview, 220);
  }

  async function renderPreview() {
    const version = revision;
    const current = activeTab();
    const currentTabId = current?.id;
    const result = parseMarkdown(text());
    const preview = $('md-preview');
    preview.innerHTML = DOMPurify.sanitize(result.html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'iframe', 'form', 'object', 'embed'],
      FORBID_ATTR: ['style']
    });

    if (!preview.textContent.trim()) {
      preview.textContent = 'Dokumen masih kosong. Pilih Edit untuk mulai menulis.';
    }

    $('md-outline-list').replaceChildren();
    for (const heading of result.headings) {
      const button = document.createElement('button');
      button.className = 'md-outline-item';
      button.textContent = heading.text;
      button.dataset.level = Math.min(heading.level, 4);
      button.addEventListener('click', () => {
        if (matchMedia('(max-width: 760px)').matches || (mode === 'split' && matchMedia('(max-width: 1150px)').matches)) {
          $('md-outline-toggle').setAttribute('aria-pressed', 'false');
          $('md-outline').hidden = true;
        }
        document.getElementById(heading.id)?.scrollIntoView({ block: 'start' });
      });
      $('md-outline-list').append(button);
    }
    if (!result.headings.length) {
      $('md-outline-list').textContent = 'Heading dokumen akan muncul di sini.';
    }

    highlightSearch();

    const images = [...preview.querySelectorAll('img[data-md-image]')];
    for (const [index, image] of images.entries()) {
      if (index >= 64) {
        image.replaceWith(document.createTextNode('Batas 64 gambar per dokumen.'));
        continue;
      }
      let source;
      try {
        source = decodeURIComponent(image.dataset.mdImage);
      } catch {
        image.replaceWith(document.createTextNode('Alamat gambar tidak valid.'));
        continue;
      }
      invoke('markdown_image', { tabId: currentTabId, source })
        .then(uri => {
          if (version === revision) image.src = uri;
        })
        .catch(error => {
          if (version === revision) {
            const placeholder = document.createElement('span');
            placeholder.className = 'md-image-placeholder';
            placeholder.textContent = `${image.alt || 'Gambar'}: ${error?.message || 'tidak bisa dimuat'}`;
            image.replaceWith(placeholder);
          }
        });
    }

    for (const [index, source] of result.diagrams.entries()) {
      if (version !== revision) return;
      const figure = preview.querySelector(`[data-diagram-index="${index}"]`);
      if (!figure) continue;
      const body = figure.querySelector('.md-diagram-body');
      if (index >= 20 || !diagramAllowed(source)) {
        body.textContent = 'Diagram belum didukung atau melewati batas. Gunakan flowchart/sequence tanpa directive konfigurasi.';
        continue;
      }
      const staging = document.createElement('div');
      staging.className = 'md-diagram-staging';
      document.body.append(staging);
      try {
        const mermaid = await getMermaid();
        if (version !== revision) return;
        const { svg } = await mermaid.render(`diagram-${version}-${index}`, source, staging);
        if (version !== revision) return;
        body.innerHTML = DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ['foreignObject', 'image', 'script', 'a', 'use', 'animate', 'set']
        });
        body.querySelector('svg')?.setAttribute('aria-label', 'Diagram Mermaid');
        const controls = document.createElement('div');
        controls.className = 'md-diagram-controls';
        for (const [label, factor] of [['Perkecil diagram', 0.8], ['Perbesar diagram', 1.25]]) {
          const button = document.createElement('button');
          button.className = 'md-tool-button';
          button.textContent = label;
          button.addEventListener('click', () => {
            const graphic = body.querySelector('svg');
            const scale = Math.min(3, Math.max(0.5, Number(graphic.dataset.scale || 1) * factor));
            graphic.dataset.scale = scale;
            graphic.style.width = `${scale * 100}%`;
            graphic.style.maxWidth = 'none';
          });
          controls.append(button);
        }
        figure.append(controls);
      } catch {
        if (version === revision) {
          body.textContent = 'Diagram tidak bisa dirender. Periksa sintaks Mermaid di mode Edit.';
          figure.classList.add('md-diagram-error');
        }
      } finally {
        staging.remove();
      }
    }
  }

  document.querySelectorAll('button[data-mode]').forEach(button => {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  });
  for (const id of ['md-open', 'md-empty-open']) $(id).addEventListener('click', chooseFile);
  for (const id of ['md-new', 'md-empty-new']) $(id).addEventListener('click', newDocument);
  const tabNew = $('md-tab-new');
  if (tabNew) tabNew.addEventListener('click', newDocument);

  $('md-save').addEventListener('click', () => saveDocument());
  for (const id of ['md-save-as', 'md-save-copy']) $(id).addEventListener('click', () => saveDocument(true));
  $('md-reload').addEventListener('click', () => {
    const current = activeTab();
    if (current?.path) openPath(current.path, { forceReload: true });
  });

  $('md-outline-toggle').addEventListener('click', () => {
    const visible = $('md-outline-toggle').getAttribute('aria-pressed') !== 'true';
    $('md-outline-toggle').setAttribute('aria-pressed', String(visible));
    $('md-outline').hidden = !visible;
    editor.requestMeasure();
  });
  $('md-outline').addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      $('md-outline-toggle').setAttribute('aria-pressed', 'false');
      $('md-outline').hidden = true;
      $('md-outline-toggle').focus();
    }
  });

  $('md-font-size').addEventListener('change', () => {
    $('md-preview').style.fontSize = `${$('md-font-size').value}px`;
  });

  function toggleSearch(show) {
    $('md-search-bar').hidden = !show;
    $('md-search-toggle').setAttribute('aria-expanded', String(show));
    if (show) {
      if (mode === 'edit') setMode('split');
      $('md-search').focus();
    }
    highlightSearch();
  }
  $('md-search-toggle').addEventListener('click', () => toggleSearch($('md-search-bar').hidden));
  $('md-search-close').addEventListener('click', () => toggleSearch(false));
  $('md-search').addEventListener('input', highlightSearch);
  $('md-search-next').addEventListener('click', () => {
    const matches = $('md-preview').querySelectorAll('.md-search-match');
    if (matches.length) {
      searchIndex = (searchIndex + 1) % matches.length;
      matches[searchIndex].scrollIntoView({ block: 'center' });
    }
  });

  $('md-preview').addEventListener('click', async event => {
    const copy = event.target.closest('.md-copy');
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.parentElement.querySelector('code').textContent);
        copy.textContent = 'Disalin';
      } catch {
        notify('Kode belum bisa disalin. Pilih teks dan gunakan Ctrl C.', 'error');
      }
      return;
    }
    const link = event.target.closest('a');
    if (!link) return;
    event.preventDefault();
    try {
      const href = link.getAttribute('href');
      if (!href) return;
      if (href.startsWith('#')) {
        const anchor = href.slice(1);
        const anchorId = `md-${decodeURIComponent(anchor).toLowerCase().replace(/\s+/g, '-')}`;
        document.getElementById(anchorId)?.scrollIntoView({ block: 'start' });
        return;
      }
      if ((/^[a-z][a-z\d+.-]*:/i.test(href) && !/^https?:\/\//i.test(href)) || href.startsWith('//')) {
        notify('Jenis link ini belum didukung.');
        return;
      }
      const current = activeTab();
      const result = await invoke('open_external_target', { tabId: current?.id, target: href });
      if (result?.action === 'markdown' && result.path) {
        await openPath(result.path);
      }
    } catch (error) {
      showError(error);
    }
  });

  updateUI();
  renderTabBar();

  function keydown(event) {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'w') {
      event.preventDefault();
      if (activeTabId) closeTab(activeTabId);
    }
    if (key === 's') {
      event.preventDefault();
      saveDocument(event.shiftKey);
    }
    if (key === 'o') {
      event.preventDefault();
      chooseFile();
    }
    if (key === 'n') {
      event.preventDefault();
      newDocument();
    }
    if (key === 'f') {
      event.preventDefault();
      toggleSearch(true);
    }
  }

  return {
    isDirty: anyDirty,
    isBusy: () => busy,
    openPath,
    chooseFile,
    newDocument,
    closeTab,
    switchTab,
    saveDocument,
    notify,
    async drop(paths) {
      if (!paths || !paths.length) {
        notify('Tarik file Markdown untuk dibuka.', 'error');
        return;
      }
      for (const p of paths) {
        await openPath(p);
      }
    },
    keydown,
  };
}
