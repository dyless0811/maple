'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 렌더러에서 안전하게 사용할 수 있는 API만 노출
contextBridge.exposeInMainWorld('maple', {
  loadData: () => ipcRenderer.invoke('load-data'),
  loadState: () => ipcRenderer.invoke('load-state'),
  saveState: (state) => ipcRenderer.invoke('save-state', state)
});
