const { contextBridge, ipcRenderer } = require("electron");

// Exposes one safe, narrow function to the game code — nothing else from
// Node/Electron leaks into the renderer.
contextBridge.exposeInMainWorld("electronAPI", {
  exitGame: () => ipcRenderer.send("exit-game"),
});