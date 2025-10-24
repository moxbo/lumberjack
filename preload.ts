import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  // dialogs
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  chooseLogFile: () => ipcRenderer.invoke('dialog:chooseLogFile'),
  // logs
  parsePaths: (paths: string[]) => ipcRenderer.invoke('logs:parsePaths', paths),
  parseRawDrops: (files: any[]) => ipcRenderer.invoke('logs:parseRaw', files),
  onAppend: (cb: (entries: any[]) => void) => {
    const listener = (_event: any, entries: any[]) => cb(entries);
    ipcRenderer.on('logs:append', listener);
    return () => ipcRenderer.removeListener('logs:append', listener);
  },
  // tcp
  tcpStart: (port: number) => ipcRenderer.send('tcp:start', { port }),
  tcpStop: () => ipcRenderer.send('tcp:stop'),
  onTcpStatus: (cb: (status: any) => void) => {
    const listener = (_event: any, status: any) => cb(status);
    ipcRenderer.on('tcp:status', listener);
    return () => ipcRenderer.removeListener('tcp:status', listener);
  },
  // http
  httpLoadOnce: (url: string) => ipcRenderer.invoke('http:loadOnce', url),
  httpStartPoll: ({ url, intervalMs }: { url: string; intervalMs: number }) =>
    ipcRenderer.invoke('http:startPoll', { url, intervalMs }),
  httpStopPoll: (id: number) => ipcRenderer.invoke('http:stopPoll', id),
  // menu bridge
  onMenu: (cb: (cmd: any) => void) => {
    const listener = (_event: any, cmd: any) => cb(cmd);
    ipcRenderer.on('menu:cmd', listener);
    return () => ipcRenderer.removeListener('menu:cmd', listener);
  },
  // settings
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (patch: any) => ipcRenderer.invoke('settings:set', patch),
});
