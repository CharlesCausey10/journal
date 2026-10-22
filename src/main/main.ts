/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build`, this file is compiled to
 * `./release/app/dist/main/main.js` using electron-vite.
 */
import path from 'path';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, Menu, shell, ipcMain, screen, protocol, net } from 'electron';
import log from 'electron-log';
import MenuBuilder from './menu';
import { resolveHtmlPath } from './util';
import startAutoUpdates from './updates';
import initializeWithRecovery from './database-recovery';
import { assertTrustedSender, isAllowedExternalUrl, rendererAssetPath } from './security';
import {
  closeDatabase,
  addBlock,
  deleteEntry,
  getLayoutSettings,
  getEntry,
  listEntries,
  listEntriesForDate,
  listBlocks,
  moveBlock,
  updateLayoutSize,
  updateCenterOrientation,
  removeBlock,
  setFontFamily,
  setColorScheme,
  updateBlockSettings,
  saveEntry,
  type SaveEntryInput,
} from './database';

// Keep local development separate from the installed app's personal data.
// Configure this before opening the database or creating any browser windows.
if (!app.isPackaged) {
  const developmentDataPath = process.env.JOURNAL_SMOKE_TEST_DATA
    ? path.resolve(process.env.JOURNAL_SMOKE_TEST_DATA)
    : path.join(app.getPath('appData'), 'Journal Development');
  mkdirSync(developmentDataPath, { recursive: true });
  app.setPath('userData', developmentDataPath);
  app.setPath('sessionData', developmentDataPath);
}

protocol.registerSchemesAsPrivileged([{
  scheme: 'journal',
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}]);

let mainWindow: BrowserWindow | null = null;
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
app.on('second-instance', () => {
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.focus();
});
type SavedWindowState = {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
};

let windowStateSaveTimer: NodeJS.Timeout | null = null;

function readWindowState(): SavedWindowState | null {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(path.join(app.getPath('userData'), 'window-state.json'), 'utf8'),
    );
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('x' in parsed) || typeof parsed.x !== 'number' ||
      !('y' in parsed) || typeof parsed.y !== 'number' ||
      !('width' in parsed) || typeof parsed.width !== 'number' ||
      !('height' in parsed) || typeof parsed.height !== 'number' ||
      !('maximized' in parsed) || typeof parsed.maximized !== 'boolean' ||
      !Number.isFinite(parsed.x) || !Number.isFinite(parsed.y) ||
      !Number.isFinite(parsed.width) || !Number.isFinite(parsed.height)
    ) {
      return null;
    }
    return parsed as SavedWindowState;
  } catch {
    return null;
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getNormalBounds();
  const state: SavedWindowState = {
    ...bounds,
    maximized: mainWindow.isMaximized(),
  };
  try {
    writeFileSync(
      path.join(app.getPath('userData'), 'window-state.json'),
      JSON.stringify(state),
      'utf8',
    );
  } catch (error) {
    log.warn('Could not save the application window size', error);
  }
}

function scheduleWindowStateSave() {
  if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer);
  windowStateSaveTimer = setTimeout(() => {
    windowStateSaveTimer = null;
    saveWindowState();
  }, 300);
}

function handle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event, mainWindow?.webContents, resolveHtmlPath('index.html'));
    return listener(event, ...args);
  });
}

handle('entries:list', () => listEntries());
handle('entries:list-for-date', (_event, entryDate: unknown) => {
  if (typeof entryDate !== 'string') {
    throw new TypeError('Entry date must be a string');
  }
  return listEntriesForDate(entryDate);
});
handle('blocks:list', () => listBlocks());
handle('blocks:add', (_event, input: unknown) => {
  if (
    !input ||
    typeof input !== 'object' ||
    !('label' in input) ||
    !('placement' in input) ||
    typeof input.label !== 'string' ||
    typeof input.placement !== 'string' ||
    !['header', 'footer', 'left', 'right', 'center'].includes(input.placement)
  ) {
    throw new TypeError('Invalid panel');
  }
  return addBlock(
    input.label,
    input.placement as 'header' | 'footer' | 'left' | 'right' | 'center',
  );
});
handle('blocks:remove', (_event, id: unknown) => {
  if (typeof id !== 'number') throw new TypeError('Invalid panel id');
  return removeBlock(id);
});
handle('blocks:move', (_event, input: unknown) => {
  if (
    !input ||
    typeof input !== 'object' ||
    !('id' in input) ||
    !('placement' in input) ||
    !('position' in input) ||
    typeof input.id !== 'number' ||
    typeof input.placement !== 'string' ||
    !['header', 'footer', 'left', 'right', 'center'].includes(input.placement) ||
    typeof input.position !== 'number'
  ) {
    throw new TypeError('Invalid panel move');
  }
  return moveBlock(
    input.id,
    input.placement as 'header' | 'footer' | 'left' | 'right' | 'center',
    input.position,
  );
});
handle('blocks:update-settings', (_event, input: unknown) => {
  if (
    !input ||
    typeof input !== 'object' ||
    !('id' in input) ||
    !('settings' in input) ||
    !('anchorDate' in input) ||
    typeof input.id !== 'number' ||
    typeof input.anchorDate !== 'string' ||
    !input.settings ||
    typeof input.settings !== 'object'
  ) {
    throw new TypeError('Invalid panel settings');
  }
  const settings = input.settings;
  if (
    ('label' in settings &&
      (typeof settings.label !== 'string' || settings.label.trim().length < 1 || settings.label.trim().length > 40)) ||
    ('fontSizePx' in settings && typeof settings.fontSizePx !== 'number') ||
    ('resetFrequency' in settings &&
      (typeof settings.resetFrequency !== 'string' ||
        !['daily', 'weekly', 'monthly', 'yearly', 'never'].includes(settings.resetFrequency))) ||
    ('templateContent' in settings &&
      (typeof settings.templateContent !== 'string' ||
        settings.templateContent.length > 20_000)) ||
    ('previousEntryBlockId' in settings &&
      settings.previousEntryBlockId !== null &&
      typeof settings.previousEntryBlockId !== 'number') ||
    !('label' in settings || 'fontSizePx' in settings || 'resetFrequency' in settings || 'templateContent' in settings || 'previousEntryBlockId' in settings)
  ) {
    throw new TypeError('Invalid panel settings');
  }
  return updateBlockSettings(input.id, {
    label: 'label' in settings ? settings.label as string : undefined,
    fontSizePx: 'fontSizePx' in settings ? settings.fontSizePx as number : undefined,
    resetFrequency:
      'resetFrequency' in settings
        ? settings.resetFrequency as 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'
        : undefined,
    templateContent:
      'templateContent' in settings
        ? settings.templateContent as string
        : undefined,
    previousEntryBlockId:
      'previousEntryBlockId' in settings
        ? settings.previousEntryBlockId as number | null
        : undefined,
  }, input.anchorDate);
});
handle('layout:set-size', (_event, input: unknown) => {
  if (
    !input ||
    typeof input !== 'object' ||
    !('placement' in input) ||
    !('sizeValue' in input) ||
    typeof input.placement !== 'string' ||
    !['header', 'footer', 'left', 'right', 'center'].includes(input.placement) ||
    typeof input.sizeValue !== 'number' ||
    ('blockId' in input &&
      input.blockId !== undefined &&
      typeof input.blockId !== 'number')
  ) {
    throw new TypeError('Invalid layout size');
  }
  return updateLayoutSize(
    input.placement as 'header' | 'footer' | 'left' | 'right' | 'center',
    input.sizeValue,
    'blockId' in input ? input.blockId as number : undefined,
  );
});
handle('layout:get', () => getLayoutSettings());
handle('layout:set-center-orientation', (_event, value: unknown) => {
  if (value !== 'horizontal' && value !== 'vertical' && value !== 'grid') {
    throw new TypeError('Invalid center orientation');
  }
  updateCenterOrientation(value);
});
handle('settings:set-font-family', (_event, fontFamily: unknown) => {
  if (
    typeof fontFamily !== 'string' ||
    !['handlee', 'arial', 'georgia', 'trebuchet', 'verdana', 'courier'].includes(fontFamily)
  ) {
    throw new TypeError('Invalid font family');
  }
  setFontFamily(fontFamily as 'handlee' | 'arial' | 'georgia' | 'trebuchet' | 'verdana' | 'courier');
});
handle('settings:set-color-scheme', (_event, colorScheme: unknown) => {
  if (
    typeof colorScheme !== 'string' ||
    !['paper', 'stone', 'sage', 'lavender', 'midnight', 'charcoal'].includes(colorScheme)
  ) {
    throw new TypeError('Invalid color scheme');
  }
  setColorScheme(
    colorScheme as 'paper' | 'stone' | 'sage' | 'lavender' | 'midnight' | 'charcoal',
  );
});
handle('entries:get', (_event, id: unknown) => {
  if (typeof id !== 'string') throw new TypeError('Entry id must be a string');
  return getEntry(id);
});
handle('entries:save', (_event, input: unknown) => {
  if (
    !input ||
    typeof input !== 'object' ||
    !('entryDate' in input) ||
    !('blockId' in input) ||
    !('content' in input) ||
    typeof input.entryDate !== 'string' ||
    typeof input.blockId !== 'number' ||
    typeof input.content !== 'string' ||
    ('id' in input && input.id !== undefined && typeof input.id !== 'string')
  ) {
    throw new TypeError('Invalid journal entry');
  }
  return saveEntry(input as SaveEntryInput);
});
handle('entries:delete', (_event, id: unknown) => {
  if (typeof id !== 'string') throw new TypeError('Entry id must be a string');
  return deleteEntry(id);
});

if (process.env.NODE_ENV === 'production') {
  process.setSourceMapsEnabled(true);
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  void import('electron-debug')
    .then(({ default: debug }) => debug({ showDevTools: false }))
    .catch(console.error);
}

const installExtensions = async () => {
  const { installExtension, REACT_DEVELOPER_TOOLS } =
    await import('electron-devtools-installer');
  return installExtension(REACT_DEVELOPER_TOOLS, {
    forceDownload: !!process.env.UPGRADE_EXTENSIONS,
  }).catch(console.log);
};

const createWindow = async () => {
  if (isDebug) {
    await installExtensions();
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(app.getAppPath(), 'assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  const savedWindowState = readWindowState();
  const display = savedWindowState
    ? screen.getDisplayMatching(savedWindowState)
    : screen.getPrimaryDisplay();
  const { workArea } = display;
  const minWidth = Math.min(640, workArea.width);
  const minHeight = Math.min(480, workArea.height);
  const width = Math.max(
    minWidth,
    Math.min(savedWindowState?.width ?? 1024, workArea.width),
  );
  const height = Math.max(
    minHeight,
    Math.min(savedWindowState?.height ?? 728, workArea.height),
  );
  const x = savedWindowState
    ? Math.max(workArea.x, Math.min(savedWindowState.x, workArea.x + workArea.width - width))
    : undefined;
  const y = savedWindowState
    ? Math.max(workArea.y, Math.min(savedWindowState.y, workArea.y + workArea.height - height))
    : undefined;

  mainWindow = new BrowserWindow({
    show: false,
    x,
    y,
    width,
    height,
    minWidth,
    minHeight,
    autoHideMenuBar: true,
    icon: getAssetPath('icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });

  mainWindow.on('resize', scheduleWindowStateSave);
  mainWindow.on('move', scheduleWindowStateSave);
  mainWindow.on('maximize', scheduleWindowStateSave);
  mainWindow.on('unmaximize', scheduleWindowStateSave);
  mainWindow.on('close', () => {
    if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer);
    windowStateSaveTimer = null;
    saveWindowState();
  });

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      if (savedWindowState?.maximized ?? true) mainWindow.maximize();
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  if (isDebug || process.env.DEBUG_PROD === 'true') {
    menuBuilder.setupDevelopmentEnvironment();
  }
  mainWindow.setMenu(null);
  mainWindow.setMenuBarVisibility(false);
  Menu.setApplicationMenu(null);

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    if (isAllowedExternalUrl(edata.url)) {
      void shell.openExternal(edata.url).catch((error: unknown) => {
        log.warn('Could not open external link', error);
      });
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('will-frame-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);

  await mainWindow.loadURL(resolveHtmlPath('index.html'));
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function reportWindowError(error: unknown) {
  log.error('Failed to create the application window', error);
  mainWindow?.destroy();
  mainWindow = null;
}

function onActivate() {
  // Reopening a macOS window must not initialize another updater.
  if (mainWindow === null) {
    void createWindow().catch(reportWindowError);
  }
}

app
  .whenReady()
  .then(async () => {
    if (!hasInstanceLock) return;
    protocol.handle('journal', (request) => {
      const filename = rendererAssetPath(request.url, path.join(__dirname, '../renderer'));
      if (request.method !== 'GET' || !filename) return new Response(null, { status: 403 });
      return net.fetch(pathToFileURL(filename).href);
    });
    if (!(await initializeWithRecovery())) {
      app.quit();
      return;
    }
    await createWindow();
    startAutoUpdates();
    app.on('activate', onActivate);
  })
  .catch((error: unknown) => {
    reportWindowError(error);
    app.quit();
  });

app.on('before-quit', () => {
  if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer);
  windowStateSaveTimer = null;
  saveWindowState();
  closeDatabase();
});
