// The answer model: two questions, a few advanced choices, and everything
// derived from them. This is the single source for what a bind produces.

// Must be models the pinned claude-code-action in the workflow templates
// accepts; these are the pins this repo's own review workflows run on.
// Change them together with the action pin, never on their own.
export const REVIEW_MODELS = { routine: "claude-sonnet-4-6", deep: "claude-opus-4-8" };

export const CODE_RESEARCH_TOOLS = {
  // match: regex over tool-call names, used by the session-close adherence count.
  tokensave: { name: "tokensave", url: "https://github.com/aovestdipaperino/tokensave", bypass: "TOKENSAVE_BYPASS:", match: "tokensave" },
  "lsp-plugins": { name: "Claude Code LSP plugins", url: "https://code.claude.com/docs/en/discover-plugins", bypass: null, match: "^LSP$" },
  codegraph: { name: "CodeGraph", url: "https://github.com/colbymchenry/codegraph", bypass: null, match: "codegraph" },
  serena: { name: "Serena", url: "https://github.com/oraios/serena", bypass: null, match: "serena" },
  "codebase-memory": { name: "codebase-memory-mcp", url: "https://github.com/DeusData/codebase-memory-mcp", bypass: null, match: "codebase.memory" },
  none: { name: "none", url: "(no homepage)", bypass: null, match: null },
};

export const PRECOMMIT_MANAGERS = ["lefthook", "husky", "pre-commit", "simple-git-hooks"];
export const MERGE_STYLES = ["squash", "merge", "rebase"];
export const ARCHITECTURES = ["none", "clean", "ddd", "ecs", "feature-based", "hexagonal", "layered", "mvc"];
export const LICENSES = { MIT: "MIT.txt", "Apache-2.0": "Apache-2.0.txt", "BSD-3-Clause": "BSD-3-Clause.txt", Proprietary: "Proprietary.txt" };

// Filled later by the tailoring step, which reads the user's repo.
export const DEFERRED = new Set([
  "ONE_LINE_DESCRIPTION", "LANGUAGE_AND_FRAMEWORK", "CONVERSATION_LANGUAGE", "CODE_LANGUAGE",
  "LINT_COMMAND", "TYPECHECK_COMMAND", "TEST_COMMAND", "STACK_COMMANDS_ALLOWLIST",
  "LEAD_USER", "TEAM_OR_USER",
]);

export function defaults({ team = false, client = false } = {}) {
  return {
    team, client,
    project: { name: "my-project", repoUrl: "", licenseHolder: "", license: client ? "Proprietary" : "MIT" },
    advanced: {
      aiReview: true,
      deepEscalation: team,
      precommit: team ? "lefthook" : "none",
      uiRule: false,
      confidentiality: client,
      cleanRoom: false,
      plainWriting: false,
      codeResearch: "none",
      branching: "gitflow",
      devIsDefault: false,
      mergeStyle: "squash",
      architecture: "none",
    },
  };
}

function check(cond, msg) {
  if (!cond) throw new Error(`Invalid answers: ${msg}`);
}

