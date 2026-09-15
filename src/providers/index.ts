/**
 * Provider selection for web_search / web_fetch tools.
 *
 * By default Cedar Tree uses the key-free DuckDuckGo search provider and the
 * built-in HTTP fetch provider. If CEDAR_TREE_SEARCH_API_KEY is set, the
 * API-key stub below is used instead (documented interface; wire up your
 * provider of choice by implementing WebSearchProvider).
 */
import { DuckDuckGoProvider } from "./duckduckgo.js";
import { HttpFetchProvider } from "./http-fetch.js";
import type { WebFetchProvider, WebSearchProvider, WebSearchResultItem } from "./types.js";

/**
 * Stub for a real key-based search API (e.g. Bing Web Search, Google
 * Programmable Search, Brave Search). Reads its key from
 * CEDAR_TREE_SEARCH_API_KEY. Implement the `search` body against whichever
 * provider you have credentials for; this is intentionally left as a clear
 * extension point rather than guessing at an API you may not have.
 */
export class ApiKeySearchProviderStub implements WebSearchProvider {
  readonly name = "api-key-stub";

  constructor(private readonly apiKey: string) {}

  async search(_query: string, _maxResults: number): Promise<WebSearchResultItem[]> {
    throw new Error(
      "CEDAR_TREE_SEARCH_API_KEY is set, but no concrete search API integration is configured. " +
        "Implement ApiKeySearchProviderStub.search() in src/providers/index.ts for your provider " +
        "(e.g. Bing Web Search, Google Programmable Search, Brave Search), or unset " +
        "CEDAR_TREE_SEARCH_API_KEY to fall back to the built-in DuckDuckGo provider."
    );
  }
}

export function getWebSearchProvider(): WebSearchProvider {
  const apiKey = process.env.CEDAR_TREE_SEARCH_API_KEY;
  if (apiKey && apiKey.trim().length > 0) {
    return new ApiKeySearchProviderStub(apiKey);
  }
  return new DuckDuckGoProvider();
}

export function getWebFetchProvider(): WebFetchProvider {
  return new HttpFetchProvider();
}

export type { WebFetchProvider, WebFetchResult, WebSearchProvider, WebSearchResultItem } from "./types.js";
