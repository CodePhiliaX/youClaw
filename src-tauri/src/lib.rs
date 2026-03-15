use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager,
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_store::StoreExt;
use std::sync::Mutex;
use std::time::Duration;
use std::net::TcpListener;

/// Sidecar child process handle
struct SidecarState(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

#[derive(Clone, Serialize)]
struct SidecarEvent {
    status: String,
    message: String,
}

/// Find an available port by binding to port 0
fn find_available_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to find available port: {}", e))?;
    let port = listener.local_addr()
        .map_err(|e| format!("Failed to get local addr: {}", e))?
        .port();
    drop(listener);
    Ok(port)
}

/// Spawn the sidecar backend
fn spawn_sidecar(app: &AppHandle) -> Result<u16, String> {
    let state = app.state::<SidecarState>();

    // Allocate a random available port
    let port = find_available_port()?;
    log::info!("Allocated random port {} for sidecar", port);

    // Model config (API Key, Base URL, Model ID) is now managed by the backend
    // via Settings API (SQLite kv_state), no longer injected from Tauri Store.
    let mut env_vars: Vec<(String, String)> = vec![];
    env_vars.push(("PORT".into(), port.to_string()));

    if let Ok(store) = app.store("settings.json") {
        // Write port to store for frontend to read
        let _ = store.set("port", serde_json::Value::String(port.to_string()));
        let _ = store.save();
    }

    // Set data directory
    if let Some(app_data) = app.path().app_data_dir().ok() {
        env_vars.push(("DATA_DIR".into(), app_data.to_string_lossy().to_string()));
    }

    // Ensure PATH includes common bun/node install paths (PATH is minimal when launched from Finder)
    {
        let current_path = std::env::var("PATH").unwrap_or_default();
        let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/default".into());
        let extra_paths = [
            format!("{}/.bun/bin", home),
            format!("{}/.cargo/bin", home),
            format!("{}/.nvm/current/bin", home),
            "/usr/local/bin".into(),
            "/opt/homebrew/bin".into(),
        ];
        let mut path_parts: Vec<&str> = current_path.split(':').collect();
        for p in &extra_paths {
            if !path_parts.contains(&p.as_str()) {
                path_parts.push(p.as_str());
            }
        }
        env_vars.push(("PATH".into(), path_parts.join(":")));
    }

    // Set resource directory (read-only templates for agents/skills/prompts)
    match app.path().resource_dir() {
        Ok(resource_dir) => {
            log::info!("Resource dir: {}", resource_dir.display());
            env_vars.push(("RESOURCES_DIR".into(), resource_dir.to_string_lossy().to_string()));
        }
        Err(e) => {
            log::warn!("Failed to get resource_dir: {}, falling back to exe dir", e);
            // Fallback: Resources directory relative to the executable
            if let Ok(exe) = std::env::current_exe() {
                if let Some(macos_dir) = exe.parent() {
                    let resources = macos_dir.parent().unwrap_or(macos_dir).join("Resources");
                    if resources.exists() {
                        env_vars.push(("RESOURCES_DIR".into(), resources.to_string_lossy().to_string()));
                    }
                }
            }
        }
    }

    let shell = app.shell();
    let mut cmd = shell.sidecar("youclaw-server").map_err(|e| e.to_string())?;

    for (key, val) in env_vars {
        cmd = cmd.env(key, val);
    }

    let app_handle = app.clone();
    let (mut rx, child) = cmd.spawn().map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    // Store child process handle
    let mut guard = state.0.lock().unwrap();
    *guard = Some(child);

    // Listen to sidecar output
    let app_for_events = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                    log::info!("[sidecar] {}", String::from_utf8_lossy(&line));
                }
                tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                    log::warn!("[sidecar] {}", String::from_utf8_lossy(&line));
                }
                tauri_plugin_shell::process::CommandEvent::Terminated(payload) => {
                    log::error!("[sidecar] terminated with code: {:?}", payload.code);
                    let _ = app_for_events.emit("sidecar-event", SidecarEvent {
                        status: "terminated".into(),
                        message: format!("Sidecar exited with code: {:?}", payload.code),
                    });
                }
                _ => {}
            }
        }
    });

    Ok(port)
}

