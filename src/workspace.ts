/**
 * Path-safety helpers shared by tools that touch the filesystem.
 *
 * Cedar Tree tools are scoped to a single "workspace root" (defaults to the
 * current working directory the server was started in, override with the
 * CEDAR_TREE_WORKSPACE_ROOT env var). Any path a tool resolves is checked to
 * ensure it stays inside that root, preventing accidental (or malicious)
 * escapes via `..` segments or absolute paths outside the workspace.
 */
import { resolve, isAbsolute, relative, sep } from "node:path";

export function getWorkspaceRoot(): string {
  const configured = process.env.CEDAR_TREE_WORKSPACE_ROOT;
  return resolve(configured && configured.trim().length > 0 ? configured : process.cwd());
}

export class PathSafetyError extends Error {}

/**
 * Resolve `targetPath` (absolute or relative) against `root` and verify the
 * result does not escape `root`. Throws PathSafetyError if it would.
 */
export function resolveSafePath(targetPath: string, root: string = getWorkspaceRoot()): string {
  const resolvedRoot = resolve(root);
  const resolvedTarget = isAbsolute(targetPath) ? resolve(targetPath) : resolve(resolvedRoot, targetPath);

  const rel = relative(resolvedRoot, resolvedTarget);
  const escapes = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  if (escapes) {
    throw new PathSafetyError(
      `Path "${targetPath}" resolves outside of the workspace root "${resolvedRoot}"`
    );
  }
  return resolvedTarget;
}
