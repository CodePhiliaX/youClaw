// 清除 CLAUDECODE 环境变量，避免 Claude Agent SDK 检测到嵌套 session 而拒绝运行
delete process.env.CLAUDECODE;

import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, nativeTheme } from "electron";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { setupUpdater, checkForUpdates, setAllowPrerelease } from "./updater.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// ===== 后端直接集成（无 HTTP 端口） =====

/** 获取后端编译产物目录 */
function getBackendDir(): string {
  // __dirname = dist/electron/main/，向上 3 级 = 项目根目录
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app", "dist", "src");
  }
  return path.join(__dirname, "../../../dist/src");
}

/** 导入编译后的后端模块 */
async function importBackend(name: string): Promise<any> {
  const modulePath = path.join(getBackendDir(), name);
  return import(modulePath);
}

/**
 * 启动内嵌后端
 * - 初始化所有后端模块（DB、EventBus、AgentManager 等）
 * - 创建 Hono app（仅用于路由，不起 HTTP 端口）
 * - 注册 IPC handler：renderer 通过 "api-fetch" 调用 Hono 路由
 * - 桥接 EventBus → IPC 事件推送（替代 SSE）
 */
/** 手动加载 .env 文件（Bun 自动加载，Electron/Node 不会） */
function loadDotEnv(): void {
  // 从项目根目录查找 .env
  const rootDir = app.isPackaged
    ? path.join(process.resourcesPath, "app")
    : path.join(__dirname, "../../..");
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // 去除引号
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // 不覆盖已有的环境变量
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function startEmbeddedBackend(): Promise<void> {
  // 加载 .env 文件
  loadDotEnv();

  // 设置默认 DATA_DIR
  if (!process.env.DATA_DIR) {
    process.env.DATA_DIR = path.join(app.getPath("userData"), "data");
  }

  // 动态导入编译后的后端模块（.js）
  const { loadEnv, getEnv } = await importBackend("config/index.js");
  const { initLogger } = await importBackend("logger/index.js");
  const { initDatabase, createTask, updateTask, deleteTask, getTasks, getTask } =
    await importBackend("db/index.js");
  const { EventBus } = await importBackend("events/index.js");
  const { AgentManager, AgentQueue, PromptBuilder } = await importBackend("agent/index.js");
  const { MessageRouter, TelegramChannel } = await importBackend("channel/index.js");
  const { SkillsLoader, SkillsWatcher } = await importBackend("skills/index.js");
  const { MemoryManager } = await importBackend("memory/index.js");
  const { Scheduler } = await importBackend("scheduler/index.js");
  const { IpcWatcher, writeTasksSnapshot } = await importBackend("ipc/index.js");
  const { createApp } = await importBackend("routes/index.js");

  // 1. 加载环境变量
  loadEnv();
  const env = getEnv();

  // 2. 初始化日志
  const logger = initLogger();
  logger.info("YouClaw Electron 主进程启动中...");

  // 3. 初始化数据库
  initDatabase();

  // 4. 创建 EventBus
  const eventBus = new EventBus();

  // 5. 创建 SkillsLoader 和 SkillsWatcher
  const skillsLoader = new SkillsLoader();
  logger.info({ count: skillsLoader.loadAllSkills().length }, "Skills 加载完成");

  const skillsWatcher = new SkillsWatcher(skillsLoader, {
    onReload: (skills: unknown[]) => {
      logger.info({ count: skills.length }, "Skills 热更新完成");
    },
  });
  skillsWatcher.start();

  // 6. 创建 MemoryManager
  const memoryManager = new MemoryManager();

  // 7. 创建 PromptBuilder 和 AgentManager
  const promptBuilder = new PromptBuilder(skillsLoader, memoryManager);
  const agentManager = new AgentManager(eventBus, promptBuilder);
  await agentManager.loadAgents();

  // 8. 创建 AgentQueue
  const agentQueue = new AgentQueue(agentManager);

  // 9. 创建 MessageRouter
  const router = new MessageRouter(agentManager, agentQueue, eventBus, memoryManager, skillsLoader);

  // 10. Telegram channel（如果配置了）
  if (env.TELEGRAM_BOT_TOKEN) {
    const telegramChannel = new TelegramChannel(env.TELEGRAM_BOT_TOKEN, {
      onMessage: (message: unknown) => router.handleInbound(message as any),
    });
    router.addChannel(telegramChannel);
    telegramChannel.connect().catch((err: Error) => {
      logger.error({ error: err }, "Telegram 连接失败");
    });
    logger.info("Telegram channel 已配置");
  }

  // 11. 创建 Scheduler 并启动
  const scheduler = new Scheduler(agentQueue, agentManager, eventBus);
  scheduler.start();
  logger.info("定时任务调度器已启动");

  // 12. 创建 IPC Watcher 并启动
  const ipcWatcher = new IpcWatcher({
    onScheduleTask: (data: any) => {
      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const nextRun = scheduler.calculateNextRun({
        schedule_type: data.scheduleType,
        schedule_value: data.scheduleValue,
        last_run: null,
      });
      createTask({
        id: taskId,
        agentId: data.agentId,
        chatId: data.chatId,
        prompt: data.prompt,
        scheduleType: data.scheduleType,
        scheduleValue: data.scheduleValue,
        nextRun: nextRun ?? new Date().toISOString(),
        name: data.name,
        description: data.description,
        deliveryMode: data.deliveryMode,
        deliveryTarget: data.deliveryTarget,
      });
      refreshTasksSnapshot(data.agentId);
      logger.info({ taskId, agentId: data.agentId }, "IPC: 定时任务已创建");
    },
    onPauseTask: (taskId: string) => {
      const task = getTask(taskId);
      if (task) {
        updateTask(taskId, { status: "paused" });
        refreshTasksSnapshot(task.agent_id);
      }
    },
    onResumeTask: (taskId: string) => {
      const task = getTask(taskId);
      if (task) {
        const nextRun = scheduler.calculateNextRun({
          schedule_type: task.schedule_type,
          schedule_value: task.schedule_value,
          last_run: task.last_run,
        });
        updateTask(taskId, { status: "active", nextRun: nextRun ?? new Date().toISOString() });
        refreshTasksSnapshot(task.agent_id);
      }
    },
    onCancelTask: (taskId: string) => {
      const task = getTask(taskId);
      if (task) {
        deleteTask(taskId);
        refreshTasksSnapshot(task.agent_id);
      }
    },
  });
  ipcWatcher.start();

  function refreshTasksSnapshot(agentId: string) {
    const allTasks = getTasks();
    const agentTasks = allTasks
      .filter((t: any) => t.agent_id === agentId)
      .map((t: any) => ({
        id: t.id,
        prompt: t.prompt,
        schedule_type: t.schedule_type,
        schedule_value: t.schedule_value,
        status: t.status,
        next_run: t.next_run,
        last_run: t.last_run,
      }));
    writeTasksSnapshot(agentId, agentTasks);
  }

  // 13. 创建 Hono app（仅用于路由逻辑，不起 HTTP 端口）
  const honoApp = createApp({
    agentManager,
    agentQueue,
    eventBus,
    router,
    skillsLoader,
    memoryManager,
    scheduler,
  });

  // ===== IPC: api-fetch — 通用 API 调用（替代 HTTP） =====
  // renderer 发送: ipcRenderer.invoke("api-fetch", { method, path, body })
  // 主进程用 Hono 的 fetch() 在内存中处理请求，返回 { status, data }
  ipcMain.handle("api-fetch", async (_event, req: { method: string; path: string; body?: string }) => {
    const url = `http://localhost${req.path}`;
    const init: RequestInit = {
      method: req.method,
      headers: { "Content-Type": "application/json" },
    };
    if (req.body) {
      init.body = req.body;
    }

    const response = await honoApp.fetch(new Request(url, init));
    const status = response.status;

    // 检查是否为 SSE 流响应（stream 端点）
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      // SSE 不走 api-fetch，通过 subscribe-events IPC 处理
      return { status: 400, data: { error: "Use subscribe-events for SSE endpoints" } };
    }

    const data = await response.json().catch(() => null);
    return { status, data };
  });

  // ===== IPC: subscribe-events — EventBus → renderer 事件桥接（替代 SSE） =====
  // renderer 发送: ipcRenderer.invoke("subscribe-events", chatId)
  // 主进程订阅 EventBus 事件，通过 webContents.send("agent-event", event) 推送
  ipcMain.handle("subscribe-events", (_event, chatId: string) => {
    const unsubscribe = eventBus.subscribe({ chatId }, (agentEvent: any) => {
      // 推送事件到所有窗口
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send("agent-event", agentEvent);
        }
      }
    });

    // 返回订阅 ID，用于取消订阅
    const subId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    subscriptions.set(subId, unsubscribe);
    return { subId };
  });

  // ===== IPC: unsubscribe-events =====
  ipcMain.handle("unsubscribe-events", (_event, subId: string) => {
    const unsub = subscriptions.get(subId);
    if (unsub) {
      unsub();
      subscriptions.delete(subId);
    }
  });

  // 保存 cleanup 函数
  app.once("before-quit", () => {
    // 清理所有事件订阅
    for (const unsub of subscriptions.values()) {
      unsub();
    }
    subscriptions.clear();
    skillsWatcher.stop();
    ipcWatcher.stop();
    scheduler.stop();
  });

  logger.info("后端已集成到 Electron 主进程（无 HTTP 端口）");
}

