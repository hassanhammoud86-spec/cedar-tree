/**
 * Path helpers shared by tools that touch the filesystem.
 *
 * CEDAR_TREE_WORKSPACE_ROOT controls scoping:
 *  - unset: the server's current working directory, restricted
 *  - one or more folders separated by ';': tools may only touch those folders
 *  - "*": unrestricted (any absolute path); relative paths resolve against the
 *    first existing root, or the current working directory
 * The first folder is the default root for relative paths.
 */
import { resolve, isAbsolute, relative, sep } from "node:path";

function configuredRoots(): string[] {
  const configured = process.env.CEDAR_TREE_WORKSPACE_ROOT?.trim();
  if (!configured) return [resolve(process.cwd())];
  return configured.split(";").map((s) => s.trim()).filter(Boolean);
}

export function isUnrestricted(): boolean {
  return configuredRoots().includes("*");
}

export function getWorkspaceRoot(): string {
  const first = configuredRoots().find((r) => r !== "*");
  return resolve(first ?? process.cwd());
}

export class PathSafetyError extends Error {}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

/**
 * Resolve `targetPath` (absolute or relative) and verify it stays inside an
 * allowed root. Throws PathSafetyError if it would escape. When `root` is
 * passed explicitly it is the only allowed root.
 */
export function resolveSafePath(targetPath: string, root?: string): string {
  const base = resolve(root ?? getWorkspaceRoot());
  const resolvedTarget = isAbsolute(targetPath) ? resolve(targetPath) : resolve(base, targetPath);
  if (!root && isUnrestricted()) return resolvedTarget;

  const allowed = root ? [base] : configuredRoots().map((r) => resolve(r));
  if (!allowed.some((r) => inside(r, resolvedTarget))) {
    throw new PathSafetyError(
      `Path "${targetPath}" resolves outside of the workspace root (${allowed.join("; ")}). ` +
        `Set CEDAR_TREE_WORKSPACE_ROOT to include it, or "*" for unrestricted.`
    );
  }
  return resolvedTarget;
}