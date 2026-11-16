# Markdown Multi-Tab & Asset/Attachment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan sistem multi-tab dengan antarmuka modern (ikon, judul, indikator dirty, tombol tutup per-tab, dan tombol `+` tab baru) serta dukungan pemuatan gambar (lokal & web) dan pembukaan tautan file attachment lokal pada subsistem Markdown Saku.

**Architecture:** Frontend mengelola state array tab, activeTabId, CodeMirror state per-tab, dan merender tab bar di atas workspace. Backend Rust mengelola `HashMap<TabId, Document>` untuk isolasi safe-save dan deteksi konflik per tab, menyediakan handler pemuatan gambar fleksibel (Base64 data URI), dan pembuka attachment file lokal via `ShellExecuteW`.

**Tech Stack:** Rust (Tauri 2, Windows API `ShellExecuteW`/`ReplaceFileW`), JavaScript (ES modules, CodeMirror 6, Markdown-it), CSS, Vite.

**Spec:** [docs/superpowers/specs/2026-11-12-markdown-multitab-assets-design.md](file:///D:/developer/desktop-local-tools/docs/superpowers/specs/2026-11-12-markdown-multitab-assets-design.md)

## Global Constraints

- Platform target: Windows x64.
- Encoding dokumen: UTF-8 (dengan/tanpa BOM) dan deteksi line-ending LF/CRLF.
- Batas memori: Dokumen teks maks 8 MB, gambar lokal maks 5 MB.
- Format gambar lokal didukung: png, jpg, jpeg, gif, webp, bmp, svg.
- Desain antarmuka: Mengikuti tema warna Petrol/Teal Saku, bahasa Indonesia pada seluruh copy aksi/status, dan responsive layout.

---

### Task 1: Rust Backend Multi-Tab Store & Document Commands

**Files:**
- Modify: `src-tauri/src/markdown.rs`
- Modify: `src-tauri/src/main.rs`
- Test: `src-tauri/src/markdown.rs` (mod tests)

**Interfaces:**
- Consumes: `engine::{stamp, display_path, move_file, Stamp}`
- Produces:
  - `open_markdown(tab_id: String, path: String) -> Result<DocumentInfo>`
  - `new_markdown_tab(tab_id: String) -> Result<()>`
  - `prepare_markdown_save(tab_id: String, path: String) -> Result<SaveInfo>`
  - `save_markdown(tab_id: String, text: String, token: Option<String>) -> Result<DocumentInfo>`
  - `close_markdown_tab(tab_id: String) -> Result<()>`

- [ ] **Step 1: Write the failing Rust tests for multi-tab store in `src-tauri/src/markdown.rs`**

Tambahkan unit test di `src-tauri/src/markdown.rs`:
```rust
#[test]
fn multitab_store_isolates_documents() {
    let mut store = MarkdownStore::default();
    let dir = tempfile::tempdir().unwrap();
    let file1 = dir.path().join("doc1.md");
    let file2 = dir.path().join("doc2.md");
    fs::write(&file1, "Konten Dokumen Satu").unwrap();
    fs::write(&file2, "Konten Dokumen Dua").unwrap();

    let info1 = store.open_tab("tab-1", &file1).unwrap();
    let info2 = store.open_tab("tab-2", &file2).unwrap();

    assert_eq!(info1.text, "Konten Dokumen Satu");
    assert_eq!(info2.text, "Konten Dokumen Dua");

    let saved1 = store.save_tab("tab-1", "Dokumen Satu Diedit", None).unwrap();
    assert_eq!(saved1.text, "Dokumen Satu Diedit");

    // Pastikan tab-2 tidak terpengaruh
    assert_eq!(store.documents.get("tab-2").unwrap().version.bytes, b"Konten Dokumen Dua");

    store.close_tab("tab-1").unwrap();
    assert!(!store.documents.contains_key("tab-1"));
    assert!(store.documents.contains_key("tab-2"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --test-threads=1 multitab_store_isolates_documents`
Expected: FAIL dengan pesan method `open_tab` / `save_tab` belum ada atau `MarkdownStore` belum mendukung field `documents`.

- [ ] **Step 3: Implement multi-tab store in `src-tauri/src/markdown.rs` and register commands in `src-tauri/src/main.rs`**

Perbarui `MarkdownStore` dengan `HashMap<String, Document>` dan `HashMap<String, SaveTarget>`.
Implementasikan method:
- `open_tab(&mut self, tab_id: &str, path: &Path) -> Result<DocumentInfo>`
- `new_tab(&mut self, tab_id: &str) -> Result<()>`
- `prepare_tab(&mut self, tab_id: &str, path: &Path) -> Result<SaveInfo>`
- `save_tab(&mut self, tab_id: &str, text: &str, token: Option<String>) -> Result<DocumentInfo>`
- `close_tab(&mut self, tab_id: &str) -> Result<()>`
Dan Tauri command wrapper yang menerima parameter `tab_id: String`. Register `close_markdown_tab` dan `new_markdown_tab` pada `main.rs`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --test-threads=1`
Expected: PASS untuk seluruh 15 tes Rust.

- [ ] **Step 5: Checkpoint & clippy check**

Run: `cargo clippy --all-targets -- -D warnings`
Expected: Clean tanpa error dan warnings.

---

### Task 2: Rust Asset Image Loader & External Target Opener

**Files:**
- Modify: `src-tauri/src/markdown.rs`
- Modify: `src-tauri/src/main.rs`
- Test: `src-tauri/src/markdown.rs` (mod tests)

**Interfaces:**
- Consumes: `windows_sys::Win32::UI::Shell::ShellExecuteW`
- Produces:
  - `markdown_image(tab_id: Option<String>, source: String) -> Result<String>`
  - `open_external_target(tab_id: Option<String>, target: String) -> Result<ExternalTargetResult>`

- [ ] **Step 1: Write failing Rust tests for flexible image paths and external targets**

```rust
#[test]
fn image_loads_from_absolute_and_relative_paths() {
    let mut store = MarkdownStore::default();
    let dir = tempfile::tempdir().unwrap();
    let parent = dir.path().join("assets");
    fs::create_dir(&parent).unwrap();
    let img_path = parent.join("test.png");
    // Minimal valid 1x1 PNG
    fs::write(&img_path, &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).unwrap();

    let doc_dir = dir.path().join("sub");
    fs::create_dir(&doc_dir).unwrap();
    let doc_path = doc_dir.join("note.md");
    fs::write(&doc_path, "test").unwrap();
    store.open_tab("t1", &doc_path).unwrap();

    // Relative with parent traversal
    let data_uri = store.image(Some("t1"), "../assets/test.png").unwrap();
    assert!(data_uri.starts_with("data:image/png;base64,"));

    // Absolute path
    let data_uri_abs = store.image(Some("t1"), img_path.to_str().unwrap()).unwrap();
    assert!(data_uri_abs.starts_with("data:image/png;base64,"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --test-threads=1 image_loads_from_absolute_and_relative_paths`
Expected: FAIL dengan "Gambar harus berada di folder dokumen" atau error canonicalize.

- [ ] **Step 3: Implement flexible image resolver and external target opener in `src-tauri/src/markdown.rs`**

- Perbarui `image(&self, tab_id: Option<&str>, source: &str)`:
  - Cari base directory dari dokumen `tab_id` jika path relatif.
  - Jika absolut, langsung canonicalize path absolut.
  - Hilangkan syarat `starts_with(root)`. Izinkan pembacaan file gambar di disk lokal selama path ada dan ekstensi valid (`png`, `jpg`, `jpeg`, `gif`, `webp`, `bmp`, `svg`).
- Implementasikan `open_external_target`:
  - `http://` / `https://` -> `open_browser`
  - `.md` / `.markdown` -> Kembalikan `{ action: "open_markdown_file", path: canonical_path }`
  - Ekstensi lainnya (PDF, DOCX, gambar, zip, dll) -> Jalankan `ShellExecuteW(..., "open", wide_path, ...)` dan kembalikan `{ action: "opened_externally", path }`.
- Daftarkan `open_external_target` pada `src-tauri/src/main.rs`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --test-threads=1`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `cargo clippy --all-targets -- -D warnings`
Expected: PASS.

---

### Task 3: Frontend Image Rendering & Web/Local Link Parsing

**Files:**
- Modify: `src/markdown-render.js`
- Modify: `tests/markdown-render.test.js`

**Interfaces:**
- Consumes: Markdown-it parser
- Produces:
  - `parseMarkdown(source)` menghasilkan `<img>` dengan `src` langsung untuk web URLs (`http://`, `https://`) dan `data-md-image` untuk path lokal.

- [ ] **Step 1: Write failing test in `tests/markdown-render.test.js`**

```javascript
test('renders web images directly and marks local images for IPC loading', () => {
  const result = parseMarkdown('![Web](https://example.com/logo.png)\n![Local](./photo.png)');
  assert.ok(result.html.includes('src="https://example.com/logo.png"'));
  assert.ok(result.html.includes('data-md-image="./photo.png"'));
  assert.ok(!result.html.includes('Gambar web tidak dimuat'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/markdown-render.test.js`
Expected: FAIL (karena rule image saat ini menghasilkan placeholder "Gambar web tidak dimuat").

- [ ] **Step 3: Update `src/markdown-render.js`**

Perbarui parser rule `image`:
```javascript
  parser.renderer.rules.image = (tokens, index) => {
    const token = tokens[index];
    const source = token.attrGet('src') || '';
    const alt = parser.renderer.renderInlineAsText(token.children, parser.options, {});
    if (/^(?:https?:)?\/\//i.test(source)) {
      return `<img src="${escape(source)}" alt="${escape(alt)}" loading="lazy" onerror="this.classList.add('md-image-error')">`;
    }
    return `<img data-md-image="${escape(source)}" alt="${escape(alt)}" loading="lazy">`;
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/markdown-render.test.js`
Expected: PASS.

---

### Task 4: Frontend Multi-Tab State Management & UI Component

**Files:**
- Create: `tests/markdown-tabs.test.js`
- Modify: `src/markdown.js`
- Modify: `src/markdown.css`
- Modify: `index.html`

**Interfaces:**
- Consumes: `open_markdown`, `new_markdown_tab`, `save_markdown`, `close_markdown_tab`, `open_external_target`, `markdown_image`
- Produces:
  - Tab Bar UI di atas Markdown workspace dengan icon, title, dirty indicator, close button, dan `+` new tab button.
  - Tab session management: `createTab`, `switchTab`, `closeTab`, `updateActiveTabUI`.

- [ ] **Step 1: Write unit test in `tests/markdown-tabs.test.js` for tab collection logic**

Tes fungsi murni tab collection (penambahan tab, pencarian path duplikat, aktivasi tab, dan dirty status).

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/markdown-tabs.test.js`
Expected: FAIL (file/fungsi belum diimplementasikan).

- [ ] **Step 3: Implement Tab Bar DOM & Styling**

- Di `index.html`: Tambahkan `<nav id="md-tab-bar" class="md-tab-bar" aria-label="Tab Dokumen"><div id="md-tab-list" class="md-tab-list"></div><button id="md-tab-new" class="md-tab-new" type="button" title="Dokumen baru (Ctrl+N)">+</button></nav>`.
- Di `src/markdown.css`: Tambahkan styling `.md-tab-bar`, `.md-tab`, `.md-tab-active`, `.md-tab-title`, `.md-tab-dirty`, `.md-tab-close`, `.md-tab-new`. Desain rapi sesuai screenshot referensi user (ikon dokumen, teks judul, dot dirty, tombol x, dan plus button).

- [ ] **Step 4: Implement Multi-Tab Logic in `src/markdown.js`**

- Kelola array `tabs = []` dan `activeTabId`.
- Setiap tab menyimpan: `id, path, name, baseline, mode, editorState, lineEnding`.
- Buka file: Jika `path` sudah ada di `tabs`, panggil `switchTab(tab.id)`. Jika belum, buat tab baru, invoke `open_markdown`, lalu set tab aktif.
- Switch tab: Ganti editor state (`editor.setState(tab.editorState)`), render preview tab baru, sinkronkan toolbar dan status.
- Tutup tab: Jika dirty, tampilkan konfirmasi `confirmAction`. Jika disetujui, panggil `close_markdown_tab` ke Rust dan hapus tab dari array. Jika semua tab habis, tampilkan empty state.
- Tombol `+` / `newDocument`: Buat tab "Tanpa judul.md" baru dengan UUID baru, mode Edit.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node tests/markdown-tabs.test.js` dan `node tests/markdown-render.test.js`
Expected: PASS.

---

### Task 5: Integration with Single-Instance Handoff & Window Close Lifecycle

**Files:**
- Modify: `src/main.js`
- Modify: `src/markdown.js`
- Test: `tests/desktop-close.mjs`

**Interfaces:**
- Consumes: `markdown.isDirty()`, `markdown.openPath(path)`
- Produces:
  - Pemeriksaan dirty seluruh tab saat penutupan aplikasi (Window close requested).
  - Pembukaan file dari argumen CLI / single-instance handoff ke tab baru di Saku.

- [ ] **Step 1: Write/Update Close & Dirty Test in `tests/desktop-close.mjs`**

Periksa skenario penutupan jendela saat tab Markdown dalam keadaan kotor: konfirmasi muncul, pembatalan mempertahankan jendela, dan persetujuan keluar menutup proses.

- [ ] **Step 2: Update `src/markdown.js` and `src/main.js`**

- `markdown.isDirty()` mengembalikan `true` jika ADA setidaknya satu tab yang dirty.
- Handler single-instance di `main.js`: Saat menerima path file Markdown baru dari instance kedua, panggil `markdown.openPath(path)` yang akan menambahkan tab baru (atau switch ke tab tersebut jika sudah terbuka) dan bawa jendela ke depan.

- [ ] **Step 3: Run close regression test**

Run: `node tests/desktop-close.mjs`
Expected: PASS.

---

### Task 6: Native Desktop Smoke Testing & Verification

**Files:**
- Modify: `tests/desktop-markdown.mjs`

**Interfaces:**
- Consumes: Saku desktop build (WebView2 IPC)
- Produces: End-to-end verification report

- [ ] **Step 1: Extend `tests/desktop-markdown.mjs` to test Multi-Tab and Asset loading**

Uji alur nyata melalui IPC desktop:
1. Buka `doc1.md` -> tab 1 aktif.
2. Buka `doc2.md` -> tab 2 ditambahkan, tab 2 aktif.
3. Klik tab 1 -> switch ke doc1.
4. Klik tombol `+` -> tab 3 "Tanpa judul.md" dibuat dalam mode Edit.
5. Edit tab 3 -> indikator dirty `•` muncul di tab 3.
6. Coba tutup tab 3 -> dialog konfirmasi muncul, Escape membatalkan penutupan tab.
7. Render dokumen berisi gambar lokal (termasuk folder parent `../`) dan web -> gambar terisi src data URI.
8. Tutup seluruh tab -> antarmuka menampilkan empty state dengan tombol Buka / Dokumen Baru.
9. Keluar aplikasi bersih hingga proses exit code 0.

- [ ] **Step 2: Run all test suites**

1. `cargo test -- --test-threads=1`
2. `cargo fmt --check`
3. `cargo clippy --all-targets -- -D warnings`
4. `npm.cmd run test:unit` (atau `node tests/*.test.js`)
5. `npm.cmd run test:desktop`

Expected: Seluruh tes lulus tanpa regresi pada Batch Rename maupun Markdown.

- [ ] **Step 3: Build release binary & installer**

Run: `npm.cmd run desktop:build`
Expected: Build sukses menghasilkan `saku.exe` dan installer NSIS terbaru.
