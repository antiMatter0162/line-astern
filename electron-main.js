const { app, BrowserWindow } = require("electron");
const path = require("node:path");

function createWindow() {
const window = new BrowserWindow({
  width: 1024,
  height: 640,
  minWidth: 800,
  minHeight: 500,
  useContentSize: true,
  autoHideMenuBar: true,
  backgroundColor: "#0b1a2b",
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
  },
});

window.setAspectRatio(16 / 10);


  window.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