export function validate(a) {
  const adv = a.advanced;
  check(typeof a.team === "boolean" && typeof a.client === "boolean", "team and client must be true or false");
  check(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(a.project.name), "project name must be 1-64 letters, digits, dot, dash or underscore");
  check(a.project.license in LICENSES, `unknown license "${a.project.license}"`);
  check(adv.codeResearch in CODE_RESEARCH_TOOLS, `unknown code-research tool "${adv.codeResearch}"`);
  check(adv.precommit === "none" || PRECOMMIT_MANAGERS.includes(adv.precommit), `unknown pre-commit manager "${adv.precommit}"`);
  check(ARCHITECTURES.includes(adv.architecture), `unknown architecture "${adv.architecture}"`);
  check(["gitflow", "trunk"].includes(adv.branching), `unknown branching model "${adv.branching}"`);
  check(MERGE_STYLES.includes(adv.mergeStyle), `unknown merge style "${adv.mergeStyle}"`);
  check(typeof adv.devIsDefault === "boolean", "devIsDefault must be true or false");
  const python = a.environment?.python;
  check(python == null || (typeof python === "string" && python.length < 512 && /^(\/|[A-Za-z]:[\\/])/.test(python)
    && !/["\u0000-\u001f]/.test(python)), "environment.python must be an absolute interpreter path");
  return a;
}

// What setup found on the user's machine. The browser page cannot probe, so it
// leaves this out and machine-specific pieces (the push-guard hook) are skipped.
function pythonPath(a) {
  return a.environment?.python || null;
}

// Every toggle name the templates use must resolve here to true or false.
export function flagsFor(a) {
  const adv = a.advanced;
  const soloOwn = !a.team && !a.client;
  return {
    github_actions_routine_review: adv.aiReview,
    github_actions_deep_review: adv.aiReview,
    github_actions_deep_review_auto_fire: adv.aiReview && adv.deepEscalation,
    github_actions_paths_ignore_auto_merge: adv.aiReview && soloOwn,
    code_research_first: adv.codeResearch !== "none",
    precommit_hooks_scaffold: adv.precommit !== "none",
    branching_model_gitflow: adv.branching === "gitflow",
    branching_model_trunk: adv.branching === "trunk",
    default_branch_is_dev: adv.branching === "gitflow" && adv.devIsDefault,
    push_guard_hook: pythonPath(a) !== null,
    contributing_md: a.team,
    audit_trail_commits: a.client,
    definition_of_done_verification: true,
    context_refresh_files: true,
    lazy_rules_folder: true,
    memory_system: true,
  };
}

// Every value a template may name in a choice block. An unlisted value fails
// the render, so retired options cannot linger as dead blocks.
export const CHOICE_OPTIONS = {
  code_research: Object.keys(CODE_RESEARCH_TOOLS),
  precommit: ["none", ...PRECOMMIT_MANAGERS],
  merge_style: MERGE_STYLES,
};

export function choicesFor(a) {
  return { code_research: a.advanced.codeResearch, precommit: a.advanced.precommit, merge_style: a.advanced.mergeStyle };
}

function upperSnake(s) {
  return s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
}

export function valuesFor(a, { year = new Date().getFullYear() } = {}) {
  const tool = CODE_RESEARCH_TOOLS[a.advanced.codeResearch];
  const gitflow = a.advanced.branching === "gitflow";
  return {
    PROJECT_NAME: a.project.name,
    PROJECT_NAME_UPPER: upperSnake(a.project.name),
    REPO_URL: a.project.repoUrl || "(repository URL)",
    LICENSE_HOLDER: a.project.licenseHolder || a.project.name,
    YEAR: year,
    MAIN_BRANCH: "main",
    DEV_BRANCH: gitflow ? "develop" : "main",
    DEFAULT_BRANCH: gitflow && a.advanced.devIsDefault ? "develop" : "main",
    GITFLOW_OR_TRUNK: gitflow ? "gitflow" : "trunk",
    REVIEW_ROUTINE_MODEL: REVIEW_MODELS.routine,
    REVIEW_DEEP_MODEL: REVIEW_MODELS.deep,
    TOOLS_CODE_RESEARCH_NAME: tool.name,
    TOOLS_CODE_RESEARCH_URL: tool.url,
    TOOLS_CODE_RESEARCH_NAME_KEBAB: a.advanced.codeResearch,
    TOOLS_CODE_RESEARCH_NAME_UPPER_SNAKE: upperSnake(a.advanced.codeResearch),
    TOOLS_CODE_RESEARCH_BYPASS_MARKER: tool.bypass || "RESEARCH_BYPASS:",
    TOOLS_CODE_RESEARCH_MATCH: tool.match || "(?!)",
    // Written inside a JSON string, so escape it as one.
    PYTHON_EXE: pythonPath(a) ? JSON.stringify(pythonPath(a)).slice(1, -1) : "",
  };
}
