import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';

export function parseMarkdown(source) {
  const headings = [];
  const diagrams = [];
  const used = new Map();
  const parser = new MarkdownIt({
    html: false, linkify: true,
    highlight(code, language) {
      return language && hljs.getLanguage(language) ? hljs.highlight(code, { language, ignoreIllegals: true }).value : '';
    },
  });
  const escape = parser.utils.escapeHtml;
  parser.inline.ruler.before('link', 'wikilink', (state, silent) => {
    const match = state.src.slice(state.pos).match(/^\[\[([^\]\n]+)\]\]/);
    if (!match) return false;
    if (!silent) {
      const [target, label = target] = match[1].split('|');
      const [file, anchor] = target.split('#');
      const href = file ? `${file.match(/\.md$/i) ? file : `${file}.md`}${anchor ? `#${anchor}` : ''}` : `#${anchor || ''}`;
      const opening = state.push('link_open', 'a', 1);
      opening.attrSet('href', encodeURI(href));
      state.push('text', '', 0).content = label;
      state.push('link_close', 'a', -1);
    }
    state.pos += match[0].length;
    return true;
  });
  parser.core.ruler.push('document_structure', state => {
    state.tokens.forEach((token, index) => {
      if (token.type === 'heading_open') {
        const inline = state.tokens[index + 1];
        const text = (inline.children || []).filter(t => ['text', 'code_inline'].includes(t.type)).map(t => t.content).join('') || inline.content;
        const base = text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-') || 'bagian';
        const count = used.get(base) || 0;
        used.set(base, count + 1);
        const id = `md-${base}${count ? `-${count}` : ''}`;
        token.attrSet('id', id);
        headings.push({ id, text, level: Number(token.tag.slice(1)) });
      }
      if (token.type === 'list_item_open') {
        const inline = state.tokens[index + 2];
        const first = inline?.type === 'inline' && inline.children?.[0];
        const check = first?.type === 'text' && first.content.match(/^\[([ xX])\]\s/);
        if (check) {
          first.content = first.content.slice(check[0].length);
          const checkbox = new state.Token('html_inline', '', 0);
          checkbox.content = `<input type="checkbox" disabled aria-label="${check[1] === ' ' ? 'Belum selesai' : 'Selesai'}"${check[1] === ' ' ? '' : ' checked'}> `;
          inline.children.unshift(checkbox);
        }
      }
    });
  });
  const fence = parser.renderer.rules.fence;
  parser.renderer.rules.fence = (tokens, index, options, env, renderer) => {
    if (tokens[index].info.trim() !== 'mermaid') return `<div class="md-code-block"><button class="md-copy" type="button">Salin kode</button>${fence(tokens, index, options, env, renderer)}</div>`;
    const diagramIndex = diagrams.push(tokens[index].content) - 1;
    return `<figure class="md-diagram" data-diagram-index="${diagramIndex}"><figcaption>Diagram Mermaid</figcaption><div class="md-diagram-body">Menyiapkan diagram…</div></figure>`;
  };
  parser.renderer.rules.image = (tokens, index) => {
    const token = tokens[index];
    const source = token.attrGet('src') || '';
    const alt = parser.renderer.renderInlineAsText(token.children, parser.options, {});
    if (/^(?:https?:)?\/\//i.test(source)) {
      return `<img src="${escape(source)}" alt="${escape(alt)}" loading="lazy" onerror="this.classList.add('md-image-error')">`;
    }
    return `<img data-md-image="${escape(source)}" alt="${escape(alt)}" loading="lazy">`;
  };
  let frontmatter = '';
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (match) { frontmatter = `<details class="md-properties"><summary>Properti dokumen</summary><pre>${escape(match[1])}</pre></details>`; source = source.slice(match[0].length); }
  const html = frontmatter + parser.render(source);
  return { html, headings, diagrams };
}

export function diagramAllowed(source) {
  return source.length <= 30000 && !/%%\s*\{/.test(source) && /^(?:\s|%%[^\n]*\n)*(?:flowchart\s|graph\s|sequenceDiagram\b)/.test(source);
}
