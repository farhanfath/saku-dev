import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, diagramAllowed } from '../src/markdown-render.js';

test('renders headings with unique anchors, tables, tasks, frontmatter, and diagram slots', () => {
  const result = parseMarkdown('---\ntitle: Demo\n---\n# Judul\n# Judul\n\n- [x] Selesai\n- [ ] Belum\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```mermaid\nflowchart LR\n A-->B\n```');
  assert.deepEqual(result.headings.map(h => h.id), ['md-judul', 'md-judul-1']);
  assert.match(result.html, /<table>/);
  assert.match(result.html, /type="checkbox" disabled/);
  assert.match(result.html, /Properti dokumen/);
  assert.equal(result.diagrams.length, 1);
});

test('raw HTML is escaped, javascript: links rejected, and web images render directly', () => {
  const { html } = parseMarkdown('<script>alert(1)</script>\n\n![remote](https://example.com/track.png)\n\n![local](images/a.png)\n\n[x](javascript:alert(1))');
  assert.doesNotMatch(html, /<script|href="javascript/i);
  assert.match(html, /<img src="https:\/\/example\.com\/track\.png" alt="remote" loading="lazy" onerror="this\.classList\.add\('md-image-error'\)">/);
  assert.match(html, /data-md-image="images\/a.png"/);
});

test('renders web images directly and marks local images for IPC loading', () => {
  const result = parseMarkdown('![Web](https://example.com/logo.png)\n![Local](./photo.png)\n![ProtoRel](//example.com/a.jpg)\n![Http](http://example.com/b.png)');
  assert.match(result.html, /<img src="https:\/\/example\.com\/logo\.png" alt="Web" loading="lazy" onerror="this\.classList\.add\('md-image-error'\)">/);
  assert.match(result.html, /<img src="\/\/example\.com\/a\.jpg" alt="ProtoRel" loading="lazy" onerror="this\.classList\.add\('md-image-error'\)">/);
  assert.match(result.html, /<img src="http:\/\/example\.com\/b\.png" alt="Http" loading="lazy" onerror="this\.classList\.add\('md-image-error'\)">/);
  assert.match(result.html, /<img data-md-image="\.\/photo\.png" alt="Local" loading="lazy">/);
  assert.doesNotMatch(result.html, /Gambar web tidak dimuat/);
});

test('properly escapes image attributes and rejects javascript: protocol', () => {
  const result = parseMarkdown('![Quotes "test" & <tag>](https://example.com/img.png?x=1&y=2)\n\n![XSS](javascript:alert(1))');
  assert.match(result.html, /<img src="https:\/\/example\.com\/img\.png\?x=1&amp;y=2" alt="Quotes &quot;test&quot; &amp; &lt;tag&gt;" loading="lazy" onerror="this\.classList\.add\('md-image-error'\)">/);
  assert.doesNotMatch(result.html, /<img[^>]+javascript/i);
  assert.match(result.html, /!\[XSS\]\(javascript:alert\(1\)\)/);
});

test('only bounded flowchart/sequence diagrams without config directives are accepted', () => {
  assert.ok(diagramAllowed('flowchart LR\nA-->B'));
  assert.ok(diagramAllowed('sequenceDiagram\nA->>B: Hi'));
  assert.equal(diagramAllowed('%%{init: {}}%%\nflowchart LR\nA-->B'), false);
  assert.equal(diagramAllowed('gantt\n title Schedule'), false);
  assert.equal(diagramAllowed('flowchart LR\n' + 'a'.repeat(30000)), false);
});