// 事件订阅管理
const subscriptions = new Map<string, () => void>();

// ===== 持久化工具 =====

const settingsFilePath = path.join(app.getPath("userData"), "settings.json");

function getSettings(): Record<string, unknown> {
  try {
    const data = fs.readFileSync(settingsFilePath, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function saveSetting(key: string, value: unknown): void {
  const settings = getSettings();
  settings[key] = value;
  fs.writeFileSync(settingsFilePath, JSON.stringify(settings), "utf-8");
}

function getAllowPrereleaseValue(): boolean {
  const settings = getSettings();
  return settings.allowPrerelease === true;
}

// 主题持久化
const themeFilePath = path.join(app.getPath("userData"), "theme.json");

function getSavedTheme(): string {
  try {
    const data = fs.readFileSync(themeFilePath, "utf-8");
    const parsed = JSON.parse(data);
    if (["dark", "light", "system"].includes(parsed.theme)) {
      return parsed.theme;
    }
  } catch {
    // 文件不存在或无效，默认 system
  }
  return "system";
}

function saveTheme(theme: string): void {
  fs.writeFileSync(themeFilePath, JSON.stringify({ theme }), "utf-8");
}

function applyTheme(theme: string): void {
  if (theme === "system") {
    nativeTheme.themeSource = "system";
  } else if (theme === "light") {
    nativeTheme.themeSource = "light";
  } else {
    nativeTheme.themeSource = "dark";
  }
}

// ===== 系统托盘 =====

function createTray(): void {
  const iconPath = path.join(__dirname, "../../../resources/logo.png");
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 44, height: 44 });
  icon.setTemplateImage(false);
  const scaledIcon = nativeImage.createFromBuffer(icon.toPNG(), {
    width: 22,
    height: 22,
    scaleFactor: 2.0,
  });
  tray = new Tray(scaledIcon);
  tray.setToolTip("You Claw");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Window",
      click: () => {
        mainWindow?.show();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on("double-click", () => {
    mainWindow?.show();
  });
}

// ===== 菜单栏 =====

function createAppMenu(): void {
  if (process.platform === "darwin") {
    // macOS: 保留原生菜单栏（系统期望有）
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: app.name,
        submenu: [
          { role: "about" },
          {
            label: "Settings...",
            accelerator: "CmdOrCtrl+,",
            click: () => {
              mainWindow?.show();
              mainWindow?.webContents.send("open-settings");
            },
          },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      {
        label: "Window",
        submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } else {
    // Windows/Linux: 移除原生菜单栏，避免白色菜单条
    Menu.setApplicationMenu(null);
  }
}

// ===== 窗口 =====

function createWindow(): void {
  const isMac = process.platform === "darwin";
  const isWin = process.platform === "win32";

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: "#1a1a2e",
    title: "You Claw",
    // macOS: 隐藏标题栏但保留交通灯
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 16, y: 18 },
        }
      : {}),
    // Windows: 隐藏原生标题栏和菜单，用 overlay 渲染窗口控制按钮
    ...(isWin
      ? {
          titleBarStyle: "hidden",
          titleBarOverlay: {
            color: "#1a1a2e",
            symbolColor: "#e5e7eb",
            height: 48,
          },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 加载打包好的 renderer HTML
  mainWindow.loadFile(path.join(__dirname, "../../../dist/renderer/index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ===== 应用启动 =====

app.whenReady().then(async () => {
  // 应用主题
  const savedTheme = getSavedTheme();
  applyTheme(savedTheme);

  // 注册 IPC handlers（桌面功能）
  ipcMain.handle("get-version", () => app.getVersion());
  ipcMain.handle("get-theme", () => getSavedTheme());
  ipcMain.handle("set-theme", (_event, theme: string) => {
    saveTheme(theme);
    applyTheme(theme);
  });
  ipcMain.handle("get-allow-prerelease", () => getAllowPrereleaseValue());
  ipcMain.handle("set-allow-prerelease", (_event, value: boolean) => {
    saveSetting("allowPrerelease", value);
    setAllowPrerelease(value);
  });

  // 配置更新
  setAllowPrerelease(getAllowPrereleaseValue());
  setupUpdater();

  // UI
  createAppMenu();
  createTray();

  // 启动内嵌后端（不起 HTTP 端口，所有通信走 IPC）
  try {
    await startEmbeddedBackend();
    console.log("[electron] Backend integrated into main process (no HTTP port)");
  } catch (err) {
    console.error("[electron] Failed to start embedded backend:", err);
    app.quit();
    return;
  }

  // 创建窗口
  createWindow();

  if (app.isPackaged) {
    checkForUpdates();
  }

  app.on("activate", () => {
    if (mainWindow) {
      mainWindow.show();
    } else {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
