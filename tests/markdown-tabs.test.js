import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTab,
  getBasename,
  normalizePath,
  findTabByPath,
  findTabById,
  isTabDirty,
  addTab,
  updateTab,
  closeTabState,
  switchTabState,
  hasDirtyTabs,
} from '../src/markdown-tab-state.js';

test('createTab initializes defaults for untitled document', () => {
  const tab = createTab({ id: 'test-uuid-1' });
  assert.equal(tab.id, 'test-uuid-1');
  assert.equal(tab.path, null);
  assert.equal(tab.name, 'Tanpa judul.md');
  assert.equal(tab.baseline, '');
  assert.equal(tab.mode, 'edit');
  assert.equal(tab.lineEnding, 'LF');
  assert.equal(tab.editorState, null);
});

test('createTab initializes from file path with read mode', () => {
  const tab = createTab({
    id: 'test-uuid-2',
    path: 'D:\\notes\\proyek-saku.md',
    baseline: '# Proyek Saku',
    lineEnding: 'CRLF',
  });
  assert.equal(tab.id, 'test-uuid-2');
  assert.equal(tab.path, 'D:\\notes\\proyek-saku.md');
  assert.equal(tab.name, 'proyek-saku.md');
  assert.equal(tab.baseline, '# Proyek Saku');
  assert.equal(tab.mode, 'read');
  assert.equal(tab.lineEnding, 'CRLF');
});

test('getBasename and normalizePath handle Windows and POSIX separators', () => {
  assert.equal(getBasename('C:\\Users\\dev\\notes.md'), 'notes.md');
  assert.equal(getBasename('/home/dev/document.markdown'), 'document.markdown');
  assert.equal(getBasename(''), 'Tanpa judul.md');
  assert.equal(getBasename(null), 'Tanpa judul.md');

  assert.equal(normalizePath('C:\\Docs\\Report.MD'), 'c:\\docs\\report.md');
  assert.equal(normalizePath('c:/docs/report.md'), 'c:\\docs\\report.md');
});

test('findTabByPath matches existing paths accurately', () => {
  const tab1 = createTab({ id: '1', path: 'D:\\notes\\file1.md' });
  const tab2 = createTab({ id: '2', path: 'D:\\notes\\file2.md' });
  const tab3 = createTab({ id: '3' }); // untitled

  const tabs = [tab1, tab2, tab3];

  assert.equal(findTabByPath(tabs, 'D:\\notes\\file1.md')?.id, '1');
  assert.equal(findTabByPath(tabs, 'd:/notes/file1.md')?.id, '1');
  assert.equal(findTabByPath(tabs, 'D:\\notes\\file2.md')?.id, '2');
  assert.equal(findTabByPath(tabs, 'D:\\notes\\nonexistent.md'), undefined);
  assert.equal(findTabByPath(tabs, null), undefined);
});

test('findTabById locates tab by unique ID', () => {
  const tab1 = createTab({ id: 'tab-alpha' });
  const tab2 = createTab({ id: 'tab-beta' });
  const tabs = [tab1, tab2];

  assert.equal(findTabById(tabs, 'tab-alpha')?.id, 'tab-alpha');
  assert.equal(findTabById(tabs, 'tab-beta')?.id, 'tab-beta');
  assert.equal(findTabById(tabs, 'tab-gamma'), undefined);
});

test('addTab and updateTab are immutable', () => {
  const tab1 = createTab({ id: '1', name: 'File 1' });
  const tab2 = createTab({ id: '2', name: 'File 2' });
  const tabs = [tab1];

  const added = addTab(tabs, tab2);
  assert.equal(tabs.length, 1);
  assert.equal(added.length, 2);
  assert.equal(added[1].id, '2');

  const updated = updateTab(added, '1', { name: 'File 1 Renamed', baseline: 'Hello' });
  assert.equal(added[0].name, 'File 1');
  assert.equal(updated[0].name, 'File 1 Renamed');
  assert.equal(updated[0].baseline, 'Hello');
});

