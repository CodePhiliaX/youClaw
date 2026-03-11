import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import log from "electron-log";

autoUpdater.logger = log;
autoUpdater.autoDownload = true;

function sendToRenderer(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args);
  }
}

export function setupUpdater(): void {
  autoUpdater.on("checking-for-update", () => {
    sendToRenderer("update-status", "checking");
  });

  autoUpdater.on("update-available", (info) => {
    log.info("Update available:", info.version);
    sendToRenderer("update-status", "available", info.version);
  });

  autoUpdater.on("update-not-available", () => {
    log.info("No update available.");
    sendToRenderer("update-status", "up-to-date");
  });

  autoUpdater.on("download-progress", (progress) => {
    log.info(`Download: ${progress.percent.toFixed(1)}%`);
    sendToRenderer("update-status", "downloading", progress.percent);
  });

  autoUpdater.on("update-downloaded", (info) => {
    sendToRenderer("update-status", "ready", info.version);
    const win = BrowserWindow.getFocusedWindow();
    dialog
      .showMessageBox(win ?? ({} as BrowserWindow), {
        type: "info",
        title: "Update Ready",
        message: `Version ${info.version} has been downloaded. Restart to apply the update.`,
        buttons: ["Restart Now", "Later"],
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on("error", (err) => {
    log.error("Update error:", err);
    sendToRenderer("update-status", "error", err.message);
  });

  ipcMain.handle("check-for-updates", async () => {
    if (!app.isPackaged) {
      sendToRenderer("update-status", "error", "Update check is not available in dev mode");
      return null;
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      return result?.updateInfo?.version ?? null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("Manual update check failed:", message);
      sendToRenderer("update-status", "error", message);
      return null;
    }
  });

  ipcMain.handle("install-update", () => {
    autoUpdater.quitAndInstall();
  });
}

export function setAllowPrerelease(value: boolean): void {
  autoUpdater.allowPrerelease = value;
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    log.error("Failed to check for updates:", err);
  });
}
