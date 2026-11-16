use crate::engine::{display_path, move_file, stamp, validate_name, Stamp};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Write},
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::State;
use uuid::Uuid;
use windows_sys::Win32::{Storage::FileSystem::ReplaceFileW, UI::Shell::ShellExecuteW};

const MAX_TEXT: usize = 8 * 1024 * 1024;
const MAX_IMAGE: usize = 5 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct MdError {
    pub kind: &'static str,
    pub message: String,
}
type Result<T> = std::result::Result<T, MdError>;
fn error(message: impl Into<String>) -> MdError {
    MdError {
        kind: "io",
        message: message.into(),
    }
}
fn conflict() -> MdError {
    MdError { kind: "conflict", message: "File berubah atau dipindahkan di luar aplikasi. Muat ulang atau simpan salinan agar edit tidak hilang.".into() }
}

#[derive(Clone, PartialEq)]
pub struct Version {
    pub stamp: Stamp,
    pub bytes: Vec<u8>,
}
pub struct Document {
    pub path: PathBuf,
    pub version: Version,
    pub newline: String,
    pub bom: bool,
}
pub struct SaveTarget {
    pub token: String,
    pub path: PathBuf,
    pub version: Option<Version>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInfo {
    pub path: String,
    pub name: String,
    pub text: String,
    pub line_ending: String,
    pub warning: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveInfo {
    pub token: String,
    pub path: String,
    pub exists: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalTargetResult {
    pub action: String,
    pub path: Option<String>,
}

#[derive(Default)]
pub struct MarkdownStore {
    pub documents: HashMap<String, Document>,
    pub targets: HashMap<String, SaveTarget>,
}
pub type Store = Mutex<MarkdownStore>;
pub struct PendingMarkdown(pub Mutex<Option<String>>);

fn check_extension(path: &Path) -> Result<()> {
    match path
        .extension()
        .and_then(|s| s.to_str())
        .map(str::to_lowercase)
        .as_deref()
    {
        Some("md" | "markdown") => Ok(()),
        _ => Err(error("Pilih file berakhiran .md atau .markdown.")),
    }
}

fn read_version(path: &Path, limit: usize) -> Result<Version> {
    let before = stamp(path).map_err(error)?;
    let file = File::open(path).map_err(|e| error(format!("Tidak bisa membuka file: {e}")))?;
    if file.metadata().map_err(|e| error(e.to_string()))?.len() > limit as u64 {
        return Err(error(
            "File terlalu besar. Batas dokumen 8 MB dan gambar 5 MB.",
        ));
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| error(e.to_string()))?;
    if bytes.len() > limit {
        return Err(error("Ukuran file melebihi batas."));
    }
    if stamp(path).map_err(error)? != before {
        return Err(conflict());
    }
    Ok(Version {
        stamp: before,
        bytes,
    })
}

fn decode(version: &Version) -> Result<(String, String, bool, bool)> {
    let bom = version.bytes.starts_with(&[0xef, 0xbb, 0xbf]);
    let bytes = if bom {
        &version.bytes[3..]
    } else {
        &version.bytes
    };
    let text = std::str::from_utf8(bytes)
        .map_err(|_| error("Encoding belum didukung. Buka file UTF-8; file asli tidak diubah."))?;
    if text.contains('\0') {
        return Err(error(
            "File berisi data biner, bukan dokumen Markdown UTF-8.",
        ));
    }
    let crlf = text.matches("\r\n").count();
    let mixed =
        crlf > 0 && text.matches('\n').count() > crlf || text.replace("\r\n", "").contains('\r');
    let newline = if crlf > 0 { "\r\n" } else { "\n" }.to_owned();
    Ok((
        text.replace("\r\n", "\n").replace('\r', "\n"),
        newline,
        bom,
        mixed,
    ))
}

fn info(document: &Document) -> Result<DocumentInfo> {
    let (text, _, _, mixed) = decode(&document.version)?;
    Ok(DocumentInfo {
        path: display_path(&document.path),
        name: document.path.file_name().unwrap().to_string_lossy().into_owned(),
        text, line_ending: if document.newline == "\r\n" { "CRLF" } else { "LF" }.into(),
        warning: mixed.then(|| "Format baris campuran. Saat disimpan, baris akan diseragamkan; gunakan Simpan sebagai untuk mempertahankan file asli.".into()),
    })
}

impl MarkdownStore {
    pub fn open_tab(&mut self, tab_id: &str, path: &Path) -> Result<DocumentInfo> {
        check_extension(path)?;
        stamp(path).map_err(error)?;
        let path = fs::canonicalize(path).map_err(|e| error(e.to_string()))?;
        let version = read_version(&path, MAX_TEXT)?;
        let (_, newline, bom, _) = decode(&version)?;
        let document = Document {
            path,
            version,
            newline,
            bom,
        };
        let result = info(&document)?;
        self.documents.insert(tab_id.to_string(), document);
        self.targets.remove(tab_id);
        Ok(result)
    }

    pub fn new_tab(&mut self, tab_id: &str) -> Result<()> {
        self.documents.remove(tab_id);
        self.targets.remove(tab_id);
        Ok(())
    }

    pub fn prepare_tab(&mut self, tab_id: &str, path: &Path) -> Result<SaveInfo> {
        check_extension(path)?;
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| error("Nama file tidak valid."))?;
        validate_name(name).map_err(error)?;
        let parent = fs::canonicalize(
            path.parent()
                .ok_or_else(|| error("Folder tujuan tidak valid."))?,
        )
        .map_err(|e| error(e.to_string()))?;
        let target = parent.join(name);
        let version = match fs::symlink_metadata(&target) {
            Ok(_) => Some(read_version(&target, MAX_TEXT)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(error(e.to_string())),
        };
        let token = Uuid::new_v4().to_string();
        let result = SaveInfo {
            token: token.clone(),
            path: display_path(&target),
            exists: version.is_some(),
        };
        self.targets.insert(
            tab_id.to_string(),
            SaveTarget {
                token,
                path: target,
                version,
            },
        );
        Ok(result)
    }

    pub fn save_tab(
        &mut self,
        tab_id: &str,
        text: &str,
        token: Option<&str>,
    ) -> Result<DocumentInfo> {
        if text.len() > MAX_TEXT {
            return Err(error("Dokumen melebihi batas 8 MB."));
        }
        let (path, expected) = if let Some(token) = token {
            let target = self
                .targets
                .get(tab_id)
                .filter(|t| t.token == token)
                .ok_or_else(|| error("Pilihan simpan kedaluwarsa. Pilih lokasi lagi."))?;
            (target.path.clone(), target.version.clone())
        } else {
            let current = self
                .documents
                .get(tab_id)
                .ok_or_else(|| error("Pilih lokasi lewat Simpan sebagai."))?;
            (current.path.clone(), Some(current.version.clone()))
        };
        if let Some(expected) = &expected {
            if read_version(&path, MAX_TEXT).map_err(|_| conflict())? != *expected {
                return Err(conflict());
            }
        } else if path.try_exists().map_err(|e| error(e.to_string()))? {
            return Err(conflict());
        }
        let newline = self
            .documents
            .get(tab_id)
            .map_or("\n", |d| d.newline.as_str());
        let bom = self.documents.get(tab_id).is_some_and(|d| d.bom);
        let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
        let mut bytes = if bom {
            vec![0xef, 0xbb, 0xbf]
        } else {
            Vec::new()
        };
        bytes.extend_from_slice(normalized.replace('\n', newline).as_bytes());
        if bytes.len() > MAX_TEXT {
            return Err(error("Dokumen melebihi batas 8 MB setelah encoding."));
        }
        let parent = path
            .parent()
            .ok_or_else(|| error("Folder tujuan tidak ditemukan."))?;
        let temporary = parent.join(format!(".local-tools-{}.tmp", Uuid::new_v4()));
        let mut output = File::options()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| error(format!("Folder tidak bisa ditulis: {e}")))?;
        if let Err(e) = output.write_all(&bytes).and_then(|_| output.sync_all()) {
            drop(output);
            let _ = fs::remove_file(&temporary);
            return Err(error(format!("Gagal menulis. File asli tetap utuh: {e}")));
        }
        drop(output);
        let replacement = if let Some(expected) = expected {
            if !read_version(&path, MAX_TEXT).is_ok_and(|current| current == expected) {
                let _ = fs::remove_file(&temporary);
                return Err(conflict());
            }
            let backup = parent.join(format!(".local-tools-{}.bak", Uuid::new_v4()));
            let wide = |p: &Path| {
                p.as_os_str()
                    .encode_wide()
                    .chain(Some(0))
                    .collect::<Vec<_>>()
            };
            // ReplaceFile preserves the destination's Windows metadata; keep recovery copies on failure.
            let ok = unsafe {
                ReplaceFileW(
                    wide(&path).as_ptr(),
                    wide(&temporary).as_ptr(),
                    wide(&backup).as_ptr(),
                    0,
                    std::ptr::null(),
                    std::ptr::null(),
                )
            };
            if ok == 0 {
                Err(error(format!(
                    "Simpan gagal: {}. Draft tetap terbuka. Salinan pemulihan: {} dan {}.",
                    std::io::Error::last_os_error(),
                    display_path(&temporary),
                    display_path(&backup)
                )))
            } else {
                let _ = fs::remove_file(&backup);
                Ok(())
            }
        } else {
            move_file(&temporary, &path).map_err(error)
        };
        replacement?;
        self.open_tab(tab_id, &path)
    }

    pub fn close_tab(&mut self, tab_id: &str) -> Result<()> {
        self.documents.remove(tab_id);
        self.targets.remove(tab_id);
        Ok(())
    }

    pub fn image(&self, tab_id: Option<&str>, source: &str) -> Result<String> {
        let cwd = std::env::current_dir().ok();
        let base_dir = tab_id
            .and_then(|id| self.documents.get(id))
            .and_then(|doc| doc.path.parent())
            .or_else(|| {
                self.documents
                    .values()
                    .next()
                    .and_then(|doc| doc.path.parent())
            })
            .or(cwd.as_deref());

        let clean_source = if Path::new(source).exists() {
            source
        } else {
            source.split_once('#').map_or(source, |(f, _)| f)
        };
        let source_path = Path::new(clean_source);

        let target_path = if source_path.is_absolute() {
            source_path.to_path_buf()
        } else if let Some(base) = base_dir {
            base.join(source_path)
        } else {
            return Err(error("Simpan dokumen agar lokasi gambar bisa ditentukan."));
        };

        let path = fs::canonicalize(&target_path).map_err(|_| error("Gambar tidak ditemukan."))?;

        let mime = match path
            .extension()
            .and_then(|s| s.to_str())
            .map(str::to_lowercase)
            .as_deref()
        {
            Some("png") => "image/png",
            Some("jpg" | "jpeg") => "image/jpeg",
            Some("gif") => "image/gif",
            Some("webp") => "image/webp",
            Some("bmp") => "image/bmp",
            Some("svg") => "image/svg+xml",
            _ => return Err(error("Format gambar belum didukung.")),
        };
        let version = read_version(&path, MAX_IMAGE)?;
        Ok(format!(
            "data:{mime};base64,{}",
            STANDARD.encode(version.bytes)
        ))
    }

    pub fn open_external_target(
        &self,
        tab_id: Option<&str>,
        target: &str,
    ) -> Result<ExternalTargetResult> {
        if target.starts_with("http://") || target.starts_with("https://") {
            let parsed =
                tauri::Url::parse(target).map_err(|_| error("Alamat link tidak valid."))?;
            if !["http", "https"].contains(&parsed.scheme())
                || target.chars().any(|c| c.is_control())
            {
                return Err(error("Hanya link http/https yang dapat dibuka."));
            }
            if !cfg!(test) {
                let wide: Vec<u16> = parsed.as_str().encode_utf16().chain(Some(0)).collect();
                let verb: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
                let res = unsafe {
                    ShellExecuteW(
                        std::ptr::null_mut(),
                        verb.as_ptr(),
                        wide.as_ptr(),
                        std::ptr::null(),
                        std::ptr::null(),
                        1,
                    )
                };
                if (res as isize) <= 32 {
                    return Err(error("Link tidak bisa dibuka di browser."));
                }
            }
            return Ok(ExternalTargetResult {
                action: "web".into(),
                path: None,
            });
        }

        let clean_target = match target.split_once('#') {
            Some((file, _)) => file,
            None => target,
        };

        let cwd = std::env::current_dir().ok();
        let base_dir = tab_id
            .and_then(|id| self.documents.get(id))
            .and_then(|doc| doc.path.parent())
            .or_else(|| {
                self.documents
                    .values()
                    .next()
                    .and_then(|doc| doc.path.parent())
            })
            .or(cwd.as_deref());

        let target_path = Path::new(clean_target);
        let resolved = if clean_target.is_empty() {
            if let Some(doc) = tab_id
                .and_then(|id| self.documents.get(id))
                .or_else(|| self.documents.values().next())
            {
                doc.path.clone()
            } else {
                return Err(error("Dokumen belum memiliki lokasi."));
            }
        } else if target_path.is_absolute() {
            target_path.to_path_buf()
        } else if let Some(base) = base_dir {
            base.join(target_path)
        } else {
            return Err(error("Dokumen belum memiliki lokasi."));
        };

        let canonical = fs::canonicalize(&resolved).map_err(|_| {
            error(format!(
                "File lokal tidak ditemukan: {}",
                display_path(&resolved)
            ))
        })?;

        let is_markdown = matches!(
            canonical
                .extension()
                .and_then(|s| s.to_str())
                .map(str::to_lowercase)
                .as_deref(),
            Some("md" | "markdown")
        );

        let final_path = display_path(&canonical);

        if is_markdown {
            Ok(ExternalTargetResult {
                action: "markdown".into(),
                path: Some(final_path),
            })
        } else {
            if !cfg!(test) {
                let wide_open: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
                let wide_path: Vec<u16> = final_path.encode_utf16().chain(Some(0)).collect();
                let res = unsafe {
                    ShellExecuteW(
                        std::ptr::null_mut(),
                        wide_open.as_ptr(),
                        wide_path.as_ptr(),
                        std::ptr::null(),
                        std::ptr::null(),
                        1,
                    )
                };
                if (res as isize) <= 32 {
                    return Err(error("File tidak bisa dibuka di aplikasi bawaan."));
                }
            }
            Ok(ExternalTargetResult {
                action: "external".into(),
                path: Some(final_path),
            })
        }
    }
}

#[tauri::command]
pub async fn open_markdown(
    tab_id: String,
    path: String,
    state: State<'_, Store>,
) -> Result<DocumentInfo> {
    state
        .lock()
        .map_err(|_| error("Sesi dokumen tidak tersedia."))?
        .open_tab(&tab_id, Path::new(&path))
}

#[tauri::command]
pub fn new_markdown(state: State<Store>) -> Result<()> {
    *state
        .lock()
        .map_err(|_| error("Sesi dokumen tidak tersedia."))? = MarkdownStore::default();
    Ok(())
}

#[tauri::command]
pub fn new_markdown_tab(tab_id: String, state: State<Store>) -> Result<()> {
    state
        .lock()
        .map_err(|_| error("Sesi dokumen tidak tersedia."))?
        .new_tab(&tab_id)
}

#[tauri::command]
pub fn prepare_markdown_save(
    tab_id: String,
    path: String,
    state: State<Store>,
) -> Result<SaveInfo> {
    state
        .lock()
        .map_err(|_| error("Sesi dokumen tidak tersedia."))?
        .prepare_tab(&tab_id, Path::new(&path))
}

#[tauri::command]
pub async fn save_markdown(
    tab_id: String,
    text: String,
    token: Option<String>,
    state: State<'_, Store>,
) -> Result<DocumentInfo> {
    state
        .lock()
        .map_err(|_| error("Sesi dokumen tidak tersedia."))?
        .save_tab(&tab_id, &text, token.as_deref())
}

#[tauri::command]
pub fn close_markdown_tab(tab_id: String, state: State<Store>) -> Result<()> {
    state
        .lock()
        .map_err(|_| error("Sesi dokumen tidak tersedia."))?
        .close_tab(&tab_id)
}

#[tauri::command]
pub async fn markdown_image(
    tab_id: Option<String>,
    source: String,
    state: State<'_, Store>,
) -> Result<String> {
    state
        .lock()
        .map_err(|_| error("Sesi dokumen tidak tersedia."))?
        .image(tab_id.as_deref(), &source)
}

#[tauri::command]
pub fn open_external_target(
    tab_id: Option<String>,
    target: String,
    state: State<'_, Store>,
) -> Result<ExternalTargetResult> {
    state
        .lock()
        .map_err(|_| error("Sesi dokumen tidak tersedia."))?
        .open_external_target(tab_id.as_deref(), &target)
}

#[tauri::command]
pub fn markdown_link(source: String, state: State<Store>) -> Result<String> {
    let store = state
        .lock()
        .map_err(|_| error("Sesi dokumen tidak tersedia."))?;
    let current = store
        .documents
        .values()
        .next()
        .ok_or_else(|| error("Dokumen belum memiliki lokasi."))?;
    let path = current.path.parent().unwrap().join(source);
    check_extension(&path)?;
    Ok(display_path(&path))
}

#[tauri::command]
pub fn take_pending_markdown(state: State<PendingMarkdown>) -> Option<String> {
    state.0.lock().ok()?.take()
}

#[tauri::command]
pub fn open_web_link(url: String) -> Result<()> {
    let parsed = tauri::Url::parse(&url).map_err(|_| error("Alamat link tidak valid."))?;
    if !["http", "https"].contains(&parsed.scheme()) || url.chars().any(|c| c.is_control()) {
        return Err(error("Hanya link http/https yang dapat dibuka."));
    }
    let wide: Vec<u16> = parsed.as_str().encode_utf16().chain(Some(0)).collect();
    let verb: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
    if unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            wide.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
        )
    } as isize
        <= 32
    {
        return Err(error("Link tidak bisa dibuka di browser."));
    }
    Ok(())
}

