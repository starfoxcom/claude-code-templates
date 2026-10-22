// Turns answers into the finished file set for the user's repo root.
// `readFile(path)` returns the text of a repo-relative path (fetch in the
// browser, fs in Node), so the same code runs in both.

import { renderTemplate, fillPlaceholders } from "./render.js";
import { validate, flagsFor, choicesFor, valuesFor, CHOICE_OPTIONS, DEFERRED, LICENSES } from "./model.js";

const CORE = "_core/project-template/";

// Files a repo often already has. They land in STAGING and the tailoring
// step merges them instead of the zip overwriting the user's copy.
const MERGE_TARGETS = new Set([
  "CLAUDE.md", "README.md", "CHANGELOG.md", "CONTRIBUTING.md", "LICENSE", ".gitattributes", ".claude/settings.json",
]);
export const STAGING = ".bindwright/incoming/";

// Files for the user's ~/.claude, under the same paths there. Setup installs
// each one only with consent; the zip fallback leaves them to the reader.
export const GLOBAL = ".bindwright/global/";
const GLOBAL_CORE = "_core/global-template/";

// Setup's own state, which the repo keeps for /bindwright:update: the answers
// as given, and the render they produced (the base of a three-way merge, so
// an update never overwrites hand edits silently) with the template version
// and the year it used. One file each, never a mirror folder: a copy of
// .claude/ or CLAUDE.md inside the repo would load as rules and skills.
export const ANSWERS = ".bindwright/project.json";
export const PRISTINE = ".bindwright/pristine.json";

// Guard hooks and the review gate's scripts ship byte for byte: they are
// code, not templates, and the render step's blank-line folding would still
// change them.
const VERBATIM = [".claude/hooks/", ".github/scripts/"];

function included(path, a, flags) {
  const adv = a.advanced;
  // The review gate's scripts, settings, guide and pin check serve both tiers.
  const gate = flags.github_actions_routine_review || flags.github_actions_deep_review;
  if (path.startsWith("precommit/")) return false;
  if (path.startsWith(".claude/rules/architecture/")) return false;
  if (path.startsWith(".claude/skills/architecture-graph/")) return false;
  const byFile = {
    "CONTRIBUTING.md": a.team,
    ".github/CODEOWNERS.template": a.team,
    ".github/PULL_REQUEST_TEMPLATE.md": a.team || a.client,
    ".claude/rules/collaboration.md": a.team,
    ".claude/rules/confidentiality.md": adv.confidentiality,
    ".claude/rules/clean-room.md": adv.cleanRoom,
    ".claude/rules/shipped-text.md": adv.plainWriting,
    ".claude/rules/visual.md": adv.uiRule,
    ".claude/rules/review-tiers.md": adv.aiReview,
    ".claude/scripts/research-adherence.py": flags.code_research_first,
    ".github/workflows/claude-code-review.yml.template": flags.github_actions_routine_review,
    ".github/workflows/claude.yml.template": flags.github_actions_deep_review,
    ".github/scripts/review_gate.py": gate,
    ".github/scripts/setup-review-gate.sh": gate,
    ".github/scripts/pin_check.py": gate,
    ".github/workflows/pin-check.yml": gate,
    ".github/review-gate.yml.template": gate,
    ".github/review-guide.md.template": gate,
    ".claude/hooks/run-hook.sh": flags.guard_hooks_repo,
    ".claude/hooks/push-guard.py": flags.guard_hooks_repo,
    ".claude/hooks/no-ai-attribution.py": flags.guard_hooks_repo && flags.attribution_guard,
    ".gitattributes": flags.guard_hooks_repo,
  };
  return path in byFile ? byFile[path] : true;
}

// The writing rule keeps its default globs in its own frontmatter, so setups
// that never set `shippedTextPaths` render it untouched. A project list
// replaces that `paths:` block; a template whose header lost that shape
// fails the bind instead of shipping the defaults silently.
const SHIPPED_TEXT_RULE = ".claude/rules/shipped-text.md";
const PATHS_BLOCK = /^---\npaths:\n(?: {2}- .*\n)+---\n/;

function withPaths(text, globs, file) {
  if (!PATHS_BLOCK.test(text)) throw new Error(`${file}: no paths frontmatter to replace`);
  // A function replacement, so a `$` in a glob is never read as `$&` or `$1`.
  return text.replace(PATHS_BLOCK, () => `---\npaths:\n${globs.map((g) => `  - "${g}"\n`).join("")}---\n`);
}

function destination(path) {
  const dest = path.replace(/\.template$/, "");
  return MERGE_TARGETS.has(dest) ? STAGING + dest : dest;
}

