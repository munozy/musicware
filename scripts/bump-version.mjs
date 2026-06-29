#!/usr/bin/env node
/**
 * Set the app version consistently across the three files that carry it, so a release build
 * never ships mismatched versions:
 *   - package.json          ("version")
 *   - src-tauri/tauri.conf.json  ("version" → the bundle/installer version)
 *   - src-tauri/Cargo.toml   ([package] version)
 *
 * Usage:  npm run version:set 0.2.0
 * Targeted regex edits (not JSON round-trips) so the files keep their formatting.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Usage: npm run version:set <x.y.z>   (got: ${version ?? "nothing"})`);
  process.exit(1);
}

/**
 * Replace the version value in `file`. The regex must capture (prefix+openQuote)(oldValue)(closeQuote);
 * the old value is swapped for `version`. Function replacer keeps formatting and is $-safe.
 */
function patch(file, re, label) {
  const path = resolve(root, file);
  const before = readFileSync(path, "utf8");
  let hit = false;
  const after = before.replace(re, (_m, open, _old, close) => {
    hit = true;
    return open + version + close;
  });
  if (!hit) {
    console.error(`✗ could not find the version field in ${file} (${label})`);
    process.exit(1);
  }
  writeFileSync(path, after);
}

// package.json + tauri.conf.json: the first top-level "version": "..."
patch("package.json", /("version":\s*")([^"]*)(")/, "package.json version");
patch("src-tauri/tauri.conf.json", /("version":\s*")([^"]*)(")/, "tauri.conf.json version");
// Cargo.toml: the line-starting `version = "..."` is the [package] one (deps are inline/indented).
patch("src-tauri/Cargo.toml", /^(version = ")([^"]*)(")/m, "Cargo.toml [package] version");

console.log(`✓ version set to ${version} (package.json, tauri.conf.json, Cargo.toml)`);