pub fn file_argument(args: &[String], cwd: &Path) -> Option<String> {
    args.iter().skip(1).find_map(|arg| {
        let path = Path::new(arg);
        check_extension(path).ok()?;
        Some(display_path(&if path.is_absolute() {
            path.to_owned()
        } else {
            cwd.join(path)
        }))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture {
        root: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("local-tools-md-{}", Uuid::new_v4()));
            fs::create_dir(&root).unwrap();
            Self { root }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn preserves_bom_crlf_and_frontmatter_on_save() {
        let f = Fixture::new();
        let path = f.root.join("note.md");
        fs::write(&path, b"\xef\xbb\xbf---\r\ntitle: Test\r\n---\r\n# One\r\n").unwrap();
        let mut store = MarkdownStore::default();
        let opened = store.open_tab("tab-1", &path).unwrap();
        assert_eq!(opened.line_ending, "CRLF");
        store
            .save_tab("tab-1", &opened.text.replace("One", "Two"), None)
            .unwrap();
        assert_eq!(
            fs::read(&path).unwrap(),
            b"\xef\xbb\xbf---\r\ntitle: Test\r\n---\r\n# Two\r\n"
        );
    }

    #[test]
    fn external_edit_blocks_save_and_keeps_external_content() {
        let f = Fixture::new();
        let path = f.root.join("note.md");
        fs::write(&path, "old").unwrap();
        let mut store = MarkdownStore::default();
        store.open_tab("tab-1", &path).unwrap();
        fs::write(&path, "external").unwrap();
        assert_eq!(
            store.save_tab("tab-1", "mine", None).unwrap_err().kind,
            "conflict"
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
    }

    #[test]
    fn save_as_checks_snapshot_and_never_clobbers_new_target() {
        let f = Fixture::new();
        let path = f.root.join("new.md");
        let mut store = MarkdownStore::default();
        let target = store.prepare_tab("tab-1", &path).unwrap();
        fs::write(&path, "created elsewhere").unwrap();
        assert_eq!(
            store
                .save_tab("tab-1", "draft", Some(&target.token))
                .unwrap_err()
                .kind,
            "conflict"
        );
        let approved = store.prepare_tab("tab-1", &path).unwrap();
        assert!(approved.exists);
        store
            .save_tab("tab-1", "approved replacement", Some(&approved.token))
            .unwrap();
        assert_eq!(fs::read_to_string(path).unwrap(), "approved replacement");
    }

    #[test]
    fn rejects_non_utf8_binary_and_wrong_extension_without_losing_open_document() {
        let f = Fixture::new();
        let valid = f.root.join("valid.md");
        fs::write(&valid, "safe").unwrap();
        let mut store = MarkdownStore::default();
        store.open_tab("tab-1", &valid).unwrap();
        for bytes in [vec![0xff, 0xfe], b"binary\0data".to_vec()] {
            let bad = f.root.join("bad.md");
            fs::write(&bad, bytes).unwrap();
            assert!(store.open_tab("tab-1", &bad).is_err());
        }
        assert!(store.open_tab("tab-1", &f.root.join("file.exe")).is_err());
        store.save_tab("tab-1", "still here", None).unwrap();
        assert_eq!(fs::read_to_string(valid).unwrap(), "still here");
    }

    #[test]
    fn image_loads_from_absolute_and_relative_paths() {
        let f = Fixture::new();
        let assets = f.root.join("assets");
        fs::create_dir(&assets).unwrap();
        let img_path = assets.join("test.png");
        fs::write(&img_path, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).unwrap();

        let svg_path = assets.join("graphic.svg");
        fs::write(
            &svg_path,
            b"<svg xmlns=\"http://www.w3.org/2000/svg\"><circle r=\"10\"/></svg>",
        )
        .unwrap();

        let doc_dir = f.root.join("docs");
        fs::create_dir(&doc_dir).unwrap();
        let md = doc_dir.join("note.md");
        fs::write(&md, "# Notes").unwrap();

        let mut store = MarkdownStore::default();
        store.open_tab("tab-1", &md).unwrap();

        // 1. Relative path with ../ parent traversal
        let uri_rel = store.image(Some("tab-1"), "../assets/test.png").unwrap();
        assert!(uri_rel.starts_with("data:image/png;base64,"));

        // 2. Absolute path
        let uri_abs = store
            .image(Some("tab-1"), img_path.to_str().unwrap())
            .unwrap();
        assert!(uri_abs.starts_with("data:image/png;base64,"));

        // 3. SVG MIME handling
        let uri_svg = store.image(Some("tab-1"), "../assets/graphic.svg").unwrap();
        assert!(uri_svg.starts_with("data:image/svg+xml;base64,"));

        // 4. Fallback when tab_id is None
        let uri_fallback = store.image(None, "../assets/test.png").unwrap();
        assert!(uri_fallback.starts_with("data:image/png;base64,"));

        // 5. Invalid format / extension rejected
        assert!(store.image(Some("tab-1"), "note.md").is_err());

        // 6. Non-existent file rejected
        assert!(store.image(Some("tab-1"), "../assets/missing.png").is_err());
    }

    #[test]
    fn external_target_classifies_and_resolves_files() {
        let f = Fixture::new();
        let doc_dir = f.root.join("docs");
        fs::create_dir(&doc_dir).unwrap();
        let main_md = doc_dir.join("main.md");
        let other_md = doc_dir.join("other.md");
        fs::write(&main_md, "# Main").unwrap();
        fs::write(&other_md, "# Other").unwrap();

        let assets_dir = f.root.join("assets");
        fs::create_dir(&assets_dir).unwrap();
        let pdf_file = assets_dir.join("document.pdf");
        fs::write(&pdf_file, b"%PDF-1.4").unwrap();

        let mut store = MarkdownStore::default();
        store.open_tab("tab-1", &main_md).unwrap();

        // 1. Web URL
        let web_res = store
            .open_external_target(Some("tab-1"), "https://example.com/test")
            .unwrap();
        assert_eq!(web_res.action, "web");
        assert_eq!(web_res.path, None);

        // 2. Relative markdown file
        let md_res = store
            .open_external_target(Some("tab-1"), "other.md")
            .unwrap();
        assert_eq!(md_res.action, "markdown");
        assert_eq!(
            md_res.path,
            Some(display_path(&fs::canonicalize(&other_md).unwrap()))
        );

        // 3. Relative markdown file with anchor fragment
        let md_anchor_res = store
            .open_external_target(Some("tab-1"), "other.md#heading")
            .unwrap();
        assert_eq!(md_anchor_res.action, "markdown");
        assert_eq!(
            md_anchor_res.path,
            Some(display_path(&fs::canonicalize(&other_md).unwrap()))
        );

        // 4. Non-md file (relative with parent traversal)
        let ext_res = store
            .open_external_target(Some("tab-1"), "../assets/document.pdf")
            .unwrap();
        assert_eq!(ext_res.action, "external");
        assert_eq!(
            ext_res.path,
            Some(display_path(&fs::canonicalize(&pdf_file).unwrap()))
        );

        // 5. Non-md file (absolute path)
        let ext_abs_res = store
            .open_external_target(Some("tab-1"), pdf_file.to_str().unwrap())
            .unwrap();
        assert_eq!(ext_abs_res.action, "external");
        assert_eq!(
            ext_abs_res.path,
            Some(display_path(&fs::canonicalize(&pdf_file).unwrap()))
        );

        // 6. Missing file returns error
        let err = store
            .open_external_target(Some("tab-1"), "missing.pdf")
            .unwrap_err();
        assert!(err.message.starts_with("File lokal tidak ditemukan:"));
    }

    #[test]
    fn multitab_store_isolates_documents() {
        let f = Fixture::new();
        let file1 = f.root.join("doc1.md");
        let file2 = f.root.join("doc2.md");
        fs::write(&file1, "Konten Dokumen Satu").unwrap();
        fs::write(&file2, "Konten Dokumen Dua").unwrap();

        let mut store = MarkdownStore::default();
        let info1 = store.open_tab("tab-1", &file1).unwrap();
        let info2 = store.open_tab("tab-2", &file2).unwrap();

        assert_eq!(info1.text, "Konten Dokumen Satu");
        assert_eq!(info2.text, "Konten Dokumen Dua");

        let saved1 = store
            .save_tab("tab-1", "Dokumen Satu Diedit", None)
            .unwrap();
        assert_eq!(saved1.text, "Dokumen Satu Diedit");

        // Pastikan tab-2 tidak terpengaruh
        assert_eq!(
            store.documents.get("tab-2").unwrap().version.bytes,
            b"Konten Dokumen Dua"
        );

        store.close_tab("tab-1").unwrap();
        assert!(!store.documents.contains_key("tab-1"));
        assert!(store.documents.contains_key("tab-2"));
    }
}
