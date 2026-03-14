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

/// Sidecar 子进程句柄
struct SidecarState(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

#[derive(Clone, Serialize)]
struct SidecarEvent {
    status: String,
    message: String,
}

/// 在动态端口范围内找一个可用端口
fn find_available_port() -> Result<u16, String> {
    // 绑定 0 端口让系统分配一个可用端口
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to find available port: {}", e))?;
    let port = listener.local_addr()
        .map_err(|e| format!("Failed to get local addr: {}", e))?
        .port();
    // listener drop 时释放端口，sidecar 立即绑定
    drop(listener);
    Ok(port)
}

/// 启动 sidecar 后端
fn spawn_sidecar(app: &AppHandle) -> Result<u16, String> {
    let state = app.state::<SidecarState>();

    // 分配随机可用端口
    let port = find_available_port()?;
    log::info!("Allocated random port {} for sidecar", port);

    // 从 Tauri Store 读取设置，注入到环境变量
    let mut env_vars: Vec<(String, String)> = vec![];
    env_vars.push(("PORT".into(), port.to_string()));

    if let Ok(store) = app.store("settings.json") {
        if let Some(api_key) = store.get("api-key") {
            if let Some(key) = api_key.as_str() {
                if !key.is_empty() {
                    env_vars.push(("ANTHROPIC_API_KEY".into(), key.to_string()));
                }
            }
        }
        if let Some(base_url) = store.get("base-url") {
            if let Some(url) = base_url.as_str() {
                if !url.is_empty() {
                    env_vars.push(("ANTHROPIC_BASE_URL".into(), url.to_string()));
                }
            }
        }
        // 将动态端口写入 store，前端从 store 读取
        let _ = store.set("port", serde_json::Value::String(port.to_string()));
        let _ = store.save();
    }

    // 设置数据目录
    if let Some(app_data) = app.path().app_data_dir().ok() {
        env_vars.push(("DATA_DIR".into(), app_data.to_string_lossy().to_string()));
    }

    // 确保 PATH 包含常见的 bun/node 安装路径（Finder 启动时 PATH 很短）
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

    // 设置资源目录（agents/skills/prompts 的只读模板）
    match app.path().resource_dir() {
        Ok(resource_dir) => {
            log::info!("Resource dir: {}", resource_dir.display());
            env_vars.push(("RESOURCES_DIR".into(), resource_dir.to_string_lossy().to_string()));
        }
        Err(e) => {
            log::warn!("Failed to get resource_dir: {}, falling back to exe dir", e);
            // fallback: 可执行文件所在目录的上级 Resources 目录
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

    // 存储子进程句柄
    let mut guard = state.0.lock().unwrap();
    *guard = Some(child);

    // 监听 sidecar 输出
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

/// 等待后端健康检查通过（用标准库发最简 HTTP GET，不依赖 reqwest）
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

/// 杀死 sidecar 进程
fn kill_sidecar(app: &AppHandle) {
    let state = app.state::<SidecarState>();
    let mut guard = state.0.lock().unwrap();
    if let Some(child) = guard.take() {
        let _ = child.kill();
        log::info!("Sidecar process killed");
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

/// 从 store 或默认值获取端口
#[cfg(debug_assertions)]
fn get_port(app: &AppHandle) -> u16 {
    if let Ok(store) = app.store("settings.json") {
        if let Some(port_val) = store.get("port") {
            if let Some(p) = port_val.as_str() {
                if let Ok(port) = p.parse::<u16>() {
                    return port;
                }
            }
        }
    }
    3000
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

            // 创建系统托盘
            let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            // 加载托盘专用 template 图标（macOS 菜单栏自动适配深色/浅色模式）
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

            // 启动后端（dev 模式由 beforeDevCommand 启动，release 模式用 sidecar）
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
                    log::info!("Dev mode: skipping sidecar, using bun dev server");
                    port = get_port(&app_handle);
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
            // 点击关闭按钮时隐藏到托盘，而非退出
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
                // macOS: 点击 Dock 图标时重新显示窗口
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
