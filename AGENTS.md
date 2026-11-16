# Project instructions

## Source of truth

- Repository kode: `D:\developer\desktop-local-tools`.
- Vault dokumentasi utama: `D:\vault\desktop-local-tool-vault` (lokasi ditetapkan user).
- Sebelum mengerjakan task, baca `Home.md`, `Overview.md`, `Roadmap.md`, `Tools.md`, `Decisions.md`, dan progress terbaru di vault.
- Simpan overview, roadmap, inventaris tools, keputusan, dan progress di vault. README repo cukup menjadi pengarah; jangan menduplikasi dokumentasi utama.
- Sesudah perubahan bermakna, tambahkan hasil dan validasi ke `Progress/YYYY-MM-DD.md` menggunakan tanggal lokal Asia/Jakarta. Perbarui catatan lain yang terdampak agar statusnya konsisten.
- Catat asumsi sebagai asumsi dan usulan sebagai usulan. Tandai tool tersedia hanya jika sudah diimplementasikan dan diverifikasi; dokumentasikan batasannya.
- Stack awal yang disetujui user: Rust + Tauri, UI web ringan, target Windows. Batch Rename adalah tool pertama; baca spesifikasi dan status terbaru di vault sebelum memperluas scope.

## Agent coordination

Jika tools agent-hub tersedia:

1. Sebelum edit pertama, panggil `hub_register` dengan `project_root`, `tool`, dan `task`; baca handoff terbaru. Gunakan kembali `agent_id` sesi ini lewat `resume_agent_id`, atau gunakan ID dari parent jika ada.
2. Sertakan `vault: {root: "D:\\vault\\desktop-local-tool-vault", source: "AGENTS.md"}` saat register repo. Jika mapping bertentangan, klarifikasi ke user; gunakan `vault.replace: true` hanya setelah perubahan disetujui.
3. Sebelum mengedit file tambahan, panggil `hub_claim`. Jika area itu dipegang agent lain, kirim `hub_send` sebelum melanjutkan.
4. Jika menemukan perubahan yang bukan milikmu, panggil `hub_file_info`. Jangan hapus atau menulis ulang perubahan agent lain tanpa menghubunginya.
5. Baca pesan pada setiap respons hub. Balas pesan `[waiting for reply]` via `hub_send` sebelum melanjutkan. Jika perlu jawaban, gunakan `wait_seconds: 45`, lalu maksimal dua kali `hub_status(wait_seconds: 45)`.
6. Daftarkan sesi terpisah di root vault sebelum claim/edit dokumentasinya. Gunakan path absolut untuk claim karena vault berada di dalam repo Git bersama `D:\vault`; jangan mengedit vault project lain atau mengganti mapping miliknya.
7. Saat selesai, panggil `hub_done` dengan ringkasan dan langkah berikutnya. Jika ada pesan yang menahan penyelesaian, balas lalu panggil lagi.

Jika menugaskan sub-agent yang akan mengedit file, berikan `agent_id` yang sesuai dengan root file tersebut.
