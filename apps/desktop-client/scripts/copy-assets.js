/**
 * copy-assets.js - copies static renderer assets (HTML/CSS) that don't go
 * through tsc into dist/renderer, after the TypeScript build steps.
 */
const fs = require("node:fs");
const path = require("node:path");

const srcDir = path.join(__dirname, "..", "src", "renderer");
const destDir = path.join(__dirname, "..", "dist", "renderer");

fs.mkdirSync(destDir, { recursive: true });

for (const file of ["index.html", "style.css"]) {
  fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
  console.log(`copied ${file} -> dist/renderer/${file}`);
}

// Bundle the Cedar Tree MCP server's compiled output (dist/) into this
// app's own dist/, at dist/cedar-tree/, so the desktop client has no
// runtime npm dependency on the sibling `cedar-tree` package (avoids
// electron-builder having to walk/prune a monorepo-hoisted node_modules
// tree). mcp-bridge.ts imports from this local copy via a relative path.
const cedarTreeDistSrc = path.join(__dirname, "..", "..", "..", "dist");
const cedarTreeDistDest = path.join(__dirname, "..", "dist", "cedar-tree");

if (!fs.existsSync(cedarTreeDistSrc)) {
  throw new Error(
    `Cannot find built Cedar Tree server output at ${cedarTreeDistSrc}. Run "npm run build" at the repo root first.`
  );
}

fs.rmSync(cedarTreeDistDest, { recursive: true, force: true });
fs.cpSync(cedarTreeDistSrc, cedarTreeDistDest, { recursive: true });

// The copied files use ESM `import`/`export` syntax (compiled with
// module: NodeNext against a "type": "module" package.json at the repo
// root). Node determines module type per-file from the nearest ancestor
// package.json, and this app's own package.json has no "type" field
// (CommonJS default) - so drop a minimal "type": "module" package.json
// alongside the copy to keep these files interpreted as ESM.
fs.writeFileSync(path.join(cedarTreeDistDest, "package.json"), JSON.stringify({ type: "module" }, null, 2));

console.log(`bundled cedar-tree dist -> dist/cedar-tree`);
