export function splitName(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? { base: name.slice(0, dot), extension: name.slice(dot) } : { base: name, extension: '' };
}

export function sizeLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function summarize(rows) {
  return { changed: rows.filter(row => row.newName !== row.name).length, issues: rows.filter(row => row.issue).length };
}
