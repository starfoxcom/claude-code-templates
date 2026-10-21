// The install profiles setup reads must cover exactly the engine's
// code-research tools, in a shape setup can act on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CODE_RESEARCH_TOOLS } from "../model.js";

const hooks = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "_core", "global-template", "hooks");
const file = JSON.parse(readFileSync(join(hooks, "code-research-profiles.json"), "utf8"));
const profiles = Object.entries(file).filter(([key]) => !key.startsWith("_"));
const template = readFileSync(join(hooks, "code-research-first.py.template"), "utf8");

const OS = ["macos", "linux", "windows", "any"];
const isText = (v) => typeof v === "string" && v.trim() !== "";
const isCommands = (run) => Array.isArray(run) && run.length > 0 && run.every(isText);

test("profiles cover exactly the engine's code-research tools", () => {
  assert.deepEqual(profiles.map(([key]) => key).sort(), Object.keys(CODE_RESEARCH_TOOLS).sort());
});

test("every profile has the fields setup reads", () => {
  for (const [key, p] of profiles) {
    assert.ok(p.license === null || isText(p.license), `${key}: license`);
    assert.ok(Array.isArray(p.install), `${key}: install`);
    for (const step of p.install) {
      assert.ok(OS.includes(step.os), `${key}: unknown os "${step.os}"`);
      assert.ok(isCommands(step.run), `${key}: install commands`);
    }
    assert.ok(p.agent === null || isCommands(p.agent.run), `${key}: agent`);
    assert.ok(p.index === null || (isCommands(p.index.run) && isText(p.index.marker)), `${key}: index`);
    assert.ok(p.mcp === null || (isText(p.mcp.name) && isText(p.mcp.command) && Array.isArray(p.mcp.args)), `${key}: mcp`);
    assert.ok(["tool", "bindwright", "none"].includes(p.hook.source), `${key}: hook source`);
    assert.ok(isText(p.notes), `${key}: notes`);
  }
});

test("a tool with nothing to install has no install, agent or index steps", () => {
  for (const key of ["none", "custom"]) {
    const p = file[key];
    assert.deepEqual([p.install, p.agent, p.index, p.mcp], [[], null, null, null], key);
  }
});

test("every Bindwright hook fills the hook template completely", () => {
  // The engine supplies the name, kebab name and bypass marker; the profile the rest.
  const fromProfile = { DETECTION_MODE: "detection_mode", DETECTION_TARGET: "detection_target", SEQUENCE_BULLETS: "sequence_bullets" };
  const fromEngine = ["NAME", "NAME_KEBAB", "BYPASS_MARKER"];
  for (const [key, p] of profiles.filter(([, p]) => p.hook.source === "bindwright")) {
    assert.ok(["walk_up", "cli_available"].includes(p.hook.detection_mode), `${key}: detection_mode`);
    assert.ok(isText(p.hook.filename_basename) && isText(p.hook.detection_target) && isText(p.hook.sequence_bullets), key);
    for (const [, name] of template.matchAll(/\{\{TOOLS_CODE_RESEARCH_([A-Z_]+)\}\}/g)) {
      assert.ok(fromEngine.includes(name) || p.hook[fromProfile[name]] !== undefined, `${key}: nothing fills {{TOOLS_CODE_RESEARCH_${name}}}`);
    }
  }
});

test("the LSP profile names a plugin and server for every language it lists", () => {
  const plugins = file["lsp-plugins"].plugins;
  assert.ok(plugins.length > 0);
  for (const p of plugins) {
    assert.match(p.plugin, /^[a-z0-9-]+-lsp$/);
    assert.ok(isText(p.server), p.plugin);
    assert.ok(p.extensions.length > 0 && p.extensions.every((e) => /^\.[A-Za-z0-9]+$/.test(e)), p.plugin);
  }
  const extensions = plugins.flatMap((p) => p.extensions);
  assert.equal(new Set(extensions).size, extensions.length, "an extension maps to two plugins");
});
