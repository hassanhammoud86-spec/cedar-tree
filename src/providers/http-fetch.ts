/**
 * Generic HTTP fetch provider used by the web_fetch tool. Uses Node's
 * built-in fetch (Node >= 18), stripping HTML tags for a rough text-only
 * preview so it stays useful without extra dependencies.
 */
import type { WebFetchProvider, WebFetchResult } from "./types.js";

export class HttpFetchProvider implements WebFetchProvider {
  readonly name = "http";

  async fetch(url: string, maxChars: number): Promise<WebFetchResult> {
    const response = await fetch(url, {
      headers: { "User-Agent": "cedar-tree-mcp-server" },
      redirect: "follow",
    });
    const contentType = response.headers.get("content-type");
    const raw = await response.text();
    const text = contentType?.includes("html") ? stripHtml(raw) : raw;
    const truncated = text.length > maxChars;
    return {
      url,
      status: response.status,
      contentType,
      text: truncated ? text.slice(0, maxChars) : text,
      truncated,
    };
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
