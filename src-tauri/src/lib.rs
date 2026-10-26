use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Native "Save as" dialog, then write `contents` to the chosen file. Returns the path, or None if cancelled.
#[tauri::command]
async fn save_text(app: AppHandle, name: String, contents: String) -> Result<Option<String>, String> {
    let ext = std::path::Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("txt")
        .to_string();
    let picked = app
        .dialog()
        .file()
        .set_file_name(&name)
        .add_filter(ext.to_uppercase(), &[ext.as_str()])
        .blocking_save_file();
    match picked {
        None => Ok(None),
        Some(p) => {
            let path = p.into_path().map_err(|e| e.to_string())?;
            std::fs::write(&path, contents).map_err(|e| e.to_string())?;
            Ok(Some(path.display().to_string()))
        }
    }
}

/// Native "Open" dialog for a text file (session / preset JSON). Returns (file name, contents) or None.
#[tauri::command]
async fn open_text(app: AppHandle, ext: String) -> Result<Option<(String, String)>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter(ext.to_uppercase(), &[ext.as_str()])
        .blocking_pick_file();
    match picked {
        None => Ok(None),
        Some(p) => {
            let path = p.into_path().map_err(|e| e.to_string())?;
            let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            Ok(Some((name, text)))
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_text, open_text])
        .run(tauri::generate_context!())
        .expect("error while running UniSim");
}
