# Saku

Aplikasi desktop open source untuk menggabungkan tools file lokal, menggunakan Rust + Tauri untuk Windows x64.

Source code: [farhanfath/saku-dev](https://github.com/farhanfath/saku-dev). Distribusi publik direncanakan melalui [GitHub Releases](https://github.com/farhanfath/saku-dev/releases); installer belum dipublikasikan pada setup repository awal ini.

Dokumentasi rencana dan progress utama dipelihara maintainer di vault [`D:\vault\desktop-local-tool-vault`](../../vault/desktop-local-tool-vault/Home.md). Vault tidak disertakan dalam repository dan tidak dibutuhkan untuk build atau menjalankan tes.

Tools tersedia: **Batch Rename** dan **Markdown** (reader/editor/preview diagram), menggunakan Rust + Tauri untuk Windows. Batch Rename memisahkan draft dari Apply dan menyediakan undo batch terakhir. Markdown menyediakan Baca/Edit/Split serta Save eksplisit dengan pemeriksaan konflik file.

Clone repository dengan `git clone git@github.com:farhanfath/saku-dev.git`, masuk ke folder `saku-dev`, lalu jalankan dari PowerShell dengan `npm.cmd ci` dan `npm.cmd run desktop`. Build membutuhkan Node.js 20.19+ atau 22.12+ untuk Vite 7, Rust stable, MSVC Build Tools dengan Windows SDK, serta WebView2. Buat installer dengan `npm.cmd run desktop:build`.

Verifikasi: `npm.cmd test`, `cargo test --manifest-path src-tauri/Cargo.toml`, dan `npm.cmd run test:desktop`. Tes desktop membuka WebView2, memakai file sementara dan profil `local.desktop.tools.smoke` yang terpisah dari data pengguna. Tes Markdown saja: `npm.cmd run test:markdown`; tes close saja: `npm.cmd run test:close`. Konfigurasi debugging khusus tes berada di `tests/tauri.smoke.json`, terpisah dari build rilis.

Scope dan batasan lengkap ada di vault: `Tools/Batch Rename.md` dan `Tools/Markdown.md`. Versi 0.2.1 memakai nama Saku dan mendukung Markdown UTF-8 serta diagram Mermaid flowchart/sequence. Executable: `src-tauri/target/release/saku.exe`; installer: `src-tauri/target/release/bundle/nsis/Saku_0.2.1_x64-setup.exe`. Installer menyediakan asosiasi Open with untuk `.md`/`.markdown`; pilih default app melalui Windows bila diinginkan. Identifier dan lokasi data tetap `local.desktop.tools` untuk mempertahankan jurnal undo/pemulihan.

Lihat [AGENTS.md](AGENTS.md) untuk aturan kerja dan pemeliharaan dokumentasi.

Kontribusi dan laporan bug mengikuti [CONTRIBUTING.md](CONTRIBUTING.md).

Kode Saku menggunakan [MIT License](LICENSE). Dependency dan aset pihak ketiga tetap mengikuti lisensinya masing-masing.
