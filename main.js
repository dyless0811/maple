'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    console.error(`Failed to read ${file}:`, err.message);
    return fallback;
  }
}

function statePath() {
  // 사용자별 저장 경로 (앱 종료 후에도 카운트/업그레이드 유지)
  return path.join(app.getPath('userData'), 'state.json');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0f1320',
    title: '메이플 랜덤 디펜스 가이드',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

// ── IPC ────────────────────────────────────────────────────────────────
ipcMain.handle('load-data', () => ({
  units: readJson(path.join(DATA_DIR, 'units.json'), []),
  upgrades: readJson(path.join(DATA_DIR, 'upgrades.json'), []),
  enemies: readJson(path.join(DATA_DIR, 'enemies.json'), []),
  stages: readJson(path.join(DATA_DIR, 'stages.json'), []),
  meta: readJson(path.join(DATA_DIR, 'meta.json'), {})
}));

ipcMain.handle('load-state', () => readJson(statePath(), null));

ipcMain.handle('save-state', (_evt, state) => {
  try {
    fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf-8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
