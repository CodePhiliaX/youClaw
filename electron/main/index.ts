// Prevent Claude Agent SDK from detecting a nested session
delete process.env.CLAUDECODE;

import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, nativeTheme } from "electron";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import Store from "electron-store";
import { setupUpdater, checkForUpdates, setAllowPrerelease } from "./updater.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const store = new Store({
  defaults: {
    theme: "system" as string,
    allowPrerelease: false,
    apiKey: "",
    baseUrl: "",
    windowBounds: { x: undefined, y: undefined, width: 1400, height: 900 } as {
      x?: number;
      y?: number;
      width: number;
      height: number;
    },
  },
});

function getBackendDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app.asar", "dist", "src");
  }
  return path.join(__dirname, "../../../dist/src");
}

async function importBackend(name: string): Promise<any> {
  const modulePath = path.join(getBackendDir(), name);
  return import(modulePath);
}

/** Load .env file manually (Bun auto-loads, Electron/Node does not) */
function loadDotEnv(): void {
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function fixShellEnv(): void {
  if (process.platform !== "darwin" || !app.isPackaged) return;
  try {
    const envStr = execSync("zsh -ilc env 2>/dev/null || bash -ilc env 2>/dev/null", {
      encoding: "utf-8",
    });
    for (const line of envStr.split("\n")) {
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq);
      const value = line.slice(eq + 1);
      // 不覆盖已有值（electron-store 设置优先）
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
  }
}

async function startEmbeddedBackend(): Promise<void> {
  fixShellEnv();
  loadDotEnv();

  // Inject API key and base URL from electron-store if not already set via .env
  const storedApiKey = store.get("apiKey") as string;
  if (storedApiKey && !process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = storedApiKey;
  }
  const storedBaseUrl = store.get("baseUrl") as string;
  if (storedBaseUrl && !process.env.ANTHROPIC_BASE_URL) {
    process.env.ANTHROPIC_BASE_URL = storedBaseUrl;
  }

  if (!process.env.DATA_DIR) {
    process.env.DATA_DIR = path.join(app.getPath("userData"), "data");
  }

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

  loadEnv();
  const env = getEnv();

  const logger = initLogger();
  logger.info("YouClaw Electron main process starting...");

  initDatabase();

  const eventBus = new EventBus();

  const skillsLoader = new SkillsLoader();
  logger.info({ count: skillsLoader.loadAllSkills().length }, "Skills loaded");

  const skillsWatcher = new SkillsWatcher(skillsLoader, {
    onReload: (skills: unknown[]) => {
      logger.info({ count: skills.length }, "Skills hot-reloaded");
    },
  });
  skillsWatcher.start();

  const memoryManager = new MemoryManager();

  const promptBuilder = new PromptBuilder(skillsLoader, memoryManager);
  const agentManager = new AgentManager(eventBus, promptBuilder);
  await agentManager.loadAgents();

  const agentQueue = new AgentQueue(agentManager);

  const router = new MessageRouter(agentManager, agentQueue, eventBus, memoryManager, skillsLoader);

  if (env.TELEGRAM_BOT_TOKEN) {
    const telegramChannel = new TelegramChannel(env.TELEGRAM_BOT_TOKEN, {
      onMessage: (message: unknown) => router.handleInbound(message as any),
    });
    router.addChannel(telegramChannel);
    telegramChannel.connect().catch((err: Error) => {
      logger.error({ error: err }, "Telegram connection failed");
    });
    logger.info("Telegram channel configured");
  }

  const scheduler = new Scheduler(agentQueue, agentManager, eventBus);
  scheduler.start();
  logger.info("Scheduler started");

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
      logger.info({ taskId, agentId: data.agentId }, "IPC: scheduled task created");
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

  // Hono app for routing only (no HTTP port)
  const honoApp = createApp({
    agentManager,
    agentQueue,
    eventBus,
    router,
    skillsLoader,
    memoryManager,
    scheduler,
  });

  // IPC: api-fetch — route requests through Hono in-memory
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

    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      return { status: 400, data: { error: "Use subscribe-events for SSE endpoints" } };
    }

    const data = await response.json().catch(() => null);
    return { status, data };
  });

  // IPC: subscribe-events — bridge EventBus to renderer
  ipcMain.handle("subscribe-events", (_event, chatId: string) => {
    const unsubscribe = eventBus.subscribe({ chatId }, (agentEvent: any) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send("agent-event", agentEvent);
        }
      }
    });

    const subId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    subscriptions.set(subId, unsubscribe);
    return { subId };
  });

  ipcMain.handle("unsubscribe-events", (_event, subId: string) => {
    const unsub = subscriptions.get(subId);
    if (unsub) {
      unsub();
      subscriptions.delete(subId);
    }
  });

  app.once("before-quit", () => {
    for (const unsub of subscriptions.values()) {
      unsub();
    }
    subscriptions.clear();
    skillsWatcher.stop();
    ipcWatcher.stop();
    scheduler.stop();
  });

  logger.info("Backend integrated into Electron main process (no HTTP port)");
}

