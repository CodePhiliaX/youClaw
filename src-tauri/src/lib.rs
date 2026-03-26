use serde::Serialize;
use std::sync::{
    Mutex,
    atomic::{AtomicBool, AtomicU8, Ordering},
};
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Listener, Manager,
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_log::{Target, TargetKind, TimezoneStrategy};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_store::StoreExt;

/// Sidecar child process handle
struct SidecarState(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

/// Sidecar readiness state: 0 = pending, 1 = ready, 2 = error, 3 = port-conflict
struct SidecarReadyState {
    state: AtomicU8,
    port: Mutex<u16>,
    message: Mutex<String>,
}

/// Deep-link delivery state shared between startup and the running frontend.
struct DeepLinkState {
    pending: Mutex<Vec<String>>,
    frontend_ready: AtomicBool,
}

impl DeepLinkState {
    fn new() -> Self {
        Self {
            pending: Mutex::new(Vec::new()),
            frontend_ready: AtomicBool::new(false),
        }
    }
}

impl SidecarReadyState {
    fn new() -> Self {
        Self {
            state: AtomicU8::new(0),
            port: Mutex::new(62601),
            message: Mutex::new(String::new()),
        }
    }
}

#[derive(Clone, Serialize)]
struct SidecarEvent {
    status: String,
    message: String,
}

fn enqueue_deep_link(app: &AppHandle, url: String) {
    let state = app.state::<DeepLinkState>();
    let mut guard = state.pending.lock().unwrap();
    if !guard.contains(&url) {
        guard.push(url);
    }
}

fn normalize_deep_link(raw: &str) -> Option<String> {
    let start = raw.find("youclaw://")?;
    let candidate = raw[start..]
        .trim()
        .trim_matches(|c: char| c == '"' || c == '\'' || c.is_whitespace())
        .trim_end_matches(|c: char| c == '"' || c == '\'' || c.is_whitespace())
        .to_string();

    if candidate.starts_with("youclaw://") {
        Some(candidate)
    } else {
        None
    }
}

fn forward_deep_link(app: &AppHandle, url: String) {
    let state = app.state::<DeepLinkState>();
    if state.frontend_ready.load(Ordering::SeqCst) {
        let _ = app.emit("deep-link-received", url);
        return;
    }
    enqueue_deep_link(app, url);
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum CloseAction {
    Ask,
    Minimize,
    Quit,
}

fn get_close_action(app: &AppHandle) -> CloseAction {
    match app.store("settings.json").ok()
        .and_then(|store| store.get("close_action"))
        .and_then(|v| v.as_str().map(str::trim).map(str::to_owned))
        .as_deref()
    {
        Some("minimize") => CloseAction::Minimize,
        Some("quit") => CloseAction::Quit,
        _ => CloseAction::Ask,
    }
}

fn hide_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

fn quit_application(app: &AppHandle) {
    kill_sidecar(app);
    app.exit(0);
}

fn find_windows_git_bash() -> Option<String> {
    use std::path::Path;

    let mut candidates: Vec<String> = vec![];

    if let Ok(path) = std::env::var("CLAUDE_CODE_GIT_BASH_PATH") {
        candidates.push(path);
    }

    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
    let program_files = std::env::var("ProgramFiles")
        .unwrap_or_else(|_| "C:\\Program Files".into());
    let program_files_x86 = std::env::var("ProgramFiles(x86)")
        .unwrap_or_else(|_| "C:\\Program Files (x86)".into());

    candidates.extend([
        format!("{}\\Git\\bin\\bash.exe", program_files),
        format!("{}\\Git\\bin\\bash.exe", program_files_x86),
        format!("{}\\Programs\\Git\\bin\\bash.exe", local_app_data),
        format!("{}\\scoop\\apps\\git\\current\\bin\\bash.exe", user_profile),
    ]);

    #[cfg(target_os = "windows")]
    let where_result = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("where")
            .arg("bash")
            .creation_flags(CREATE_NO_WINDOW)
            .output()
    };
    #[cfg(not(target_os = "windows"))]
    let where_result = std::process::Command::new("where").arg("bash").output();

    if let Ok(output) = where_result {
        if output.status.success() {
            let content = String::from_utf8_lossy(&output.stdout);
            for line in content.lines() {
                let candidate = line.trim();
                if !candidate.is_empty() {
                    candidates.push(candidate.to_string());
                }
            }
        }
    }

    for candidate in candidates {
        if Path::new(&candidate).exists() {
            return Some(candidate);
        }
    }

    None
}

fn add_windows_git_paths(extra_paths: &mut Vec<String>, bash_path: &str) {
    use std::path::{Path, PathBuf};

    fn push_if_exists(extra_paths: &mut Vec<String>, path: PathBuf) {
        if path.exists() {
            let path_str = path.to_string_lossy().to_string();
            if !extra_paths.contains(&path_str) {
                extra_paths.push(path_str);
            }
        }
    }

    let bash_path = Path::new(bash_path);
    let Some(bash_dir) = bash_path.parent() else { return };

    // For ...\\usr\\bin\\bash.exe -> git root is parent of usr
    // For ...\\bin\\bash.exe -> git root is parent of bin
    let git_root = if bash_dir.to_string_lossy().to_ascii_lowercase().ends_with("\\usr\\bin") {
        bash_dir.parent().and_then(|usr| usr.parent())
    } else {
        bash_dir.parent()
    };

    let Some(git_root) = git_root else { return };
    push_if_exists(extra_paths, git_root.join("bin"));
    push_if_exists(extra_paths, git_root.join("cmd"));
    push_if_exists(extra_paths, git_root.join("usr").join("bin"));
    push_if_exists(extra_paths, git_root.join("mingw64").join("bin"));
}

/// Spawn the sidecar backend
#[allow(dead_code)]
fn spawn_sidecar(app: &AppHandle) -> Result<u16, String> {
    let state = app.state::<SidecarState>();

    // Read preferred port from Tauri Store, default 62601
    let port: u16 = app.store("settings.json").ok()
        .and_then(|store| store.get("preferred_port"))
        .and_then(|v| v.as_str().and_then(|s| s.parse::<u16>().ok()))
        .unwrap_or(62601);
    log::info!("Using port {} (from store or default)", port);

    // Model config (API Key, Base URL, Model ID) is now managed by the backend
    // via Settings API (SQLite kv_state), no longer injected from Tauri Store.
    let mut env_vars: Vec<(String, String)> = vec![];
    env_vars.push(("PORT".into(), port.to_string()));
    env_vars.push(("YOUCLAW_USE_PREFERRED_PORT".into(), "1".into()));

    // Ensure PATH includes common bun/node install paths (PATH is minimal when launched from Finder/Explorer)
    {
        let current_path = std::env::var("PATH").unwrap_or_default();
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| {
                if cfg!(target_os = "windows") { "C:\\Users\\Default".into() }
                else { "/Users/default".into() }
            });

        let mut extra_paths: Vec<String> = if cfg!(target_os = "windows") {
            vec![
                format!("{}\\.bun\\bin", home),
                format!("{}\\.cargo\\bin", home),
                format!("{}\\scoop\\shims", home),
            ]
        } else {
            vec![
                format!("{}/.bun/bin", home),
                format!("{}/.cargo/bin", home),
                "/usr/local/bin".into(),
                "/opt/homebrew/bin".into(),
            ]
        };

        if cfg!(target_os = "windows") {
            // nvm-windows uses NVM_HOME and NVM_SYMLINK env vars
            if let Ok(nvm_home) = std::env::var("NVM_HOME") {
                extra_paths.push(nvm_home);
            }
            if let Ok(nvm_symlink) = std::env::var("NVM_SYMLINK") {
                extra_paths.push(nvm_symlink);
            } else {
                // Fallback: standard Node.js install location
                let program_files = std::env::var("ProgramFiles")
                    .unwrap_or_else(|_| "C:\\Program Files".into());
                let nodejs_dir = format!("{}\\nodejs", program_files);
                if std::path::Path::new(&nodejs_dir).exists() {
                    extra_paths.push(nodejs_dir);
                }
            }
            if let Some(git_bash_path) = find_windows_git_bash() {
                log::info!("Git Bash found at: {}", git_bash_path);
                env_vars.push(("CLAUDE_CODE_GIT_BASH_PATH".into(), git_bash_path.clone()));
                add_windows_git_paths(&mut extra_paths, &git_bash_path);
            } else {
                log::warn!("Git Bash not found on Windows — shell commands may fail");
            }
        } else {
            // Resolve nvm's actual node bin path (nvm does not create ~/.nvm/current)
            let nvm_alias_path = format!("{}/.nvm/alias/default", home);
            if let Ok(alias) = std::fs::read_to_string(&nvm_alias_path) {
                let version_prefix = alias.trim();
                let nvm_versions_dir = format!("{}/.nvm/versions/node", home);
                if let Ok(entries) = std::fs::read_dir(&nvm_versions_dir) {
                    let mut matched: Option<String> = None;
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        let stripped = name.strip_prefix('v').unwrap_or(&name);
                        if stripped.starts_with(version_prefix)
                            || name == version_prefix
                            || name == format!("v{}", version_prefix)
                        {
                            matched = Some(name);
                        }
                    }
                    if let Some(ver) = matched {
                        extra_paths.push(format!("{}/{}/bin", nvm_versions_dir, ver));
                    }
                }
            }
        }

        let path_sep = if cfg!(target_os = "windows") { ";" } else { ":" };
        let mut path_parts: Vec<&str> = current_path.split(path_sep).collect();
        for p in &extra_paths {
            if !path_parts.contains(&p.as_str()) {
                path_parts.push(p.as_str());
            }
        }
        env_vars.push(("PATH".into(), path_parts.join(path_sep)));
    }

    // Ensure HOME and USERPROFILE are available for subprocess (cli.js needs them)
    if cfg!(target_os = "windows") {
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            env_vars.push(("USERPROFILE".into(), userprofile.clone()));
            if std::env::var("HOME").is_err() {
                env_vars.push(("HOME".into(), userprofile));
            }
        }
        // Inject TEMP/TMP/BUN_TMPDIR so Bun uses the correct temp directory on Windows.
        // Without these, Bun may fall back to an unexpected drive (e.g. B:\~BUN\root)
        // which can cause port binding failures if that drive has restricted permissions.
        if let Ok(temp) = std::env::var("TEMP") {
            env_vars.push(("TEMP".into(), temp.clone()));
            env_vars.push(("TMP".into(), temp.clone()));
            env_vars.push(("BUN_TMPDIR".into(), temp));
        }
    }

    // Set resource directory (read-only templates for agents/skills/prompts)
    match app.path().resource_dir() {
        Ok(resource_dir) => {
            let mut resource_str = resource_dir.to_string_lossy().to_string();
            // Strip Windows extended-length path prefix (\\?\)
            if resource_str.starts_with("\\\\?\\") {
                resource_str = resource_str[4..].to_string();
            }
            log::info!("Resource dir: {}", resource_str);
            env_vars.push(("RESOURCES_DIR".into(), resource_str));
        }
        Err(e) => {
            log::warn!("Failed to get resource_dir: {}, falling back to exe dir", e);
            // Fallback: Resources directory relative to the executable
            if let Ok(exe) = std::env::current_exe() {
                if let Some(exe_dir) = exe.parent() {
                    // Windows: resources are in the same directory as the exe
                    // macOS: exe -> MacOS/ -> Contents/ -> Resources/
                    let resources = if cfg!(target_os = "windows") {
                        exe_dir.to_path_buf()
                    } else {
                        exe_dir.parent().unwrap_or(exe_dir).join("Resources")
                    };
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
                    let line_str = String::from_utf8_lossy(&line);
                    log::warn!("[sidecar] {}", line_str);
                    if line_str.contains("[PORT_CONFLICT]") {
                        let _ = app_for_events.emit("sidecar-event", SidecarEvent {
                            status: "port-conflict".into(),
                            message: line_str.to_string(),
                        });
                    }
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
        // CREATE_NO_WINDOW prevents a console window from flashing on screen
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            log::info!("Sidecar process tree killed (PID: {})", pid);
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = child.kill();
            // Also kill any child processes to prevent port leaks
            let _ = std::process::Command::new("pkill")
                .args(["-KILL", "-P", &pid.to_string()])
                .output();
            log::info!("Sidecar process tree killed (PID: {})", pid);
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

/// Query current sidecar status (for frontend to check on startup, avoiding race condition)
#[tauri::command]
fn get_sidecar_status(app: AppHandle) -> SidecarEvent {
    let ready_state = app.state::<SidecarReadyState>();
    let state = ready_state.state.load(Ordering::SeqCst);
    let port = *ready_state.port.lock().unwrap();
    let message = ready_state.message.lock().unwrap().clone();
    match state {
        1 => SidecarEvent { status: "ready".into(), message: format!("Backend ready on port {}", port) },
        2 => SidecarEvent { status: "error".into(), message },
        3 => SidecarEvent { status: "port-conflict".into(), message },
        _ => SidecarEvent { status: "pending".into(), message: "Backend starting...".into() },
    }
}

#[tauri::command]
fn take_pending_deep_links(app: AppHandle) -> Vec<String> {
    let state = app.state::<DeepLinkState>();
    let mut guard = state.pending.lock().unwrap();
    std::mem::take(&mut *guard)
}

#[tauri::command]
fn set_deep_link_frontend_ready(app: AppHandle, ready: bool) {
    let state = app.state::<DeepLinkState>();
    state.frontend_ready.store(ready, Ordering::SeqCst);
}


#[tauri::command]
async fn restart_sidecar(#[allow(unused)] app: AppHandle) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        return Err("Dev mode: please restart 'bun dev:tauri' manually to apply port changes.".into());
    }
    #[cfg(not(debug_assertions))]
    {
        // Reset ready state to pending during restart
        let ready_state = app.state::<SidecarReadyState>();
        ready_state.state.store(0, Ordering::SeqCst);

        kill_sidecar(&app);
        tokio::time::sleep(Duration::from_millis(1000)).await;
        let port = spawn_sidecar(&app)?;
        wait_for_health(port, 30).await?;

        let ready_state = app.state::<SidecarReadyState>();
        *ready_state.port.lock().unwrap() = port;
        ready_state.state.store(1, Ordering::SeqCst);

        let _ = app.emit("sidecar-event", SidecarEvent {
            status: "ready".into(),
            message: format!("Backend ready on port {}", port),
        });
        Ok(())
    }
}




#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                ])
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .max_file_size(5_000_000) // 5 MB per log file, auto-rotates
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED
                        | tauri_plugin_window_state::StateFlags::VISIBLE
                        | tauri_plugin_window_state::StateFlags::FULLSCREEN,
                )
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Windows: when a second instance is launched, args contain deep link URL
            // Forward the URL to the running instance and bring its window to front
            log::info!("Single instance callback, args: {:?}", args);
            for arg in &args {
                if let Some(url) = normalize_deep_link(arg) {
                    forward_deep_link(app, url);
                    break;
                }
            }
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
                let _ = win.unminimize();
            }
        }))
        .manage(SidecarState(Mutex::new(None)))
        .manage(SidecarReadyState::new())
        .manage(DeepLinkState::new())
        .invoke_handler(tauri::generate_handler![
            get_version,
            get_platform,
            get_sidecar_status,
            take_pending_deep_links,
            set_deep_link_frontend_ready,
            restart_sidecar,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            for arg in std::env::args().skip(1) {
                if let Some(url) = normalize_deep_link(&arg) {
                    enqueue_deep_link(&handle, url);
                }
            }

            // macOS: overlay titlebar style (traffic lights over content, hidden title)
            #[cfg(target_os = "macos")]
            {
                use tauri::TitleBarStyle;
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_title_bar_style(TitleBarStyle::Overlay);
                    let _ = win.set_title("");
                }
            }

            // Show main window after window-state plugin has restored position/size
            // (window starts hidden via tauri.conf.json to prevent flicker on Windows)
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
            }

            // Create system tray (i18n based on system locale)
            let is_zh = sys_locale::get_locale()
                .map(|l| l.starts_with("zh"))
                .unwrap_or(false);
            let show_label = if is_zh { "显示窗口" } else { "Show Window" };
            let quit_label = if is_zh { "退出" } else { "Quit" };
            let show_item = MenuItem::with_id(app, "show", show_label, true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", quit_label, true, None::<&str>)?;
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
                            show_main_window(app);
                        }
                        "quit" => {
                            quit_application(app);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        show_main_window(app);
                    }
                })
                .build(app)?;

            // Listen for deep link events and forward to frontend
            let dl_handle = handle.clone();
            app.listen("deep-link://new-url", move |event: tauri::Event| {
                if let Ok(urls) = serde_json::from_str::<Vec<String>>(event.payload()) {
                    for url in urls {
                        forward_deep_link(&dl_handle, url);
                    }
                    // Bring window to foreground
                    if let Some(win) = dl_handle.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            });

            let minimize_handle = handle.clone();
            app.listen("close-action-minimize", move |_| {
                hide_main_window(&minimize_handle);
            });

            let quit_handle = handle.clone();
            app.listen("close-action-quit", move |_| {
                quit_application(&quit_handle);
            });

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
                    // Dev mode: use .env PORT, then default.
                    // Do not reuse the persisted preferred_port from the desktop app.
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
                    .unwrap_or(62601);

                    log::info!("Dev mode: skipping sidecar, using bun dev server on port {}", port);
                }

                match wait_for_health(port, 60).await {
                    Ok(_) => {
                        // Update ready state before emitting event (frontend can query this)
                        let ready_state = app_handle.state::<SidecarReadyState>();
                        *ready_state.port.lock().unwrap() = port;
                        ready_state.state.store(1, Ordering::SeqCst);

                        let _ = app_handle.emit("sidecar-event", SidecarEvent {
                            status: "ready".into(),
                            message: format!("Backend ready on port {}", port),
                        });
                    }
                    Err(e) => {
                        log::error!("Health check failed: {}", e);
                        let ready_state = app_handle.state::<SidecarReadyState>();
                        *ready_state.message.lock().unwrap() = e.clone();
                        ready_state.state.store(2, Ordering::SeqCst);

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
            if window.label() != "main" {
                return;
            }

            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();

                let handle = window.app_handle().clone();
                match get_close_action(&handle) {
                    CloseAction::Minimize => hide_main_window(&handle),
                    CloseAction::Quit => quit_application(&handle),
                    CloseAction::Ask => {
                        let _ = handle.emit("close-requested", ());
                    }
                }
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
