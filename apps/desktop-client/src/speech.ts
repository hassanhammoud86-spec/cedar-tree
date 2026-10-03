/**
 * speech.ts (Electron main process)
 *
 * Offline speech-to-text using the Windows built-in System.Speech engine,
 * run in a PowerShell child process. Chromium's webkitSpeechRecognition does
 * not work in Electron (it needs Google API keys and fails with "network"),
 * so recognition lives here and results are pushed to the renderer by IPC.
 */
import { ipcMain, WebContents } from "electron";
import { spawn, ChildProcess } from "node:child_process";

const SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName System.Speech
  $r = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  $r.SetInputToDefaultAudioDevice()
  $r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  [Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
  while ($true) {
    $res = $r.Recognize([TimeSpan]::FromSeconds(5))
    if ($res -and $res.Text) { [Console]::Out.WriteLine('FINAL:' + $res.Text); [Console]::Out.Flush() }
  }
} catch {
  [Console]::Out.WriteLine('ERROR:' + $_.Exception.Message); [Console]::Out.Flush()
  exit 1
}
`;

let child: ChildProcess | null = null;

function stop(): void {
  if (child && child.pid) {
    const pid = child.pid;
    child.removeAllListeners();
    child.stdout?.removeAllListeners();
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
  }
  child = null;
}

function start(target: WebContents): void {
  stop();
  const send = (type: string, text = "") => {
    if (!target.isDestroyed()) target.send("cedar-tree:stt-event", { type, text });
  };

  const encoded = Buffer.from(SCRIPT, "utf16le").toString("base64");
  const proc = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    { windowsHide: true }
  );
  child = proc;

  let buffer = "";
  proc.stdout?.setEncoding("utf8");
  proc.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line === "READY") send("ready");
      else if (line.startsWith("FINAL:")) send("final", line.slice(6));
      else if (line.startsWith("ERROR:")) send("error", line.slice(6));
    }
  });
  proc.on("error", (err) => send("error", err.message));
  proc.on("exit", (code) => {
    if (child === proc) {
      child = null;
      send("ended", String(code ?? ""));
    }
  });
}

export function registerSpeechIpcHandlers(): void {
  ipcMain.handle("cedar-tree:stt-start", (event) => {
    start(event.sender);
    return { ok: true };
  });
  ipcMain.handle("cedar-tree:stt-stop", () => {
    stop();
    return { ok: true };
  });
}

export function stopSpeech(): void {
  stop();
}
