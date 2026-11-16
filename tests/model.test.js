import test from 'node:test';
import assert from 'node:assert/strict';
import { splitName, summarize } from '../src/model.js';

test('extension protection preserves dotfiles and splits only the last suffix', () => {
  assert.deepEqual(splitName('.env'), { base: '.env', extension: '' });
  assert.deepEqual(splitName('archive.tar.gz'), { base: 'archive.tar', extension: '.gz' });
  assert.deepEqual(splitName('README'), { base: 'README', extension: '' });
  assert.deepEqual(splitName('foto.liburan.jpg'), { base: 'foto.liburan', extension: '.jpg' });
});

test('summary counts changed names and issues independently', () => {
  assert.deepEqual(summarize([
    { name: 'a.txt', newName: 'b.txt', issue: null },
    { name: 'same', newName: 'same', issue: 'missing file' },
    { name: 'c', newName: '', issue: 'invalid' },
  ]), { changed: 2, issues: 2 });
});
