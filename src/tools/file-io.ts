/**
 * read_file / write_file - safe, path-scoped file I/O tools.
 *
 * Both tools resolve their `path` argument against the Cedar Tree workspace
 * root (see src/workspace.ts) and refuse to operate outside of it.
 */
import { z } from "zod";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ToolRegistry } from "../registry.js";
import { jsonResult, textResult } from "../registry.js";
import { PathSafetyError, resolveSafePath } from "../workspace.js";

const MAX_READ_BYTES = 5 * 1024 * 1024; // 5 MB safety cap

export function register(registry: ToolRegistry): void {
  registry.registerTool({
    name: "read_file",
    description:
      "Read a UTF-8 text file from within the workspace root. Path is resolved relative to the workspace root and cannot escape it.",
    inputSchema: {
      path: z.string().describe("File path, relative to the workspace root (or absolute within it)."),
      encoding: z
        .enum(["utf-8", "base64"])
        .optional()
        .describe("Encoding to read the file as. Defaults to utf-8."),
    },
    handler: async ({ path, encoding }: { path: string; encoding?: "utf-8" | "base64" }) => {
      try {
        const resolved = resolveSafePath(path);
        const buf = await readFile(resolved);
        if (buf.byteLength > MAX_READ_BYTES) {
          return textResult(
            `File "${path}" is ${buf.byteLength} bytes, which exceeds the ${MAX_READ_BYTES} byte read limit.`,
            true
          );
        }
        const content = encoding === "base64" ? buf.toString("base64") : buf.toString("utf-8");
        return jsonResult({ path: resolved, bytes: buf.byteLength, content });
      } catch (err) {
        return textResult(formatError(err, path), true);
      }
    },
  });

  registry.registerTool({
    name: "write_file",
    description:
      "Write (create or overwrite) a UTF-8 text file within the workspace root. Creates parent directories as needed.",
    inputSchema: {
      path: z.string().describe("File path, relative to the workspace root (or absolute within it)."),
      content: z.string().describe("File content to write."),
      encoding: z
        .enum(["utf-8", "base64"])
        .optional()
        .describe("Encoding of `content`. Defaults to utf-8."),
      createDirectories: z
        .boolean()
        .optional()
        .describe("Create parent directories if they do not exist. Defaults to true."),
    },
    handler: async ({
      path,
      content,
      encoding,
      createDirectories,
    }: {
      path: string;
      content: string;
      encoding?: "utf-8" | "base64";
      createDirectories?: boolean;
    }) => {
      try {
        const resolved = resolveSafePath(path);
        if (createDirectories !== false) {
          await mkdir(dirname(resolved), { recursive: true });
        }
        const buf = encoding === "base64" ? Buffer.from(content, "base64") : Buffer.from(content, "utf-8");
        await writeFile(resolved, buf);
        return jsonResult({ path: resolved, bytesWritten: buf.byteLength });
      } catch (err) {
        return textResult(formatError(err, path), true);
      }
    },
  });
}

function formatError(err: unknown, path: string): string {
  if (err instanceof PathSafetyError) {
    return err.message;
  }
  const message = err instanceof Error ? err.message : String(err);
  return `Failed to access "${path}": ${message}`;
}
