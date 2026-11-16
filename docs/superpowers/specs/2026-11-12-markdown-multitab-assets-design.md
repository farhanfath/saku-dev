# Design Spec: Markdown Multi-Tab & Asset/Attachment Handling

**Date:** 2026-11-12  
**Status:** Approved by User  
**Target Product:** Saku Desktop (Windows x64)

---

## 1. Context & Objectives

Aplikasi Saku versi 0.2.1 telah memiliki fitur dasar Markdown viewer/editor dengan mode Baca/Edit/Split, preview diagram Mermaid, dan penyimpanan atomik aman. Namun, penggunaan sehari-hari menghadapi dua keterbatasan utama:
1. **Pemuatan Asset & Link:** File Markdown sering menyertakan gambar lokal (baik path absolut maupun path relatif di luar folder dokumen), gambar dari web, serta link ke dokumen lokal lain (PDF, DOCX, ZIP, dsb.). Saat ini gambar web dan path absolut diblokir, serta link lokal non-MD belum dapat dibuka.
2. **Multi-File & Multi-Tab:** Saat membuka lebih dari satu file Markdown, dokumen yang baru menimpa dokumen sebelumnya (single-document). User menginginkan pengalaman tab seperti peramban/editor modern (tab bar di atas dengan ikon dokumen, judul file, indikator dirty, tombol tutup `x`, dan tombol `+` untuk tab baru).

Tujuan spesifikasi ini adalah merombak subsistem Markdown menjadi **multi-tab** dengan arsitektur **Pendekatan A (Frontend Tab State + Rust Document Map by Tab ID)** serta memperluas dukungan gambar (lokal & web) dan pembukaan link attachment ke aplikasi bawaan Windows.

---

## 2. User Experience & UI Design

### 2.1 Tab Bar Visual Layout
Sesuai referensi visual user, tab bar ditempatkan di bagian atas workspace Markdown (di atas toolbar aksi/editor):
* **Tab Item:**
  * **Icon:** Ikon representasi dokumen Markdown kecil di sebelah kiri.
  * **Title:** Nama file dokumen (misal `Catatan.md`, atau `Tanpa judul.md` untuk dokumen baru).
  * **Dirty Indicator:** Tanda bulatan (`•`) yang muncul ketika dokumen memiliki perubahan yang belum disimpan.
  * **Close Button (`x`):** Tombol kecil di ujung kanan setiap tab untuk menutup tab tersebut.
  * **Active State:** Tab yang sedang aktif ditandai dengan latar belakang terang/kontras yang menyatu dengan panel kerja di bawahnya.
* **New Tab Button (`+`):**
  * Tombol `+` diletakkan di sisi kanan setelah deretan tab.
  * Mengklik `+` akan membuat tab baru ("Tanpa judul.md") dalam mode Edit, siap diketik.
* **Tab Bar Scrolling / Overflow:**
  * Jika jumlah tab melebihi lebar layar, tab bar dapat digeser secara horizontal (horizontal scroll) tanpa merusak layout workspace.

### 2.2 Tab Lifecycle & Empty State
* **Buka File:**
  * Melalui tombol "Buka" (Ctrl+O), drag-and-drop file Markdown, atau klik tautan `[[file.md]]` / `[file](file.md)`:
    * Jika file tersebut **sudah terbuka** di salah satu tab: Saku langsung berpindah fokus (*switch*) ke tab tersebut tanpa membuka tab duplikat.
    * Jika file belum terbuka: Buka di tab baru dan fokus ke tab tersebut.
* **Tutup Tab (`x` atau Ctrl+W):**
  * Jika tab dalam keadaan bersih (*clean*): Tab langsung ditutup dan memorinya di-cleanup.
  * Jika tab memiliki perubahan yang belum disimpan (*dirty*): Muncul dialog konfirmasi "Buang perubahan Markdown?".
    * Jika user memilih "Buang perubahan", tab ditutup.
    * Jika user membatalkan (Cancel / Escape), tab tetap terbuka.
* **Empty State:**
  * Jika seluruh tab ditutup hingga tab habis (0 tab), tampilan kembali ke layar awal (*empty state*) dengan tombol "Buka file" dan "Dokumen baru", persis seperti kondisi awal saat membuka aplikasi tanpa file.

