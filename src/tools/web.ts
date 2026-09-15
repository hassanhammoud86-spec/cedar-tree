/**
 * web_search / web_fetch - call a pluggable search/fetch provider.
 *
 * See src/providers/index.ts for provider selection: DuckDuckGo (no API key)
 * for search by default, or a documented stub if CEDAR_TREE_SEARCH_API_KEY
 * is set; a plain HTTP fetch provider for fetching pages.
 */
import { z } from "zod";
import type { ToolRegistry } from "../registry.js";
import { jsonResult, textResult } from "../registry.js";
import { getWebFetchProvider, getWebSearchProvider } from "../providers/index.js";

const MAX_FETCH_CHARS = 50_000;

export function register(registry: ToolRegistry): void {
  registry.registerTool({
    name: "web_search",
    description:
      "Search the web for a query and return a list of {title, url, snippet} results. Uses DuckDuckGo by default (no API key needed); set CEDAR_TREE_SEARCH_API_KEY to use a configured alternative provider.",
    inputSchema: {
      query: z.string().describe("Search query."),
      maxResults: z.number().int().positive().max(50).optional().describe("Max results to return. Defaults to 5."),
    },
    handler: async ({ query, maxResults }: { query: string; maxResults?: number }) => {
      try {
        const provider = getWebSearchProvider();
        const results = await provider.search(query, maxResults ?? 5);
        return jsonResult({ provider: provider.name, query, results });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult(`web_search failed: ${message}`, true);
      }
    },
  });

  registry.registerTool({
    name: "web_fetch",
    description:
      "Fetch a URL and return its status, content-type, and text content (HTML is stripped to plain text). Truncated to a safe max length.",
    inputSchema: {
      url: z.string().url().describe("URL to fetch."),
      maxChars: z
        .number()
        .int()
        .positive()
        .max(500_000)
        .optional()
        .describe(`Max characters of text to return. Defaults to ${MAX_FETCH_CHARS}.`),
    },
    handler: async ({ url, maxChars }: { url: string; maxChars?: number }) => {
      try {
        const provider = getWebFetchProvider();
        const result = await provider.fetch(url, maxChars ?? MAX_FETCH_CHARS);
        return jsonResult({ provider: provider.name, ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult(`web_fetch failed: ${message}`, true);
      }
    },
  });
}
