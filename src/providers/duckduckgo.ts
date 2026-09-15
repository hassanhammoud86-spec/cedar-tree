/**
 * DuckDuckGo-backed web search provider.
 *
 * Uses DuckDuckGo's public "Instant Answer" HTML-free JSON API
 * (https://duckduckgo.com/api), which requires no API key. Coverage is
 * limited (it favors instant-answer topics over general web results), so
 * treat this as a reasonable no-config default rather than a full search
 * engine. Swap in a paid provider (Bing/Google/Brave) by implementing
 * WebSearchProvider and wiring it up in providers/index.ts.
 */
import type { WebSearchProvider, WebSearchResultItem } from "./types.js";

interface DuckDuckGoRelatedTopic {
  Text?: string;
  FirstURL?: string;
  Topics?: DuckDuckGoRelatedTopic[];
}

interface DuckDuckGoResponse {
  AbstractText?: string;
  AbstractURL?: string;
  Heading?: string;
  RelatedTopics?: DuckDuckGoRelatedTopic[];
}

export class DuckDuckGoProvider implements WebSearchProvider {
  readonly name = "duckduckgo";

  async search(query: string, maxResults: number): Promise<WebSearchResultItem[]> {
    const url = new URL("https://api.duckduckgo.com/");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("skip_disambig", "1");

    const response = await fetch(url, {
      headers: { "User-Agent": "cedar-tree-mcp-server" },
    });
    if (!response.ok) {
      throw new Error(`DuckDuckGo API returned HTTP ${response.status}`);
    }
    const data = (await response.json()) as DuckDuckGoResponse;

    const results: WebSearchResultItem[] = [];
    if (data.AbstractText && data.AbstractURL) {
      results.push({ title: data.Heading ?? query, url: data.AbstractURL, snippet: data.AbstractText });
    }
    flattenTopics(data.RelatedTopics ?? [], results, maxResults);
    return results.slice(0, maxResults);
  }
}

function flattenTopics(topics: DuckDuckGoRelatedTopic[], out: WebSearchResultItem[], maxResults: number): void {
  for (const topic of topics) {
    if (out.length >= maxResults) return;
    if (topic.Topics) {
      flattenTopics(topic.Topics, out, maxResults);
    } else if (topic.FirstURL && topic.Text) {
      out.push({ title: topic.Text.split(" - ")[0] ?? topic.Text, url: topic.FirstURL, snippet: topic.Text });
    }
  }
}
