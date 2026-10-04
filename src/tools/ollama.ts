/**
 * Ollama tools - connect every locally installed Ollama model to Cedar Tree.
 *  - ollama_models:   list installed models (auto-discovered, nothing hard-coded)
 *  - ollama_ask:      ask one model (or "auto" to route by task kind)
 *  - ollama_ensemble: ask several models at once and optionally have a judge merge the answers
 */
import { z } from "zod";
import type { ToolRegistry } from "../registry.js";
import { jsonResult, textResult } from "../registry.js";

const HOST = (process.env["OLLAMA_HOST"] ?? "http://127.0.0.1:11434").replace(/\/+$/, "").replace(/^(?!https?:)/, "http://");

interface OllamaModel { name: string; size: number; decision?: boolean }

async function api(path: string, body?: unknown, timeoutMs = 300_000): Promise<any> {
  const res = await fetch(`${HOST}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Ollama ${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export async function listModels(): Promise<OllamaModel[]> {
  const data = await api("/api/tags", undefined, 8000);
  const models: OllamaModel[] = (data.models ?? []).map((m: any) => ({ name: m.name as string, size: (m.size as number) ?? 0 }));
  await Promise.all(models.map(async (m) => (m.decision = await isDecisionModel(m.name))));
  return models;
}

// Decision models (clef-flash, tev1, nimble, ...) advertise the "decision" capability and only speak /v1/systemone.
const decisionCache = new Map<string, boolean>();
async function isDecisionModel(name: string): Promise<boolean> {
  const hit = decisionCache.get(name);
  if (hit !== undefined) return hit;
  let is = false;
  try {
    const info = await api("/api/show", { model: name }, 8000);
    is = Array.isArray(info.capabilities) && info.capabilities.includes("decision");
  } catch {
    return false;
  }
  decisionCache.set(name, is);
  return is;
}

const isCloud = (m: OllamaModel) => m.name.endsWith(":cloud") || m.size === 0;
const gb = (m: OllamaModel) => m.size / 1024 ** 3;

const KIND_HINTS: Record<string, RegExp> = {
  code: /(claude-code|clef|tev1|qwen|granite|gemma|nimble|ornith|glm)/i,
  review: /(granite.*guardian|llama3\.3|mistral|gemma)/i,
  chat: /(astrea|clef|tev1|llama3|gemma|mistral|qwen)/i,
  fast: /(claude-code|tev1|lfm|llama3:|granite4\.2|nimble|ornith)/i,
  reasoning: /(llama3\.3|mistral-medium|qwen|gemma|glm)/i,
};

function pickModel(models: OllamaModel[], kind: string): OllamaModel | undefined {
  const local = models.filter((m) => !isCloud(m) && !m.decision && !/ollamik/i.test(m.name));
  const maxGb = kind === "fast" ? 8 : kind === "reasoning" ? 45 : 20;
  const pool = local.filter((m) => gb(m) <= maxGb);
  const hinted = pool.filter((m) => KIND_HINTS[kind]?.test(m.name));
  return (hinted.length ? hinted : pool.length ? pool : local).sort((a, b) => b.size - a.size)[0];
}

async function resolveName(name: string): Promise<string> {
  const models = await listModels();
  const q = name.toLowerCase();
  const hit = models.find((m) => m.name.toLowerCase() === q) ?? models.find((m) => m.name.toLowerCase().replace(/[:\-_ ]/g, "") .startsWith(q.replace(/[:\-_ ]/g, ""))) ?? models.find((m) => m.name.toLowerCase().includes(q));
  return hit?.name ?? name;
}

async function chat(model: string, prompt: string, system?: string, timeoutMs?: number): Promise<string> {
  const messages = [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }];
  try {
    const data = await api("/api/chat", { model, messages, stream: false }, timeoutMs);
    return String(data.message?.content || data.message?.thinking || "").trim();
  } catch (e) {
    if (!/does not support chat/i.test((e as Error).message)) throw e;
    const gen = await api("/api/generate", { model, prompt, ...(system ? { system } : {}), stream: false }, timeoutMs);
    return String(gen.response || gen.thinking || "").trim();
  }
}

export function register(registry: ToolRegistry): void {
  registry.registerTool({
    name: "ollama_models",
    description: "List all AI models installed in the local Ollama (name and size). Use before ollama_ask / ollama_ensemble.",
    inputSchema: {},
    handler: async () => {
      try {
        const models = await listModels();
        return jsonResult(models.map((m) => ({ name: m.name, sizeGB: +gb(m).toFixed(1), cloud: isCloud(m), type: m.decision ? "decision (use ollama_decide)" : "generative" })));
      } catch (e) {
        return textResult(`Ollama is not reachable at ${HOST}. Start it (ollama serve). ${(e as Error).message}`, true);
      }
    },
  });

  registry.registerTool({
    name: "ollama_decide",
    description:
      "Make fast structured decisions with a local Ollama decision model (clef-flash, tev1, nimble) via /v1/systemone. Give the text to judge as 'state' and named questions of type choice (pick one option), noul (true/false probability) or score (rubric level). Returns the choice/probabilities/confidence per question. Model 'auto' picks tev1, then clef-flash, then any decision model.",
    inputSchema: {
      state: z.union([z.string(), z.record(z.unknown()), z.array(z.unknown())]).describe("The text or JSON to judge"),
      questions: z
        .record(
          z.object({
            type: z.enum(["choice", "noul", "score"]),
            instructions: z.string(),
            criteria: z.union([z.record(z.string().nullable()), z.array(z.string())]).optional()
              .describe("choice: {option: description|null}; noul: optional {true,false}; score: array of level descriptions, lowest first"),
          }),
        )
        .describe("1-64 named questions"),
      model: z.string().default("auto").describe("Decision model name or short alias (clef, tev1) or 'auto'"),
      images: z.array(z.string()).optional().describe("Base64 PNG/JPEG/WebP images (clef-flash only)"),
      timeoutSeconds: z.number().int().min(5).max(900).default(180),
    },
    handler: async ({ state, questions, model, images, timeoutSeconds }) => {
      try {
        const all = await listModels();
        const decision = all.filter((m) => m.decision);
        if (!decision.length) return textResult("No decision models installed (try: ollama pull tev1:4b / clef-flash).", true);
        let name = model as string;
        if (!name || name === "auto") {
          const pref = (images?.length ? [/clef/i] : [/tev1/i, /clef/i]).flatMap((re) => decision.filter((m) => re.test(m.name)));
          name = (pref[0] ?? decision[0]).name;
        } else {
          name = await resolveName(name);
          if (!decision.some((m) => m.name === name)) return textResult(`${name} is not a decision model. Decision models: ${decision.map((m) => m.name).join(", ")}`, true);
        }
        const data = await api("/v1/systemone", { model: name, state, questions, ...(images?.length ? { images } : {}) }, timeoutSeconds * 1000);
        return jsonResult({ model: name, answers: data.answers, usage: data.usage });
      } catch (e) {
        return textResult(`ollama_decide failed: ${(e as Error).message}`, true);
      }
    },
  });

  registry.registerTool({
    name: "ollama_ask",
    description:
      "Ask a local Ollama model. model = exact name from ollama_models, or 'auto' to choose by kind (code, review, fast, reasoning, chat). Good for second opinions, drafts, and offline work.",
    inputSchema: {
      prompt: z.string().describe("The question or task"),
      model: z.string().default("auto").describe("Model name or 'auto'"),
      kind: z.enum(["code", "review", "fast", "reasoning", "chat"]).default("code").describe("Used when model is 'auto'"),
      system: z.string().optional().describe("Optional system prompt"),
      timeoutSeconds: z.number().int().min(5).max(1800).default(300),
    },
    handler: async ({ prompt, model, kind, system, timeoutSeconds }) => {
      try {
        let name = model as string;
        if (!name || name === "auto") {
          const picked = pickModel(await listModels(), kind);
          if (!picked) return textResult("No local Ollama models found.", true);
          name = picked.name;
        }
        name = await resolveName(name);
        if (await isDecisionModel(name)) {
          return textResult(`${name} is a decision model (choice / true-false / score), not a chat model. Use ollama_decide with model "${name}".`, true);
        }
        const answer = await chat(name, prompt, system, timeoutSeconds * 1000);
        return textResult(`[${name}]\n${answer}`);
      } catch (e) {
        return textResult(`ollama_ask failed: ${(e as Error).message}`, true);
      }
    },
  });

  registry.registerTool({
    name: "ollama_ensemble",
    description:
      "Ask several local Ollama models the same question and return every answer; optionally a judge model merges them into one best answer. models omitted = all local models up to maxModelGB. Models run 2 at a time.",
    inputSchema: {
      prompt: z.string(),
      models: z.array(z.string()).optional().describe("Model names; default: all local (non-cloud) models within maxModelGB"),
      maxModelGB: z.number().default(20).describe("Skip models larger than this when models is omitted"),
      judge: z.string().optional().describe("Model name to merge the answers, or 'auto' to pick the largest suitable one"),
      timeoutSeconds: z.number().int().min(5).max(1800).default(300),
    },
    handler: async ({ prompt, models, maxModelGB, judge, timeoutSeconds }) => {
      try {
        const all = await listModels();
        const names: string[] =
          models && models.length
            ? (await Promise.all(models.map(resolveName))).filter((n) => !all.find((m) => m.name === n)?.decision)
            : all.filter((m) => !isCloud(m) && !m.decision && !/ollamik|guardian/i.test(m.name) && gb(m) <= maxModelGB).map((m) => m.name);
        if (!names.length) return textResult("No models selected.", true);

        const results: Array<{ model: string; answer?: string; error?: string }> = [];
        const queue = [...names];
        const worker = async () => {
          for (let n = queue.shift(); n; n = queue.shift()) {
            try {
              results.push({ model: n, answer: await chat(n, prompt, undefined, timeoutSeconds * 1000) });
            } catch (e) {
              results.push({ model: n, error: (e as Error).message });
            }
          }
        };
        await Promise.all([worker(), worker()]);

        let merged: string | undefined;
        const good = results.filter((r) => r.answer);
        if (judge && good.length > 1) {
          const jName = judge === "auto" ? pickModel(all, "reasoning")?.name : judge;
          if (jName) {
            const body = good.map((r, i) => `### Answer ${i + 1} (${r.model})\n${r.answer}`).join("\n\n");
            merged = `[judge: ${jName}]\n` + (await chat(
              jName,
              `Question:\n${prompt}\n\n${body}\n\nCompare the answers, resolve disagreements, and give one best final answer.`,
              undefined,
              timeoutSeconds * 1000,
            ));
          }
        }
        return jsonResult({ results, merged });
      } catch (e) {
        return textResult(`ollama_ensemble failed: ${(e as Error).message}`, true);
      }
    },
  });
}