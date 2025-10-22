const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // dialogs
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  // logs
  parsePaths: (paths) => ipcRenderer.invoke('logs:parsePaths', paths),
  onAppend: (cb) => {
    const listener = (_event, entries) => cb(entries);
    ipcRenderer.on('logs:append', listener);
    return () => ipcRenderer.removeListener('logs:append', listener);
  },
  // tcp
  tcpStart: (port) => ipcRenderer.send('tcp:start', { port }),
  tcpStop: () => ipcRenderer.send('tcp:stop'),
  onTcpStatus: (cb) => {
    const listener = (_event, status) => cb(status);
    ipcRenderer.on('tcp:status', listener);
    return () => ipcRenderer.removeListener('tcp:status', listener);
  },
  // http
  httpLoadOnce: (url) => ipcRenderer.invoke('http:loadOnce', url),
  httpStartPoll: ({ url, intervalMs }) => ipcRenderer.invoke('http:startPoll', { url, intervalMs }),
  httpStopPoll: (id) => ipcRenderer.invoke('http:stopPoll', id),
  // menu bridge
  onMenu: (cb) => {
    const listener = (_event, cmd) => cb(cmd);
    ipcRenderer.on('menu:cmd', listener);
    return () => ipcRenderer.removeListener('menu:cmd', listener);
  },
  // settings
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (patch) => ipcRenderer.invoke('settings:set', patch)
});
