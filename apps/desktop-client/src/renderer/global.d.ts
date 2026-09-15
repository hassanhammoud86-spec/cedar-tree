/**
 * global.d.ts - ambient declarations for the renderer:
 * - `window.cedarTree`, exposed by preload.ts via contextBridge.
 * - The Web Speech API's SpeechRecognition / webkitSpeechRecognition,
 *   which TypeScript's default DOM lib does not (yet) fully type.
 */
export {};

interface CedarTreeBridge {
  listTools(): Promise<{ ok: boolean; tools?: string[]; error?: string }>;
  callTool(name: string, args: unknown): Promise<{ ok: boolean; result?: unknown; error?: string }>;
  runCommand(transcript: string): Promise<{
    transcript: string;
    matchedTool: string | null;
    spokenReply: string;
    raw?: unknown;
  }>;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  [index: number]: { transcript: string };
  length: number;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    cedarTree: CedarTreeBridge;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    SpeechRecognition?: new () => SpeechRecognitionLike;
  }
}
