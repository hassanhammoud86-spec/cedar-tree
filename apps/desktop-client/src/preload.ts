/**
 * preload.ts - exposes a small, explicit `window.cedarTree` API to the
 * renderer via contextBridge, since the renderer runs with nodeIntegration
 * disabled and contextIsolation enabled.
 */
import { contextBridge, ipcRenderer } from "electron";

export interface CedarTreeBridge {
  listTools(): Promise<{ ok: boolean; tools?: string[]; error?: string }>;
  callTool(name: string, args: unknown): Promise<{ ok: boolean; result?: unknown; error?: string }>;
  runCommand(transcript: string): Promise<{
    transcript: string;
    matchedTool: string | null;
    spokenReply: string;
    raw?: unknown;
  }>;
}

const bridge: CedarTreeBridge = {
  listTools: () => ipcRenderer.invoke("cedar-tree:list-tools"),
  callTool: (name, args) => ipcRenderer.invoke("cedar-tree:call-tool", name, args),
  runCommand: (transcript) => ipcRenderer.invoke("cedar-tree:run-command", transcript),
};

contextBridge.exposeInMainWorld("cedarTree", bridge);