test('isTabDirty accurately detects modifications', () => {
  const tab = createTab({ id: '1', baseline: '# Original' });

  assert.equal(isTabDirty(tab, '# Original'), false);
  assert.equal(isTabDirty(tab, '# Modified'), true);

  // With mock editorState object
  const tabWithState = {
    ...tab,
    editorState: {
      doc: {
        toString() { return '# In-Editor Content'; }
      }
    }
  };
  assert.equal(isTabDirty(tabWithState), true);

  const cleanTabWithState = {
    ...tab,
    editorState: {
      doc: {
        toString() { return '# Original'; }
      }
    }
  };
  assert.equal(isTabDirty(cleanTabWithState), false);
});

test('switchTabState persists current editor state and activates new tab', () => {
  const tab1 = createTab({ id: '1', mode: 'read' });
  const tab2 = createTab({ id: '2', mode: 'edit' });
  const tabs = [tab1, tab2];

  const mockEditorState = { doc: { toString: () => 'edited content' } };
  const result = switchTabState(tabs, '1', '2', mockEditorState, 'split');

  assert.equal(result.activeTabId, '2');
  const savedTab1 = result.tabs.find(t => t.id === '1');
  assert.equal(savedTab1.editorState, mockEditorState);
  assert.equal(savedTab1.mode, 'split');
});

test('closeTabState handles closing inactive tab', () => {
  const tab1 = createTab({ id: '1' });
  const tab2 = createTab({ id: '2' });
  const tab3 = createTab({ id: '3' });
  const tabs = [tab1, tab2, tab3];

  const result = closeTabState(tabs, '1', '2');
  assert.equal(result.tabs.length, 2);
  assert.equal(result.activeTabId, '1'); // remains '1'
  assert.deepEqual(result.tabs.map(t => t.id), ['1', '3']);
  assert.equal(result.closedTab.id, '2');
});

test('closeTabState handles closing active tab at beginning/middle', () => {
  const tab1 = createTab({ id: '1' });
  const tab2 = createTab({ id: '2' });
  const tab3 = createTab({ id: '3' });
  const tabs = [tab1, tab2, tab3];

  // Close active tab1 (index 0) -> active becomes tab2 (new index 0)
  const result1 = closeTabState(tabs, '1', '1');
  assert.equal(result1.tabs.length, 2);
  assert.equal(result1.activeTabId, '2');

  // Close active tab2 in [tab1, tab2, tab3] -> active becomes tab3 (index 1 of remaining [tab1, tab3])
  const result2 = closeTabState(tabs, '2', '2');
  assert.equal(result2.tabs.length, 2);
  assert.equal(result2.activeTabId, '3');
});

test('closeTabState handles closing active tab at the end', () => {
  const tab1 = createTab({ id: '1' });
  const tab2 = createTab({ id: '2' });
  const tabs = [tab1, tab2];

  // Close active tab2 (last tab) -> active falls back to tab1
  const result = closeTabState(tabs, '2', '2');
  assert.equal(result.tabs.length, 1);
  assert.equal(result.activeTabId, '1');
});

test('closeTabState handles closing the last remaining tab', () => {
  const tab1 = createTab({ id: '1' });
  const tabs = [tab1];

  const result = closeTabState(tabs, '1', '1');
  assert.equal(result.tabs.length, 0);
  assert.equal(result.activeTabId, null);
  assert.equal(result.closedTab.id, '1');
});

test('hasDirtyTabs detects dirty tabs across collection', () => {
  const tab1 = createTab({ id: '1', baseline: 'A' });
  const tab2 = createTab({
    id: '2',
    baseline: 'B',
    editorState: { doc: { toString: () => 'B modified' } }
  });
  const tabs = [tab1, tab2];

  // When active is tab1 and its current text is clean, but tab2 is dirty:
  assert.equal(hasDirtyTabs(tabs, '1', () => 'A'), true);

  // When both are clean:
  const cleanTab2 = { ...tab2, editorState: { doc: { toString: () => 'B' } } };
  assert.equal(hasDirtyTabs([tab1, cleanTab2], '1', () => 'A'), false);

  // When active tab1 is dirty:
  assert.equal(hasDirtyTabs([tab1, cleanTab2], '1', () => 'A modified'), true);
});
