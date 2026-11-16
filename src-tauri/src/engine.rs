use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::Write,
    os::windows::{ffi::OsStrExt, io::AsRawHandle},
    path::{Path, PathBuf},
};
use uuid::Uuid;
use windows_sys::Win32::Storage::FileSystem::{
    GetFileInformationByHandle, MoveFileExW, BY_HANDLE_FILE_INFORMATION,
};

type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub parent: String,
    pub size: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct Stamp {
    volume: u32,
    index: u64,
    size: u64,
    modified: u64,
}

struct Record {
    info: FileInfo,
    path: PathBuf,
    stamp: Stamp,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Edit {
    pub id: String,
    pub new_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub id: String,
    pub changed: bool,
    pub issue: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
struct Move {
    source: PathBuf,
    temporary: PathBuf,
    target: PathBuf,
    stamp: Stamp,
}

#[derive(Serialize, Deserialize)]
struct Journal {
    applied: bool,
    moves: Vec<Move>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub undo_count: usize,
    pub recovery: bool,
}

pub struct Engine {
    records: Vec<Record>,
    journal_path: PathBuf,
}

pub(crate) fn display_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else {
        value.strip_prefix(r"\\?\").unwrap_or(&value).to_owned()
    }
}

fn key(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}

pub(crate) fn stamp(path: &Path) -> Result<Stamp> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|e| format!("Tidak bisa membaca {}: {e}", display_path(path)))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(format!(
            "Pilih file biasa, bukan folder atau shortcut: {}",
            display_path(path)
        ));
    }
    let file =
        File::open(path).map_err(|e| format!("Tidak bisa membuka {}: {e}", display_path(path)))?;
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    // File identity prevents undo from touching a replacement at the same path.
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
        return Err(format!(
            "Tidak bisa memeriksa identitas file: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(Stamp {
        volume: info.dwVolumeSerialNumber,
        index: ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64,
        size: ((info.nFileSizeHigh as u64) << 32) | info.nFileSizeLow as u64,
        modified: ((info.ftLastWriteTime.dwHighDateTime as u64) << 32)
            | info.ftLastWriteTime.dwLowDateTime as u64,
    })
}

fn exists(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(format!("Tidak bisa memeriksa {}: {e}", display_path(path))),
    }
}

pub(crate) fn move_file(source: &Path, target: &Path) -> Result<()> {
    let from: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    // No REPLACE_EXISTING: destination races fail instead of overwriting a file.
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0) } == 0 {
        return Err(format!(
            "Gagal rename {}: {}",
            display_path(source),
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

pub(crate) fn validate_name(name: &str) -> Result<()> {
    if name.is_empty() || name == "." || name == ".." {
        return Err("Nama file tidak boleh kosong atau berupa titik.".into());
    }
    if name.ends_with([' ', '.']) {
        return Err("Nama tidak boleh berakhir dengan spasi atau titik.".into());
    }
    if name.chars().any(|c| c < ' ' || "<>:\"/\\|?*".contains(c)) {
        return Err(
            "Nama berisi karakter yang tidak diizinkan Windows: < > : \" / \\ | ? *".into(),
        );
    }
    if name.encode_utf16().count() > 255 {
        return Err("Nama terlalu panjang (maksimal 255 karakter UTF-16).".into());
    }
    let stem = name
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end()
        .to_uppercase();
    if ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].contains(&stem.as_str())
        || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|n| {
                ["1", "2", "3", "4", "5", "6", "7", "8", "9", "¹", "²", "³"].contains(&n)
            })
        })
    {
        return Err("Nama ini dicadangkan oleh Windows. Gunakan nama lain.".into());
    }
    Ok(())
}

fn record(path: PathBuf) -> Result<Record> {
    let fingerprint = stamp(&path)?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Nama file bukan Unicode yang valid.")?
        .to_owned();
    Ok(Record {
        info: FileInfo {
            id: Uuid::new_v4().to_string(),
            name,
            path: display_path(&path),
            parent: display_path(path.parent().ok_or("Folder file tidak ditemukan.")?),
            size: fingerprint.size,
        },
        path,
        stamp: fingerprint,
    })
}

