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