const subscriptions = new Map<string, () => void>();

function applyTheme(theme: string): void {
  if (theme === "system") {
    nativeTheme.themeSource = "system";
  } else if (theme === "light") {
    nativeTheme.themeSource = "light";
  } else {
    nativeTheme.themeSource = "dark";
  }
}

function createTray(): void {
  const iconPath = path.join(__dirname, "../../../resources/trayTemplate.png");
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);
  tray = new Tray(icon);
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

  // Left-click shows window, right-click shows context menu
  tray.on("click", () => {
    mainWindow?.show();
  });
  tray.on("right-click", () => {
    tray?.popUpContextMenu(contextMenu);
  });
}

function createAppMenu(): void {
  if (process.platform === "darwin") {
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
    Menu.setApplicationMenu(null);
  }
}

function createWindow(): void {
  const isMac = process.platform === "darwin";
  const isWin = process.platform === "win32";
  const bounds = store.get("windowBounds") as { x?: number; y?: number; width: number; height: number };

  mainWindow = new BrowserWindow({
    ...( bounds.x !== undefined && bounds.y !== undefined ? { x: bounds.x, y: bounds.y } : {}),
    width: bounds.width,
    height: bounds.height,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: "#1a1a2e",
    title: "You Claw",
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 16, y: 18 },
        }
      : {}),
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

  const saveBounds = () => {
    if (!mainWindow || mainWindow.isMaximized() || mainWindow.isMinimized()) return;
    store.set("windowBounds", mainWindow.getBounds());
  };
  mainWindow.on("resized", saveBounds);
  mainWindow.on("moved", saveBounds);

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

app.whenReady().then(async () => {
  const savedTheme = store.get("theme") as string;
  applyTheme(savedTheme);

  ipcMain.handle("get-version", () => app.getVersion());
  ipcMain.handle("get-theme", () => store.get("theme"));
  ipcMain.handle("set-theme", (_event, theme: string) => {
    store.set("theme", theme);
    applyTheme(theme);
  });
  ipcMain.handle("get-allow-prerelease", () => store.get("allowPrerelease"));
  ipcMain.handle("set-allow-prerelease", (_event, value: boolean) => {
    store.set("allowPrerelease", value);
    setAllowPrerelease(value);
  });

  ipcMain.handle("get-api-key", () => store.get("apiKey"));
  ipcMain.handle("set-api-key", (_event, key: string) => {
    store.set("apiKey", key);
    process.env.ANTHROPIC_API_KEY = key;
  });

  ipcMain.handle("get-base-url", () => store.get("baseUrl"));
  ipcMain.handle("set-base-url", (_event, url: string) => {
    store.set("baseUrl", url);
    if (url) {
      process.env.ANTHROPIC_BASE_URL = url;
    } else {
      delete process.env.ANTHROPIC_BASE_URL;
    }
  });

  setAllowPrerelease(store.get("allowPrerelease") as boolean);
  setupUpdater();

  createAppMenu();
  createTray();

  try {
    await startEmbeddedBackend();
    console.log("[electron] Backend integrated into main process (no HTTP port)");
  } catch (err) {
    console.error("[electron] Failed to start embedded backend:", err);
    app.quit();
    return;
  }

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
