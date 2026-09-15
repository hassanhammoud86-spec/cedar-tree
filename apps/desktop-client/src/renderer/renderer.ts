/**
 * renderer.ts - runs in the Electron renderer (plain browser context, no
 * Node access; contextIsolation is on). Talks to the main process only
 * through `window.cedarTree` (see preload.ts).
 *
 * Responsibilities:
 * - Speech-to-text via the Web Speech API (`webkitSpeechRecognition`),
 *   showing a live transcript.
 * - Text-to-speech via `SpeechSynthesis` for spoken replies.
 * - A lightweight camera "presence" heuristic via `getUserMedia` + a
 *   frame-difference canvas analysis (not a trained face model - see
 *   README for why, and how to swap in a real detector later).
 * - Routing finalized speech transcripts to real Cedar Tree tool calls via
 *   `window.cedarTree.runCommand()` and speaking/logging the result.
 */

const statusMcp = document.getElementById("status-mcp") as HTMLDivElement;
const statusMic = document.getElementById("status-mic") as HTMLDivElement;
const statusFace = document.getElementById("status-face") as HTMLDivElement;
const transcriptEl = document.getElementById("transcript") as HTMLDivElement;
const logEl = document.getElementById("log") as HTMLDivElement;
const btnMic = document.getElementById("btn-mic") as HTMLButtonElement;
const btnSpeakTest = document.getElementById("btn-speak-test") as HTMLButtonElement;
const btnCamera = document.getElementById("btn-camera") as HTMLButtonElement;
const video = document.getElementById("video") as HTMLVideoElement;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;

function setPill(el: HTMLDivElement, text: string, kind: "ok" | "warn" | "error" | "" = ""): void {
  el.textContent = text;
  el.className = `status-pill ${kind}`.trim();
}

function log(message: string): void {
  const entry = document.createElement("div");
  entry.className = "entry";
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logEl.prepend(entry);
}

function speak(text: string): void {
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

// --- MCP tool status -------------------------------------------------

async function initMcpStatus(): Promise<void> {
  try {
    const response = await window.cedarTree.listTools();
    if (response.ok && response.tools) {
      setPill(statusMcp, `MCP: ${response.tools.length} tools ready`, "ok");
      log(`Cedar Tree tools available: ${response.tools.join(", ")}`);
    } else {
      setPill(statusMcp, `MCP: error`, "error");
      log(`Failed to list tools: ${response.error ?? "unknown error"}`);
    }
  } catch (err) {
    setPill(statusMcp, "MCP: unreachable", "error");
    log(`Failed to reach Cedar Tree bridge: ${String(err)}`);
  }
}

// --- Speech-to-text ----------------------------------------------------

const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
let recognition: InstanceType<NonNullable<typeof SpeechRecognitionCtor>> | null = null;
let listening = false;

function setupRecognition(): void {
  if (!SpeechRecognitionCtor) {
    setPill(statusMic, "Mic: unsupported", "error");
    btnMic.disabled = true;
    log("Web Speech API (webkitSpeechRecognition) is not available in this build.");
    return;
  }

  recognition = new SpeechRecognitionCtor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onresult = (event) => {
    let interim = "";
    let finalText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? "";
      if (result.isFinal) {
        finalText += text;
      } else {
        interim += text;
      }
    }
    if (finalText.trim()) {
      transcriptEl.textContent = finalText.trim();
      void handleFinalTranscript(finalText.trim());
    } else if (interim.trim()) {
      transcriptEl.textContent = interim.trim();
    }
  };

  recognition.onerror = (event) => {
    log(`Speech recognition error: ${(event as any).error ?? "unknown"}`);
  };

  recognition.onend = () => {
    // Chromium's continuous recognition can stop on its own (e.g. network
    // hiccups); restart automatically while the user still wants to listen.
    if (listening) {
      try {
        recognition?.start();
      } catch {
        /* already starting */
      }
    } else {
      setPill(statusMic, "Mic: idle");
    }
  };
}

async function handleFinalTranscript(transcript: string): Promise<void> {
  log(`Heard: "${transcript}"`);
  try {
    const result = await window.cedarTree.runCommand(transcript);
    log(`Tool: ${result.matchedTool ?? "(no match)"} → ${result.spokenReply}`);
    speak(result.spokenReply);
  } catch (err) {
    const message = `Command routing failed: ${String(err)}`;
    log(message);
    speak("Something went wrong running that command.");
  }
}

btnMic.addEventListener("click", () => {
  if (!recognition) return;
  listening = !listening;
  if (listening) {
    recognition.start();
    setPill(statusMic, "Mic: listening", "ok");
    btnMic.textContent = "🛑 Stop listening";
    btnMic.classList.add("active");
  } else {
    recognition.stop();
    btnMic.textContent = "🎤 Start listening";
    btnMic.classList.remove("active");
  }
});

btnSpeakTest.addEventListener("click", () => {
  speak("Hello, I am Cedar Tree. I can list files, search code, read files, check git status, or run tests.");
});

// --- Camera presence heuristic ------------------------------------------

let cameraStream: MediaStream | null = null;
let previousFrame: Uint8ClampedArray | null = null;
let presenceInterval: number | null = null;

async function toggleCamera(): Promise<void> {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    previousFrame = null;
    if (presenceInterval) window.clearInterval(presenceInterval);
    video.srcObject = null;
    setPill(statusFace, "Presence: camera off");
    btnCamera.textContent = "📷 Start camera";
    btnCamera.classList.remove("active");
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    video.srcObject = cameraStream;
    btnCamera.textContent = "🛑 Stop camera";
    btnCamera.classList.add("active");
    setPill(statusFace, "Presence: analyzing…");
    presenceInterval = window.setInterval(analyzeFrame, 500);
  } catch (err) {
    setPill(statusFace, "Presence: camera denied", "error");
    log(`Camera access failed: ${String(err)}`);
  }
}

/**
 * Lightweight "is someone there" heuristic: downsample the video frame onto
 * a small canvas, compare grayscale pixel values against the previous
 * frame, and treat a meaningful amount of change as "presence detected".
 * This is intentionally NOT a trained face-detection model - see README.
 */
function analyzeFrame(): void {
  if (!cameraStream || video.readyState < 2) return;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let i = 0; i < gray.length; i++) {
    const offset = i * 4;
    gray[i] = (frame.data[offset] + frame.data[offset + 1] + frame.data[offset + 2]) / 3;
  }

  if (previousFrame) {
    let diffSum = 0;
    for (let i = 0; i < gray.length; i++) {
      diffSum += Math.abs(gray[i] - previousFrame[i]);
    }
    const avgDiff = diffSum / gray.length;

    // Also check overall brightness variance - a blank wall / covered lens
    // is near-uniform, while a person's face/shoulders add contrast.
    const mean = gray.reduce((a, b) => a + b, 0) / gray.length;
    const variance = gray.reduce((a, b) => a + (b - mean) ** 2, 0) / gray.length;

    const active = avgDiff > 1.5 || variance > 900;
    setPill(statusFace, active ? "Presence: detected" : "Presence: no motion", active ? "ok" : "warn");
  }

  previousFrame = gray;
}

btnCamera.addEventListener("click", () => void toggleCamera());

// --- Init ---------------------------------------------------------------

setupRecognition();
void initMcpStatus();