### 2.3 Single-Instance Handoff & App Exit
* **Single-Instance Handoff:** Ketika user membuka file Markdown baru dari Windows Explorer saat Saku sudah berjalan, jendela Saku dibawa ke depan dan file dibuka sebagai tab baru (atau switch jika sudah ada).
* **Konfirmasi Keluar Aplikasi (Close Window / Alt+F4):**
  * Memeriksa seluruh tab yang sedang terbuka.
  * Jika ada satu atau lebih tab yang masih dirty, jendela menampilkan dialog konfirmasi penutupan agar perubahan user tidak hilang secara tidak sengaja.

---

## 3. Architecture & Data Contracts

### 3.1 Backend Rust (`src-tauri/src/markdown.rs`)

#### State Model
Mengubah `MarkdownStore` dari opsi dokumen tunggal menjadi pemetaan berbasis `tab_id`:
```rust
pub struct Document {
    path: PathBuf,
    version: Version,
    newline: String,
    bom: bool,
}

pub struct SaveTarget {
    token: String,
    path: PathBuf,
    version: Option<Version>,
}

#[derive(Default)]
pub struct MarkdownStore {
    documents: HashMap<String, Document>,  // key: tab_id
    targets: HashMap<String, SaveTarget>,  // key: tab_id
}
```

#### IPC Commands Contract
1. `open_markdown(tab_id: String, path: String) -> Result<DocumentInfo>`
   * Memvalidasi file `.md` / `.markdown`.
   * Membaca file dengan batas 8 MB, mendeteksi BOM dan newline (LF/CRLF), merekam `Version` (stamp).
   * Menyimpan `Document` ke `documents` map dengan kunci `tab_id`.
   * Mengembalikan `DocumentInfo` `{ path, name, text, lineEnding, warning }`.
2. `new_markdown_tab(tab_id: String) -> Result<()>`
   * Menginisialisasi entri kosong di backend untuk tab baru.
3. `prepare_markdown_save(tab_id: String, path: String) -> Result<SaveInfo>`
   * Memverifikasi target simpan, merekam snapshot jika file sudah ada untuk deteksi konflik, dan menyimpan target dengan kunci `tab_id`.
4. `save_markdown(tab_id: String, text: String, token: Option<String>) -> Result<DocumentInfo>`
   * Melakukan safe atomic save menggunakan file temporary `.local-tools-*.tmp` dan `ReplaceFileW`.
   * Menangani backup `.bak` jika terjadi kegagalan dan memperbarui `documents[tab_id]`.
5. `close_markdown_tab(tab_id: String) -> Result<()>`
   * Menghapus `documents[tab_id]` dan `targets[tab_id]` dari memory store.
6. `markdown_image(tab_id: Option<String>, source: String) -> Result<String>`
   * Mendukung path absolut lokal (misal `C:\path\img.png`, `D:\...`).
   * Mendukung path relatif terhadap direktori dokumen pada `tab_id` yang bersangkutan, termasuk traversal parent `../`.
   * Membaca bytes gambar (maks 5 MB), menentukan MIME type (`png`, `jpg`, `jpeg`, `gif`, `webp`, `bmp`, `svg`), dan mengembalikan data URI base64 `data:<mime>;base64,<payload>`.
7. `open_external_target(tab_id: Option<String>, target: String) -> Result<OpenTargetResult>`
   * Mengklasifikasikan target:
     * Web link (`http://`, `https://`): Buka lewat peramban sistem.
     * File `.md` / `.markdown` lokal: Mengembalikan tipe `Markdown` beserta absolute path agar frontend membukanya di tab baru Saku.
     * File lokal non-MD (misal `.pdf`, `.docx`, `.zip`, `.png`): Di-resolve ke absolute path di disk, lalu dipanggil via `ShellExecuteW` Windows agar dibuka langsung dengan aplikasi default OS.

---

### 3.2 Frontend Architecture (`src/markdown.js` & `src/markdown-render.js`)

