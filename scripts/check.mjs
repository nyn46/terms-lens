// Syntax-checks every JavaScript file and confirms the manifest points at real files.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  );

let failed = false;
const files = ["extension", "server", "scripts", "tests"].flatMap((d) => walk(join(root, d)))
  .filter((file) => /\.(js|mjs)$/.test(file));
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    failed = true;
    console.error(`Syntax error in ${file}\n${error.stderr}`);
  }
}

const manifest = JSON.parse(readFileSync(join(root, "extension", "manifest.json"), "utf8"));
const referenced = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  manifest.options_ui?.page
].filter(Boolean);
for (const file of referenced) {
  if (!existsSync(join(root, "extension", file))) {
    failed = true;
    console.error(`manifest.json references a missing file: ${file}`);
  }
}

if (failed) process.exit(1);
console.log(`Checked ${files.length} scripts and ${referenced.length} manifest entries: OK`);
