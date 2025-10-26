"use strict";

// preload.ts
var import_electron = require("electron");
var api = {
  // Settings operations
  settingsGet: () => import_electron.ipcRenderer.invoke("settings:get"),
  settingsSet: (patch) => import_electron.ipcRenderer.invoke("settings:set", patch),
  // Window title (session) operations
  windowTitleGet: () => import_electron.ipcRenderer.invoke("windowTitle:get"),
  windowTitleSet: (title) => import_electron.ipcRenderer.invoke("windowTitle:set", title),
  // Dialog operations
  openFiles: () => import_electron.ipcRenderer.invoke("dialog:openFiles"),
  chooseLogFile: () => import_electron.ipcRenderer.invoke("dialog:chooseLogFile"),
  // Log parsing operations
  parsePaths: (paths) => import_electron.ipcRenderer.invoke("logs:parsePaths", paths),
  parseRawDrops: (files) => import_electron.ipcRenderer.invoke("logs:parseRaw", files),
  // TCP operations
  tcpStart: (port) => {
    import_electron.ipcRenderer.send("tcp:start", { port });
  },
  tcpStop: () => {
    import_electron.ipcRenderer.send("tcp:stop");
  },
  // HTTP operations
  httpLoadOnce: (url) => import_electron.ipcRenderer.invoke("http:loadOnce", url),
  httpStartPoll: (options) => import_electron.ipcRenderer.invoke("http:startPoll", options),
  httpStopPoll: (id) => import_electron.ipcRenderer.invoke("http:stopPoll", id),
  // Elasticsearch operations
  elasticSearch: (options) => import_electron.ipcRenderer.invoke("elastic:search", options),
  // Event listeners with proper cleanup
  onAppend: (callback) => {
    const listener = (_event, entries) => {
      callback(entries);
    };
    import_electron.ipcRenderer.on("logs:append", listener);
    return () => {
      import_electron.ipcRenderer.removeListener("logs:append", listener);
    };
  },
  onTcpStatus: (callback) => {
    const listener = (_event, status) => {
      callback(status);
    };
    import_electron.ipcRenderer.on("tcp:status", listener);
    return () => {
      import_electron.ipcRenderer.removeListener("tcp:status", listener);
    };
  },
  onMenu: (callback) => {
    const listener = (_event, command) => {
      callback(command);
    };
    import_electron.ipcRenderer.on("menu:cmd", listener);
    return () => {
      import_electron.ipcRenderer.removeListener("menu:cmd", listener);
    };
  }
};
import_electron.contextBridge.exposeInMainWorld("api", api);