impl Engine {
    pub fn new(journal_path: PathBuf) -> Self {
        Self {
            records: Vec::new(),
            journal_path,
        }
    }

    fn journal(&self) -> Result<Option<Journal>> {
        match fs::read(&self.journal_path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|_| "Catatan pemulihan tidak bisa dibaca. Jangan hapus file pemulihan; periksa folder data aplikasi.".into()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("Tidak bisa membaca catatan pemulihan: {e}")),
        }
    }

    fn save_journal(&self, journal: &Journal) -> Result<()> {
        let parent = self
            .journal_path
            .parent()
            .ok_or("Folder data aplikasi tidak ditemukan.")?;
        fs::create_dir_all(parent)
            .map_err(|e| format!("Tidak bisa membuat folder pemulihan: {e}"))?;
        let temporary = parent.join(format!("journal-{}.tmp", Uuid::new_v4()));
        let data = serde_json::to_vec(journal).map_err(|e| e.to_string())?;
        let result = (|| {
            let mut file = File::options()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|e| e.to_string())?;
            file.write_all(&data)
                .and_then(|_| file.sync_all())
                .map_err(|e| e.to_string())?;
            fs::rename(&temporary, &self.journal_path).map_err(|e| e.to_string())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result.map_err(|e| format!("Tidak bisa menyimpan catatan pemulihan: {e}. Periksa status batch sebelum melanjutkan."))
    }

    pub fn status(&self) -> Result<Status> {
        let journal = self.journal()?;
        Ok(Status {
            undo_count: journal.as_ref().map_or(0, |j| j.moves.len()),
            recovery: journal.is_some_and(|j| !j.applied),
        })
    }

    pub fn import(&mut self, paths: Vec<String>) -> Result<Vec<FileInfo>> {
        let mut additions = Vec::new();
        let mut selected = Vec::new();
        for path in paths {
            stamp(Path::new(&path))?;
            let canonical =
                fs::canonicalize(&path).map_err(|e| format!("Tidak bisa membaca {path}: {e}"))?;
            if let Some(existing) = self
                .records
                .iter()
                .chain(additions.iter())
                .find(|r| key(&r.path) == key(&canonical))
            {
                selected.push(existing.info.clone());
                continue;
            }
            let item = record(canonical)?;
            if self
                .records
                .iter()
                .chain(additions.iter())
                .any(|r| r.stamp.volume == item.stamp.volume && r.stamp.index == item.stamp.index)
            {
                return Err(
                    "Dua pilihan menunjuk file fisik yang sama (hard link). Pilih salah satunya."
                        .into(),
                );
            }
            selected.push(item.info.clone());
            additions.push(item);
        }
        self.records.extend(additions);
        Ok(selected)
    }

    pub fn clear(&mut self) {
        self.records.clear();
    }

    fn plan(&self, edits: &[Edit]) -> Result<(Vec<Preview>, Vec<Move>)> {
        let mut seen = HashSet::new();
        let mut destinations = std::collections::HashMap::<String, usize>::new();
        let mut preview: Vec<Preview> = Vec::new();
        let mut moves = Vec::new();
        for edit in edits {
            if !seen.insert(&edit.id) {
                return Err("Pilihan file berulang. Kosongkan daftar lalu pilih ulang.".into());
            }
            let item = self
                .records
                .iter()
                .find(|r| r.info.id == edit.id)
                .ok_or("Pilihan file sudah tidak berlaku. Pilih ulang file.")?;
            let target = item.path.with_file_name(&edit.new_name);
            let changed = edit.new_name != item.info.name;
            let mut issue = validate_name(&edit.new_name).err();
            if issue.is_none() {
                issue = match stamp(&item.path) {
                    Ok(current) if current == item.stamp => None,
                    _ => Some("File berubah, dipindahkan, atau tidak bisa dibaca. Kosongkan daftar dan pilih ulang.".into()),
                };
            }
            if let Some(previous) = destinations.insert(key(&target), preview.len()) {
                preview[previous].issue =
                    Some("Nama tujuan sama dengan file lain dalam daftar.".into());
                issue = Some("Nama tujuan sama dengan file lain dalam daftar.".into());
            }
            preview.push(Preview {
                id: edit.id.clone(),
                changed,
                issue,
            });
            if changed {
                moves.push(Move {
                    source: item.path.clone(),
                    target,
                    temporary: item
                        .path
                        .with_file_name(format!(".desktop-local-tools-{}.tmp", Uuid::new_v4())),
                    stamp: item.stamp.clone(),
                });
            }
        }
        for (edit, row) in edits.iter().zip(preview.iter_mut()) {
            if row.changed && row.issue.is_none() {
                let item = self.records.iter().find(|r| r.info.id == edit.id).unwrap();
                let target = item.path.with_file_name(&edit.new_name);
                if exists(&target)? && !moves.iter().any(|m| key(&m.source) == key(&target)) {
                    row.issue = Some("Nama ini sudah dipakai file atau folder lain.".into());
                }
            }
        }
        Ok((preview, moves))
    }

    pub fn preview(&self, edits: Vec<Edit>) -> Result<Vec<Preview>> {
        self.plan(&edits).map(|(p, _)| p)
    }

    pub fn apply(&mut self, edits: Vec<Edit>) -> Result<Vec<FileInfo>> {
        if self.status()?.recovery {
            return Err("Pulihkan batch yang terputus sebelum rename berikutnya.".into());
        }
        let previous_journal = self.journal()?;
        let (preview, moves) = self.plan(&edits)?;
        if let Some(issue) = preview.iter().find_map(|p| p.issue.as_ref()) {
            return Err(issue.clone());
        }
        if moves.is_empty() {
            return Err("Belum ada nama yang berubah.".into());
        }
        let mut journal = Journal {
            applied: false,
            moves,
        };
        self.save_journal(&journal)?;
        let result: Result<()> = (|| {
            for item in &journal.moves {
                if stamp(&item.source)? != item.stamp {
                    return Err("File berubah sebelum rename. Operasi dihentikan.".into());
                }
                move_file(&item.source, &item.temporary)?;
            }
            for item in &journal.moves {
                move_file(&item.temporary, &item.target)?;
            }
            Ok(())
        })();
        if let Err(error) = result {
            return match self.restore(&journal) {
                Ok(()) => {
                    if let Some(previous) = &previous_journal { self.save_journal(previous)?; }
                    else { fs::remove_file(&self.journal_path).map_err(|e| format!("File sudah dipulihkan, tetapi catatan pemulihan belum bisa dihapus: {e}"))?; }
                    Err(format!("{error} Semua file berhasil dikembalikan ke nama semula."))
                },
                Err(recovery) => Err(format!("{error} Pemulihan belum selesai: {recovery} Gunakan Pulihkan batch; jangan hapus file .desktop-local-tools-*.tmp.")),
            };
        }
        journal.applied = true;
        self.save_journal(&journal)?;
        for item in &mut self.records {
            if let Some(movement) = journal.moves.iter().find(|m| m.source == item.path) {
                item.path = movement.target.clone();
                item.info.path = display_path(&item.path);
                item.info.parent = display_path(item.path.parent().unwrap());
                item.info.name = item
                    .path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned();
            }
        }
        Ok(self
            .records
            .iter()
            .filter(|r| edits.iter().any(|e| e.id == r.info.id))
            .map(|r| r.info.clone())
            .collect())
    }

    fn restore_locations(&self, journal: &Journal) -> Result<Vec<PathBuf>> {
        let mut locations = Vec::new();
        for item in &journal.moves {
            let mut candidates = HashSet::new();
            let mut found = Vec::new();
            for path in [&item.temporary, &item.target, &item.source] {
                if candidates.insert(key(path)) && stamp(path).is_ok_and(|s| s == item.stamp) {
                    found.push(path.clone());
                }
            }
            if found.len() != 1 {
                return Err(format!("File hilang, berubah, atau identitasnya ambigu: {}. Periksa file sebelum mencoba lagi.", display_path(&item.target)));
            }
            locations.push(found.remove(0));
        }
        for (item, location) in journal.moves.iter().zip(&locations) {
            if exists(&item.source)? && !locations.iter().any(|p| key(p) == key(&item.source)) {
                return Err(format!(
                    "Nama asal sudah dipakai: {}. Pindahkan file penghalang lalu coba lagi.",
                    display_path(&item.source)
                ));
            }
            if location != &item.source
                && key(location) != key(&item.temporary)
                && exists(&item.temporary)?
            {
                return Err(
                    "Nama file pemulihan sedang dipakai. Tidak ada file yang ditimpa.".into(),
                );
            }
        }
        Ok(locations)
    }

    fn restore(&self, journal: &Journal) -> Result<()> {
        let locations = self.restore_locations(journal)?;
        // Stage every file before restoring originals, including swaps and cycles.
        for (item, location) in journal.moves.iter().zip(&locations) {
            if location != &item.source && location != &item.temporary {
                move_file(location, &item.temporary)?;
            }
        }
        for (item, location) in journal.moves.iter().zip(&locations) {
            if location != &item.source {
                move_file(&item.temporary, &item.source)?;
            }
        }
        Ok(())
    }

    pub fn undo(&mut self) -> Result<Vec<FileInfo>> {
        let mut journal = self
            .journal()?
            .ok_or("Belum ada batch yang bisa dikembalikan.")?;
        self.restore_locations(&journal)?;
        // Persist recovery intent before undo: interrupted undo remains recoverable.
        journal.applied = false;
        self.save_journal(&journal)?;
        self.restore(&journal)?;
        fs::remove_file(&self.journal_path)
            .map_err(|e| format!("File sudah kembali, tetapi catatan undo gagal dihapus: {e}"))?;
        self.records = journal
            .moves
            .into_iter()
            .map(|m| record(m.source))
            .collect::<Result<Vec<_>>>()?;
        Ok(self.records.iter().map(|r| r.info.clone()).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        root: PathBuf,
        engine: Engine,
    }
    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("desktop-local-tools-test-{}", Uuid::new_v4()));
            fs::create_dir(&root).unwrap();
            Self {
                engine: Engine::new(root.join("data/undo.json")),
                root,
            }
        }
        fn file(&self, name: &str, content: &str) -> String {
            let p = self.root.join(name);
            fs::write(&p, content).unwrap();
            p.to_str().unwrap().into()
        }
        fn edits(&mut self, files: &[(&str, &str)]) -> Vec<Edit> {
            let paths = files
                .iter()
                .map(|(name, _)| self.root.join(name).to_str().unwrap().to_owned())
                .collect();
            self.engine
                .import(paths)
                .unwrap()
                .into_iter()
                .zip(files)
                .map(|(f, (_, new_name))| Edit {
                    id: f.id,
                    new_name: new_name.to_string(),
                })
                .collect()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn names_validate_windows_boundaries() {
        for name in [
            "",
            ".",
            "..",
            "a/b",
            "x\\y",
            "a:b",
            "a\0b",
            "a.",
            "a ",
            "CON.txt",
            "com1",
            "LPT³.pdf",
            "nul",
            "AUX .txt",
        ] {
            assert!(validate_name(name).is_err(), "{name}");
        }
        for name in [".env", "foto liburan.jpg", "猫.png", "COM10.txt", "README"] {
            assert!(validate_name(name).is_ok(), "{name}");
        }
        assert!(validate_name(&"a".repeat(256)).is_err());
    }

    #[test]
    fn swap_and_undo_survive_restart_without_touching_contents() {
        let mut f = Fixture::new();
        f.file("a.txt", "first");
        f.file("b.txt", "second");
        let edits = f.edits(&[("a.txt", "b.txt"), ("b.txt", "a.txt")]);
        f.engine.apply(edits).unwrap();
        assert_eq!(fs::read_to_string(f.root.join("a.txt")).unwrap(), "second");
        let mut restarted = Engine::new(f.root.join("data/undo.json"));
        assert_eq!(restarted.status().unwrap().undo_count, 2);
        restarted.undo().unwrap();
        assert_eq!(fs::read_to_string(f.root.join("a.txt")).unwrap(), "first");
        assert_eq!(fs::read_to_string(f.root.join("b.txt")).unwrap(), "second");
    }

    #[test]
    fn rejects_conflicts_and_never_overwrites() {
        let mut f = Fixture::new();
        f.file("a.txt", "first");
        f.file("b.txt", "keep");
        let edits = f.edits(&[("a.txt", "b.txt")]);
        assert!(f.engine.preview(edits.clone()).unwrap()[0].issue.is_some());
        assert!(f.engine.apply(edits).is_err());
        assert_eq!(fs::read_to_string(f.root.join("b.txt")).unwrap(), "keep");
        assert!(move_file(&f.root.join("a.txt"), &f.root.join("b.txt")).is_err());
    }

    #[test]
    fn duplicate_targets_are_flagged_on_both_rows() {
        let mut f = Fixture::new();
        f.file("a", "a");
        f.file("b", "b");
        let edits = f.edits(&[("a", "same"), ("b", "SAME")]);
        assert!(f
            .engine
            .preview(edits.clone())
            .unwrap()
            .iter()
            .all(|p| p.issue.is_some()));
        assert!(f.engine.apply(edits).is_err());
    }

    #[test]
    fn undo_refuses_modified_file_without_starting_recovery() {
        let mut f = Fixture::new();
        f.file("a.txt", "original");
        let edits = f.edits(&[("a.txt", "renamed.txt")]);
        f.engine.apply(edits).unwrap();
        fs::write(f.root.join("renamed.txt"), "changed content").unwrap();
        assert!(f.engine.undo().is_err());
        assert!(!f.engine.status().unwrap().recovery);
        assert_eq!(
            fs::read_to_string(f.root.join("renamed.txt")).unwrap(),
            "changed content"
        );
    }

    #[test]
    fn recover_interrupted_staging_and_partial_commit() {
        let mut f = Fixture::new();
        f.file("a", "a");
        f.file("b", "b");
        let edits = f.edits(&[("a", "x"), ("b", "y")]);
        let (_, moves) = f.engine.plan(&edits).unwrap();
        let journal = Journal {
            applied: false,
            moves,
        };
        f.engine.save_journal(&journal).unwrap();
        for m in &journal.moves {
            move_file(&m.source, &m.temporary).unwrap();
        }
        move_file(&journal.moves[0].temporary, &journal.moves[0].target).unwrap();
        f.engine.undo().unwrap();
        assert_eq!(fs::read_to_string(f.root.join("a")).unwrap(), "a");
        assert_eq!(fs::read_to_string(f.root.join("b")).unwrap(), "b");
    }

    #[test]
    fn case_only_rename_and_undo() {
        let mut f = Fixture::new();
        f.file("photo.txt", "image");
        let edits = f.edits(&[("photo.txt", "PHOTO.txt")]);
        f.engine.apply(edits).unwrap();
        assert_eq!(f.engine.records[0].info.name, "PHOTO.txt");
        f.engine.undo().unwrap();
        assert_eq!(f.engine.records[0].info.name, "photo.txt");
    }

    #[test]
    fn stale_source_and_corrupt_journal_block_mutation() {
        let mut f = Fixture::new();
        f.file("a", "original");
        let edits = f.edits(&[("a", "new")]);
        f.file("a", "external edit");
        assert!(f.engine.apply(edits.clone()).is_err());
        fs::create_dir_all(f.root.join("data")).unwrap();
        fs::write(f.root.join("data/undo.json"), "invalid").unwrap();
        assert!(f.engine.apply(edits).is_err());
        assert!(f.root.join("a").exists());
    }

    #[test]
    fn locked_file_rolls_back_partial_stage_and_preserves_last_undo() {
        use std::os::windows::fs::OpenOptionsExt;
        let mut f = Fixture::new();
        f.file("first", "original");
        let first = f.edits(&[("first", "renamed")]);
        f.engine.apply(first).unwrap();
        f.file("a", "a");
        f.file("b", "b");
        let edits = f.edits(&[("a", "x"), ("b", "y")]);
        let locked = File::options()
            .read(true)
            .share_mode(3)
            .open(f.root.join("b"))
            .unwrap();
        assert!(f
            .engine
            .apply(edits)
            .err()
            .unwrap()
            .contains("Semua file berhasil dikembalikan"));
        assert_eq!(fs::read_to_string(f.root.join("a")).unwrap(), "a");
        assert!(f.engine.status().unwrap().undo_count == 1);
        drop(locked);
        f.engine.undo().unwrap();
        assert_eq!(
            fs::read_to_string(f.root.join("first")).unwrap(),
            "original"
        );
    }
}
