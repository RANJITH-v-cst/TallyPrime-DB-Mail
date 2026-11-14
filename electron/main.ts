import { app, BrowserWindow, Menu, Tray, nativeImage, shell, dialog, Notification } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// 1. MUST set data directory BEFORE requiring any application modules
process.env.TALLYMAILER_DATA_DIR = app.getPath('userData');

import { startApp, AppInstance } from '../dist/index';
import { getLogsDir, getExportsDir } from '../dist/utils/appPaths';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let appInstance: AppInstance | null = null;
let isQuitting = false;

// 2. Single instance lock: prevent multiple copies running
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      // Start in-process services (WebUI Express, Scheduler, Orchestrator)
      appInstance = await startApp({ preferredPort: 9095 });
      const port = appInstance.port || 9095;

      // Create window
      createWindow(port);

      // Create system tray icon & menu
      createTray(port);

      // Auto-start flag check: if launched with --hidden, stay minimized in tray
      const isHidden = process.argv.includes('--hidden');
      if (isHidden && mainWindow) {
        mainWindow.hide();
      } else if (mainWindow) {
        mainWindow.show();
      }
    } catch (err: any) {
      dialog.showErrorBox('Startup Error', `Failed to start TallyDayBookMailer: ${err.message}`);
      app.quit();
    }
  });
}

function resolveIconPath(): string {
  const candidates = [
    path.join(__dirname, '../build/icon.ico'),
    path.join(__dirname, '../../build/icon.ico'),
    path.join(app.getAppPath(), 'build/icon.ico'),
    path.join(process.cwd(), 'build/icon.ico'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return '';
}

function createWindow(port: number) {
  const iconPath = resolveIconPath();
  const icon = iconPath ? nativeImage.createFromPath(iconPath) : undefined;

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Tally DayBook Mailer',
    icon: icon,
    autoHideMenuBar: true,
    show: false, // will show after ready-to-show unless --hidden
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  // Security: block external navigation or opening external windows inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Load local web UI
  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) {
      mainWindow?.show();
    }
  });

  // Closing the window hides to tray instead of exiting
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray(port: number) {
  const iconPath = resolveIconPath();
  const trayIcon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();

  tray = new Tray(trayIcon);

  const updateTrayMenu = () => {
    const isLoginItem = app.getLoginItemSettings().openAtLogin;
    const nextRun = appInstance?.scheduler.getNextRunDate();
    const nextRunStr = nextRun ? nextRun.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '20:00';

    tray?.setToolTip(`Tally DayBook Mailer (Port ${port}, Next run: ${nextRunStr})`);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open Tally DayBook Mailer',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      { type: 'separator' },
      {
        label: '▶ Send Now',
        click: async () => {
          if (!appInstance) return;
          if (appInstance.orchestrator.getIsRunning()) {
            dialog.showMessageBox({
              type: 'info',
              title: 'Export in Progress',
              message: 'An export cycle is already in progress.',
            });
            return;
          }
          try {
            appInstance.orchestrator.runCycle().catch((err: any) => {
              showDesktopNotification('Export Failed', err.message);
            });
          } catch (err: any) {
            showDesktopNotification('Export Failed', err.message);
          }
        },
      },
      {
        label: 'Start with Windows',
        type: 'checkbox',
        checked: isLoginItem,
        click: (menuItem) => {
          app.setLoginItemSettings({
            openAtLogin: menuItem.checked,
            args: ['--hidden'],
          });
        },
      },
      { type: 'separator' },
      {
        label: 'Open Exports Folder',
        click: () => {
          const folder = appInstance?.config.exportFolder || getExportsDir();
          shell.openPath(folder);
        },
      },
      {
        label: 'Open Logs Folder',
        click: () => {
          shell.openPath(getLogsDir());
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: async () => {
          if (appInstance?.orchestrator.getIsRunning()) {
            const res = dialog.showMessageBoxSync({
              type: 'warning',
              buttons: ['Wait for Export', 'Cancel Export and Quit'],
              defaultId: 0,
              title: 'Export in Progress',
              message: 'An export cycle is currently running. Quitting will cancel the export cycle.',
            });
            if (res === 0) return;
            appInstance.orchestrator.cancelCycle();
          }
          isQuitting = true;
          if (appInstance) {
            await appInstance.shutdown('Tray Quit');
          }
          app.quit();
        },
      },
    ]);

    tray?.setContextMenu(contextMenu);
  };

  updateTrayMenu();

  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

function showDesktopNotification(title: string, body: string) {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

app.on('before-quit', () => {
  isQuitting = true;
});

// Prevent exiting when window closes so background service / tray persists
app.on('window-all-closed', () => {
  // Do nothing: keep running in tray
});
