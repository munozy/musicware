#!/usr/bin/env node
/**
 * Set the app's display name in src-tauri/tauri.conf.json:
 *   - productName  → the bundle/.app name shown in Finder, the Dock, and the menu bar
 *   - the main window title
 * (The bundle identifier com.musicware.app is intentionally left alone.)
 *
 * Usage:  npm run app-name:set "MoonOzy Studio"
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const name = process.argv.slice(2).join(" ").trim();

if (!name) {
  console.error('Usage: npm run app-name:set "<App Name>"');
  process.exit(1);
}
if (/["\\]/.test(name)) {
  console.error("App name can't contain quotes or backslashes.");
  process.exit(1);
}

const path = resolve(root, "src-tauri/tauri.conf.json");
let conf = readFileSync(path, "utf8");
let changed = 0;
const set = (re) =>
  (conf = conf.replace(re, (_m, open, _old, close) => {
    changed++;
    return open + name + close;
  }));

set(/("productName":\s*")([^"]*)(")/); // bundle/app name
set(/("title":\s*")([^"]*)(")/); // main window title (first/only one)

if (changed === 0) {
  console.error("✗ couldn't find productName/title in tauri.conf.json");
  process.exit(1);
}
writeFileSync(path, conf);
console.log(`✓ app name set to "${name}" (productName + window title). Rebuild to apply.`);