#### Tab State Management
Frontend menyimpan koleksi tab aktif:
```javascript
interface Tab {
  id: string;            // UUID v4 unik
  path: string | null;   // null jika belum disimpan (untitled)
  name: string;          // 'Catatan.md' atau 'Tanpa judul.md'
  baseline: string;      // teks awal saat file dibuka / terakhir disimpan
  mode: 'read' | 'edit' | 'split';
  editorState: EditorState; // CodeMirror state per tab
  lineEnding: string;
}
```
* **Pergantian Tab:** Mengubah `activeTabId`. Saat tab aktif berganti, view CodeMirror mengadopsi `editorState` tab tersebut, preview me-render isi tab aktif, dan toolbar disinkronkan tanpa perlu memanggil ulang IPC disk.
* **Dirty Checking:** `tab.editorState.doc.toString() !== tab.baseline`. Jika dirty, tambahkan indikator titik (`•`) pada nama tab di tab bar.

#### Rendering Asset & Image (`src/markdown-render.js`)
* **Web Images:** Tag `<img>` dengan `src="http(s)://..."` tidak lagi dicegat atau diganti placeholder, melainkan dirender langsung dengan atribut `loading="lazy"`. Jika gambar gagal dimuat (misal offline), ditangani oleh event `onerror` untuk menampilkan fallback rapi.
* **Local Images:** Tag `<img>` lokal diberi atribut `data-md-image="<source>"`. Skrip render memanggil `invoke('markdown_image', { tabId: activeTab.id, source })` dan mengganti `src` dengan Base64 data URI yang dikembalikan Rust.
* **Mermaid & Diagram:** Tetap mendukung flowchart & sequence dengan sanitasi SVG yang sudah teruji.

---

## 4. Error Handling & Edge Cases

1. **File Konflik Eksternal:**
   * Jika file yang sedang diedit di salah satu tab diubah oleh aplikasi lain di luar Saku, saat user menekan Simpan, deteksi konflik `Stamp` Rust akan menolak penyimpanan dan meminta user memuat ulang atau Simpan Salinan, sehingga editan di memori tidak tertimpa.
2. **File Dipindahkan / Dihapus di Luar:**
   * Ditangani dengan notifikasi error yang jelas, menawarkan opsi "Simpan Sebagai" untuk menyimpan ke lokasi baru.
3. **Link File Tidak Ditemukan:**
   * Jika user mengklik link lokal yang filenya tidak ada di disk, tampilkan notifikasi status/error: "File lokal tidak ditemukan: <path>".
4. **Batas Ukuran:**
   * Dokumen teks: Maks 8 MB per file.
   * Gambar lokal: Maks 5 MB per gambar, batas maksimum 64 gambar per render dokumen.
5. **Penutupan Tab Banyak Sekaligus:**
   * Saat user menutup aplikasi, periksa seluruh tab yang dirty secara berurutan atau tampilkan ringkasan tab yang belum disimpan sebelum keluar.

---

## 5. Testing & Verification Strategy

1. **Rust Tests (`src-tauri/src/markdown.rs`):**
   * Multi-tab isolation: Buka 2 dokumen berbeda dengan 2 `tab_id`, pastikan edit/save pada tab 1 tidak mempengaruhi state tab 2.
   * Image resolution: Uji path absolut Windows, path relatif satu folder, dan path relatif dengan `../`.
   * External open: Uji klasifikasi link web, link `.md`, dan link non-MD.
   * Safe save & close tab cleanup: Verifikasi bahwa `close_markdown_tab` membersihkan entri store.
2. **Frontend Logic Tests (`tests/markdown-tabs.test.js`):**
   * Uji penambahan tab baru, penutupan tab, pergantian tab aktif.
   * Uji dirty indicator saat dokumen diubah dan kembali bersih saat di-undo/disimpan.
   * Uji pencegahan duplikasi tab saat membuka path file yang sama.
3. **Native Desktop Smoke Tests (WebView2 + Real Process):**
   * Buka file 1, lalu buka file 2 -> verifikasi 2 tab muncul di tab bar dengan nama masing-masing.
   * Beralih antar tab -> verifikasi konten dan mode tersinkronisasi.
   * Edit salah satu tab -> verifikasi tanda dirty muncul hanya pada tab tersebut.
   * Tutup tab dirty -> verifikasi muncul konfirmasi buang perubahan.
   * Tutup semua tab -> verifikasi tampilan kembali ke empty state.
   * Uji render gambar lokal (termasuk folder parent) dan link file lokal.
   * Uji penutupan jendela saat ada tab yang belum disimpan.
