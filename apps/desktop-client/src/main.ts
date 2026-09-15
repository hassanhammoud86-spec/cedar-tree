/**
 * main.ts - Electron main process entrypoint for the Cedar Tree desktop
 * client (Phase 3 MVP: the "always-on client app" described in
 * ROADMAP.md's voice/face interaction section).
 */
import { app, BrowserWindow, session } from "electron";
import * as path from "node:path";
import { registerIpcHandlers } from "./mcp-bridge";
import { registerCommandRouterIpcHandler } from "./command-router";

// Default the Cedar Tree workspace root (used by read_file/write_file/
// run_shell/run_tests/git_ops) to the repository root - three directories
// up from this compiled file (dist/ -> desktop-client -> apps -> repo
// root) - unless the user already set CEDAR_TREE_WORKSPACE_ROOT.
if (!process.env.CEDAR_TREE_WORKSPACE_ROOT) {
  process.env.CEDAR_TREE_WORKSPACE_ROOT = path.resolve(__dirname, "..", "..", "..");
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 960,
    height: 760,
    title: "Cedar Tree",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  // Auto-grant mic/camera permission requests triggered by our own
  // renderer (Web Speech API + getUserMedia), so the app can be used
  // without an extra manual OS-level prompt loop each launch.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });

  registerIpcHandlers();
  registerCommandRouterIpcHandler();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
