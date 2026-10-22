// The files a bind offers for the user's ~/.claude, under .bindwright/global/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bind, GLOBAL } from "../bind.js";
import { defaults, CODE_RESEARCH_TOOLS } from "../model.js";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readFile = async (p) => readFileSync(join(repo, p), "utf8");
const coreFiles = JSON.parse(readFileSync(join(repo, "engine", "core-files.json"), "utf8"));
const profiles = JSON.parse(readFileSync(join(repo, "_core/global-template/hooks/code-research-profiles.json"), "utf8"));
const canonical = (p) => readFileSync(join(repo, "_core/global-template", p), "utf8").replace(/\r\n/g, "\n");

async function globalFiles(edit = () => {}) {
  const a = defaults();
  edit(a);
  const files = await bind(a, { readFile, coreFiles, year: 2026 });
  return new Map([...files].filter(([p]) => p.startsWith(GLOBAL)).map(([p, t]) => [p.slice(GLOBAL.length), t]));
}

const CUSTOM = { name: "My Tool.v2+", url: "https://example.com/my-tool" };
const useTool = (tool) => (a) => {
  a.advanced.codeResearch = tool;
  a.advanced.codeResearchCustom = tool === "custom" ? CUSTOM : null;
};

test("every setup offers the global additions, the memory index and the push guard", async () => {
  const files = await globalFiles((a) => { a.project.name = "shop-app"; });
  assert.deepEqual([...files.keys()], ["CLAUDE.md.additions", "hooks/push-guard.py", "memory/MEMORY.md"]);
  assert.equal(files.get("hooks/push-guard.py"), canonical("hooks/push-guard.py"));
  assert.match(files.get("memory/MEMORY.md"), /^# shop-app /);
});

test("the attribution guard goes global only when the guards live in ~/.claude", async () => {
  const home = await globalFiles((a) => { a.advanced.hookLocation = "home"; });
  assert.equal(home.get("hooks/no-ai-attribution.py"), canonical("hooks/no-ai-attribution.py"));
  const off = await globalFiles((a) => { a.advanced.hookLocation = "home"; a.advanced.attributionGuard = false; });
  assert.ok(!off.has("hooks/no-ai-attribution.py"));
  assert.ok(!(await globalFiles()).has("hooks/no-ai-attribution.py"));
});

test("a research hook ships only for tools that bring none of their own", async () => {
  for (const tool of Object.keys(CODE_RESEARCH_TOOLS)) {
    const files = await globalFiles(useTool(tool));
    const hooks = [...files.keys()].filter((p) => p.endsWith("-first.py"));
    if (profiles[tool].hook.source !== "bindwright") {
      assert.deepEqual(hooks, [], tool);
      continue;
    }
    assert.equal(hooks.length, 1, tool);
    const text = files.get(hooks[0]);
    assert.match(text, /^DETECTION_MODE = "(walk_up|cli_available)"$/m, tool);
    assert.ok(!text.includes("{{"), `${tool} hook has an unfilled placeholder`);
  }
  const custom = await globalFiles(useTool("custom"));
  const hook = custom.get("hooks/my-tool-v2-first.py");
  assert.match(hook, /^DISPLAY_NAME = "My Tool\.v2\+"$/m);
  assert.match(hook, /^DETECTION_TARGET = "my-tool-v2"$/m);
  assert.ok(hook.includes(CUSTOM.url));
});

// Each tool's block in the template, as its lines without placeholders.
function blockLines(tool) {
  const text = canonical("CLAUDE.md.additions");
  const start = text.indexOf(`<!-- TOGGLE:code_research:${tool} START -->`);
  const end = text.indexOf(`<!-- TOGGLE:code_research:${tool} END -->`);
  assert.ok(start !== -1 && end > start, `no block for ${tool}`);
  return text.slice(start, end).split("\n").slice(1).filter((l) => l.trim() && !l.includes("{{"));
}

test("the global additions keep only the chosen tool's block", async () => {
  const tools = Object.keys(CODE_RESEARCH_TOOLS);
  for (const tool of tools) {
    const text = (await globalFiles(useTool(tool))).get("CLAUDE.md.additions");
    assert.ok(!text.includes("TOGGLE:"), tool);
    assert.ok(!text.includes("{{"), tool);
    // Every line of the custom block names the tool, so its check is the filled name.
    if (tool === "custom") assert.ok(text.includes(`use **${CUSTOM.name}** (${CUSTOM.url})`), tool);
    else assert.ok(blockLines(tool).length > 0, `${tool}'s block has no fixed line to check`);
    for (const line of blockLines(tool)) assert.ok(text.includes(line), `${tool} lost: ${line}`);
    for (const other of tools.filter((t) => t !== tool)) {
      for (const line of blockLines(other)) assert.ok(!text.includes(line), `${tool} kept ${other}'s: ${line}`);
    }
  }
});
