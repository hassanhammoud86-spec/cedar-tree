/**
 * Pluggable provider interface for web search / fetch, so the concrete
 * backend (a search API, a headless fetcher, etc) can be swapped without
 * touching the tool layer. See providers/duckduckgo.ts for the bundled
 * key-free implementation, and providers/index.ts for how a provider is
 * selected at runtime (env-configurable).
 */

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchProvider {
  /** Short identifier, e.g. "duckduckgo". */
  readonly name: string;
  search(query: string, maxResults: number): Promise<WebSearchResultItem[]>;
}

export interface WebFetchResult {
  url: string;
  status: number;
  contentType: string | null;
  text: string;
  truncated: boolean;
}

export interface WebFetchProvider {
  readonly name: string;
  fetch(url: string, maxChars: number): Promise<WebFetchResult>;
}