/// Wait for backend health check using stdlib TCP (no reqwest dependency)
async fn wait_for_health(port: u16, max_retries: u32) -> Result<(), String> {
    let addr = format!("127.0.0.1:{}", port);

    for i in 0..max_retries {
        if let Ok(mut stream) = std::net::TcpStream::connect_timeout(
            &addr.parse().unwrap(),
            Duration::from_millis(500),
        ) {
            use std::io::{Write, Read};
            let req = format!("GET /api/health HTTP/1.0\r\nHost: localhost:{}\r\n\r\n", port);
            if stream.write_all(req.as_bytes()).is_ok() {
                let mut buf = [0u8; 256];
                if let Ok(n) = stream.read(&mut buf) {
                    let resp = String::from_utf8_lossy(&buf[..n]);
                    if resp.contains("200") {
                        log::info!("Backend health check passed after {} attempts", i + 1);
                        return Ok(());
                    }
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    Err("Backend health check failed after max retries".into())
}

/// Kill the sidecar process
fn kill_sidecar(app: &AppHandle) {
    let state = app.state::<SidecarState>();
    let mut guard = state.0.lock().unwrap();
    if let Some(child) = guard.take() {
        let pid = child.pid();
        // Windows: use taskkill /T to kill entire process tree (including bun child processes)
        #[cfg(target_os = "windows")]
        {
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .output();
            log::info!("Sidecar process tree killed (PID: {})", pid);
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = child.kill();
            log::info!("Sidecar process killed (PID: {})", pid);
        }
    }
}

// ===== Tauri Commands =====

#[tauri::command]
fn get_version(app: AppHandle) -> String {
    app.config().version.clone().unwrap_or_else(|| "unknown".into())
}

#[tauri::command]
fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

#[tauri::command]
async fn restart_sidecar(app: AppHandle) -> Result<(), String> {
    kill_sidecar(&app);
    tokio::time::sleep(Duration::from_millis(500)).await;
    let port = spawn_sidecar(&app)?;
    wait_for_health(port, 30).await
}



#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(SidecarState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            get_version,
            get_platform,
            restart_sidecar,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // Create system tray
            let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            // Load template icon for tray (auto-adapts to macOS dark/light mode)
            let tray_icon = Image::from_bytes(include_bytes!("../icons/trayTemplate@2x.png"))
                .expect("failed to load tray icon");

            let _tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .icon_as_template(true)
                .menu(&menu)
                .on_menu_event(move |app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                        "quit" => {
                            kill_sidecar(app);
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Start backend (dev mode uses beforeDevCommand, release mode uses sidecar)
            let app_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                let port: u16;

                #[cfg(not(debug_assertions))]
                {
                    match spawn_sidecar(&app_handle) {
                        Ok(p) => port = p,
                        Err(e) => {
                            log::error!("Failed to spawn sidecar: {}", e);
                            let _ = app_handle.emit("sidecar-event", SidecarEvent {
                                status: "error".into(),
                                message: e,
                            });
                            return;
                        }
                    }
                }
                #[cfg(debug_assertions)]
                {
                    // Dev mode: read PORT from .env and write it to store for frontend use
                    port = std::fs::read_to_string(
                        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.env")
                    )
                    .ok()
                    .and_then(|content| {
                        content.lines()
                            .find(|l| l.starts_with("PORT="))
                            .and_then(|l| l.strip_prefix("PORT="))
                            .and_then(|v| v.trim().parse::<u16>().ok())
                    })
                    .unwrap_or(3000);

                    if let Ok(store) = app_handle.store("settings.json") {
                        let _ = store.set("port", serde_json::Value::String(port.to_string()));
                    }
                    log::info!("Dev mode: skipping sidecar, using bun dev server on port {}", port);
                }

                match wait_for_health(port, 60).await {
                    Ok(_) => {
                        let _ = app_handle.emit("sidecar-event", SidecarEvent {
                            status: "ready".into(),
                            message: format!("Backend ready on port {}", port),
                        });
                    }
                    Err(e) => {
                        log::error!("Health check failed: {}", e);
                        let _ = app_handle.emit("sidecar-event", SidecarEvent {
                            status: "error".into(),
                            message: e,
                        });
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide to tray on close instead of quitting
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match event {
                tauri::RunEvent::Exit => {
                    kill_sidecar(app);
                }
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen { has_visible_windows, .. } => {
                    if !has_visible_windows {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                }
                _ => {}
            }
        });
}
