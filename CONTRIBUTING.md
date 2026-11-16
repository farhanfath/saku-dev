# Kontribusi ke Saku

Laporkan bug atau usulkan perubahan melalui [GitHub Issues](https://github.com/farhanfath/saku-dev/issues). Untuk bug, sertakan versi Saku, versi Windows, langkah reproduksi, serta hasil yang diharapkan dan yang terjadi. Pakai file contoh tanpa data pribadi.

Untuk perubahan besar atau fitur baru, diskusikan scope melalui issue sebelum implementasi. Buat branch dari `main` dan kirim pull request yang menjelaskan masalah, perubahan, serta hasil pemeriksaan. Sertakan screenshot jika mengubah UI.

Ikuti setup dan perintah build/tes pada [README.md](README.md). Jalankan tes yang relevan dengan perubahan; perubahan Rust juga perlu pemeriksaan format dan Clippy. Tes desktop memakai profil terisolasi dan membutuhkan sesi desktop Windows aktif. Vault maintainer tidak dibutuhkan untuk berkontribusi; jelaskan perubahan dan validasinya pada pull request.

Pertahankan validasi konflik, perlindungan draft, dan error handling operasi file. Jangan sertakan dependency/build output, kredensial, signing key, atau data pengguna dalam commit. Lockfile npm dan Cargo tetap disertakan agar build dapat direproduksi.

Kontribusi kode mengikuti [MIT License](LICENSE). Pertahankan atribusi dan ketentuan lisensi dependency/aset pihak ketiga.
