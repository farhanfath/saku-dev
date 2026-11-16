export function getBasename(path) {
  if (!path) return 'Tanpa judul.md';
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.pop() || 'Tanpa judul.md';
}

export function normalizePath(path) {
  if (!path) return '';
  return path.replace(/\//g, '\\').toLowerCase();
}

export function createTab({
  id = (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`),
  path = null,
  name = null,
  baseline = '',
  mode = path ? 'read' : 'edit',
  editorState = null,
  lineEnding = 'LF',
  warning = null,
} = {}) {
  return {
    id,
    path: path || null,
    name: name || getBasename(path),
    baseline: baseline ?? '',
    mode: mode || (path ? 'read' : 'edit'),
    editorState: editorState || null,
    lineEnding: lineEnding || 'LF',
    warning: warning || null,
  };
}

export function findTabByPath(tabs, path) {
  if (!path || !Array.isArray(tabs)) return undefined;
  const target = normalizePath(path);
  return tabs.find(tab => tab.path && normalizePath(tab.path) === target);
}

export function findTabById(tabs, id) {
  if (!id || !Array.isArray(tabs)) return undefined;
  return tabs.find(tab => tab.id === id);
}

export function isTabDirty(tab, currentDocText) {
  if (!tab) return false;
  if (currentDocText !== undefined) {
    return currentDocText !== (tab.baseline ?? '');
  }
  if (tab.editorState?.doc) {
    return tab.editorState.doc.toString() !== (tab.baseline ?? '');
  }
  return false;
}

export function addTab(tabs, newTab) {
  return [...(tabs || []), newTab];
}

export function updateTab(tabs, tabId, updates) {
  return (tabs || []).map(tab => {
    if (tab.id === tabId) {
      return { ...tab, ...updates };
    }
    return tab;
  });
}

export function switchTabState(tabs, currentActiveId, nextTabId, currentEditorState, currentMode) {
  const updatedTabs = (tabs || []).map(tab => {
    if (tab.id === currentActiveId) {
      return {
        ...tab,
        ...(currentEditorState !== undefined ? { editorState: currentEditorState } : {}),
        ...(currentMode !== undefined ? { mode: currentMode } : {}),
      };
    }
    return tab;
  });

  return {
    tabs: updatedTabs,
    activeTabId: nextTabId,
  };
}

export function closeTabState(tabs, activeTabId, tabIdToClose) {
  const closedTab = (tabs || []).find(t => t.id === tabIdToClose);
  const remainingTabs = (tabs || []).filter(t => t.id !== tabIdToClose);

  if (activeTabId !== tabIdToClose) {
    return {
      tabs: remainingTabs,
      activeTabId,
      closedTab,
    };
  }

  if (remainingTabs.length === 0) {
    return {
      tabs: remainingTabs,
      activeTabId: null,
      closedTab,
    };
  }

  const closedIndex = (tabs || []).findIndex(t => t.id === tabIdToClose);
  let nextActiveId;
  if (closedIndex < remainingTabs.length) {
    nextActiveId = remainingTabs[closedIndex].id;
  } else {
    nextActiveId = remainingTabs[remainingTabs.length - 1].id;
  }

  return {
    tabs: remainingTabs,
    activeTabId: nextActiveId,
    closedTab,
  };
}

export function hasDirtyTabs(tabs, activeTabId, getActiveDocText) {
  if (!Array.isArray(tabs) || tabs.length === 0) return false;
  return tabs.some(tab => {
    if (tab.id === activeTabId && typeof getActiveDocText === 'function') {
      return isTabDirty(tab, getActiveDocText());
    }
    return isTabDirty(tab);
  });
}
