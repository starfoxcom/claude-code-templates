// Turns answers into the finished file set for the user's repo root.
// `readFile(path)` returns the text of a repo-relative path (fetch in the
// browser, fs in Node), so the same code runs in both.

import { renderTemplate } from "./render.js";
import { validate, flagsFor, choicesFor, valuesFor, CHOICE_OPTIONS, DEFERRED, LICENSES } from "./model.js";

const CORE = "_core/project-template/";

// Files a repo often already has. They land in STAGING and the tailoring
// step merges them instead of the zip overwriting the user's copy.
const MERGE_TARGETS = new Set(["CLAUDE.md", "README.md", "CHANGELOG.md", "CONTRIBUTING.md", "LICENSE"]);
export const STAGING = ".bindwright/incoming/";

function included(path, a, flags) {
  const adv = a.advanced;
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
  };
  return path in byFile ? byFile[path] : true;
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
  return plan.sort((x, y) => x.dest.localeCompare(y.dest));
}

// Returns a Map of dest path -> rendered text.
export async function bind(answers, { readFile, coreFiles, year }) {
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
    out.set(dest, renderTemplate(await readFile(src), ctx, src));
  }
  return out;
}
