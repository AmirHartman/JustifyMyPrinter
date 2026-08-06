'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const invoke = (channel, value) => ipcRenderer.invoke(channel, value);
const subscribe = (channel) => (callback) => { const listener = (_event, value) => callback(value); ipcRenderer.on(channel, listener); return () => ipcRenderer.removeListener(channel, listener); };
contextBridge.exposeInMainWorld('bridgeDesktop', Object.freeze({
  bootstrap: () => invoke('desktop:bootstrap'),
  saveSetup: (value) => invoke('desktop:save-setup', value),
  status: () => invoke('desktop:status'), queue: () => invoke('desktop:queue'), library: () => invoke('desktop:library'),
  importFile: () => invoke('desktop:import'), scan: () => invoke('desktop:scan'),
  diagnose: (kind) => invoke('desktop:diagnose', kind), logs: () => invoke('desktop:logs'),
  pauseNewWork: () => invoke('desktop:pause'), resumeNewWork: () => invoke('desktop:resume'),
  openSettings: () => invoke('desktop:show-settings'),
  onDaemonState: subscribe('desktop:daemon-state'),
  onImportProgress: subscribe('desktop:import-progress'),
  onQuitBlocked: subscribe('desktop:quit-blocked'),
}));