// Returns [{ src, dest }] with repo-relative src paths.
export function planFiles(answers, coreFiles, precommitProfiles) {
  const a = validate(answers);
  const flags = flagsFor(a);
  const plan = coreFiles
    .filter((p) => included(p, a, flags))
    .map((p) => ({ src: CORE + p, dest: destination(p) }));
  if (a.advanced.architecture !== "none") {
    plan.push({ src: `${CORE}.claude/rules/architecture/${a.advanced.architecture}.md`, dest: ".claude/rules/architecture.md" });
  }
  if (a.advanced.precommit !== "none") {
    const profile = precommitProfiles[a.advanced.precommit];
    plan.push({ src: CORE + profile.template_ref, dest: profile.config_filename });
  }
  // Plain code-unit order: localeCompare depends on the browser's locale,
  // and the Python twin sorts the same way.
  return plan.sort((x, y) => (x.dest < y.dest ? -1 : x.dest > y.dest ? 1 : 0));
}

// The ~/.claude files, as [dest, text] under GLOBAL: the global CLAUDE.md
// additions, the memory index, the push guard, the attribution guard when the
// guards live in ~/.claude, and the research hook for a tool without its own.
async function globalFiles(a, ctx, readFile) {
  const verbatim = async (p) => (await readFile(GLOBAL_CORE + p)).replace(/\r\n/g, "\n");
  const render = async (p) => renderTemplate(await readFile(GLOBAL_CORE + p), ctx, GLOBAL_CORE + p);
  const out = [
    ["CLAUDE.md.additions", await render("CLAUDE.md.additions")],
    ["memory/MEMORY.md", await render("memory-template/MEMORY.md")],
    ["hooks/push-guard.py", await verbatim("hooks/push-guard.py")],
  ];
  if (!ctx.flags.guard_hooks_repo && ctx.flags.attribution_guard) {
    out.push(["hooks/no-ai-attribution.py", await verbatim("hooks/no-ai-attribution.py")]);
  }
  const profiles = JSON.parse(await readFile(`${GLOBAL_CORE}hooks/code-research-profiles.json`));
  const hook = profiles[a.advanced.codeResearch].hook;
  if (hook.source === "bindwright") {
    // The custom profile's fields name the tool through placeholders of their own.
    const field = (k) => fillPlaceholders(hook[k], ctx.values, ctx.deferred, `profile hook ${k}`);
    const values = {
      ...ctx.values,
      TOOLS_CODE_RESEARCH_DETECTION_MODE: field("detection_mode"),
      TOOLS_CODE_RESEARCH_DETECTION_TARGET: field("detection_target"),
      TOOLS_CODE_RESEARCH_SEQUENCE_BULLETS: field("sequence_bullets"),
    };
    const src = `${GLOBAL_CORE}hooks/code-research-first.py.template`;
    out.push([`hooks/${field("filename_basename")}.py`, renderTemplate(await readFile(src), { ...ctx, values }, src)]);
  }
  return out.map(([dest, text]) => [GLOBAL + dest, text]);
}

const byDest = ([x], [y]) => (x < y ? -1 : x > y ? 1 : 0);

// Two-space JSON with a final newline; bind.py's _state_json writes the same bytes.
const stateJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

// The state files for a bind's repo files: each under the path it belongs
// at, staged or not. The ~/.claude files are not the repo's.
function stateFiles(answers, files, version, year) {
  const pristine = files
    .filter(([dest]) => !dest.startsWith(GLOBAL))
    .map(([dest, text]) => [dest.startsWith(STAGING) ? dest.slice(STAGING.length) : dest, text])
    .sort(byDest);
  return [
    [ANSWERS, stateJson(answers)],
    [PRISTINE, stateJson({ version, year, files: Object.fromEntries(pristine) })],
  ];
}

// Returns a Map of dest path -> rendered text, in plain code-unit order.
// `version` is the template version recorded in the pristine render.
export async function bind(answers, { readFile, coreFiles, year, version = null }) {
  const a = validate(answers);
  const precommitProfiles = JSON.parse(await readFile(`${CORE}precommit/precommit-profiles.json`));
  const values = valuesFor(a, { year });
  if (a.advanced.precommit !== "none") {
    const p = precommitProfiles[a.advanced.precommit];
    values.TOOLS_PRECOMMIT_NAME = a.advanced.precommit;
    values.TOOLS_PRECOMMIT_URL = p.url;
  }
  const licenseText = await readFile(`_core/licenses/${LICENSES[a.project.license]}`);
  const ctx = { flags: flagsFor(a), choices: choicesFor(a), options: CHOICE_OPTIONS, values, deferred: DEFERRED };
  values.LICENSE_BODY = renderTemplate(licenseText, ctx, "license").trimEnd();

  const out = new Map();
  for (const { src, dest } of planFiles(a, coreFiles, precommitProfiles)) {
    const text = await readFile(src);
    out.set(dest, VERBATIM.some((p) => dest.startsWith(p)) ? text.replace(/\r\n/g, "\n") : renderTemplate(text, ctx, src));
  }
  if (out.has(SHIPPED_TEXT_RULE) && a.advanced.shippedTextPaths) {
    out.set(SHIPPED_TEXT_RULE, withPaths(out.get(SHIPPED_TEXT_RULE), a.advanced.shippedTextPaths, SHIPPED_TEXT_RULE));
  }
  const files = [...out, ...(await globalFiles(a, ctx, readFile))];
  return new Map([...files, ...stateFiles(answers, files, version, values.YEAR)].sort(byDest));
}
