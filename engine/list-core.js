// Writes engine/core-files.json: every file under _core/project-template/.
// The browser cannot list directories, so the page reads this list instead.
// Run after adding, moving or deleting a template: node engine/list-core.js

import { readdirSync, writeFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(repo, "_core", "project-template");

export function listCore() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(relative(core, full).split("\\").join("/"));
    }
  };
  walk(core);
  return files.sort();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(join(repo, "engine", "core-files.json"), JSON.stringify(listCore(), null, 2) + "\n");
}
