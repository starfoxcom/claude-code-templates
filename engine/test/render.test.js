import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBlocks, fillPlaceholders, renderTemplate, TemplateError } from "../render.js";

const block = (id, body) => `<!-- TOGGLE:${id} START -->\n${body}\n<!-- TOGGLE:${id} END -->`;

test("on flag keeps content and drops markers", () => {
  assert.equal(resolveBlocks(`a\n${block("x", "b")}\nc`, { flags: { x: true } }), "a\nb\nc");
});

test("off flag removes the whole block", () => {
  assert.equal(resolveBlocks(`a\n${block("x", "b")}\nc`, { flags: { x: false } }), "a\nc");
});

test(":off blocks invert the flag", () => {
  assert.equal(resolveBlocks(block("x:off", "b"), { flags: { x: false } }), "b");
  assert.equal(resolveBlocks(block("x:off", "b"), { flags: { x: true } }), "");
});

test("choice blocks keep only the matching value", () => {
  const text = [block("tool:a", "A"), block("tool:b", "B")].join("\n");
  assert.equal(resolveBlocks(text, { choices: { tool: "b" } }), "B");
  assert.equal(resolveBlocks(text, { choices: { tool: "zzz" } }), "");
});

test("nested blocks need every parent kept", () => {
  const text = block("outer", block("pc:husky", "H"));
  assert.equal(resolveBlocks(text, { flags: { outer: true }, choices: { pc: "husky" } }), "H");
  assert.equal(resolveBlocks(text, { flags: { outer: false }, choices: { pc: "husky" } }), "");
});

test("indented markers are recognised", () => {
  assert.equal(resolveBlocks("    <!-- TOGGLE:x START -->\n  y\n    <!-- TOGGLE:x END -->", { flags: { x: true } }), "  y");
});

test("unknown flags, mismatched and unclosed blocks are errors", () => {
  assert.throws(() => resolveBlocks(block("nope", "b"), { flags: {} }), TemplateError);
  assert.throws(() => resolveBlocks("<!-- TOGGLE:x START -->\n<!-- TOGGLE:y END -->", { flags: { x: true } }), TemplateError);
  assert.throws(() => resolveBlocks("<!-- TOGGLE:x START -->\nb", { flags: { x: true } }), TemplateError);
  assert.throws(() => resolveBlocks("text <!-- TOGGLE:x START --> inline", { flags: { x: true } }), TemplateError);
});

test("placeholders fill, deferred ones survive, unknown ones fail", () => {
  assert.equal(fillPlaceholders("{{A}}-{{B}}", { A: 1 }, new Set(["B"])), "1-{{B}}");
  assert.throws(() => fillPlaceholders("{{C}}", {}), TemplateError);
});

test("GitHub Actions expressions are left alone", () => {
  assert.equal(fillPlaceholders("${{ github.sha }}", {}), "${{ github.sha }}");
});

test("render normalises line endings and collapses blank runs", () => {
  assert.equal(renderTemplate("a\r\n\r\n\r\n\r\nb", { values: {} }), "a\n\nb");
});
