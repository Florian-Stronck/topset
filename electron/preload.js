"use strict";

// The one thing the page may ask of the desktop shell: see Sidebar's "Check for updates".
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("topset", {
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
});
