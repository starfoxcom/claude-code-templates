// The answer model: two questions, a few advanced choices, and everything
// derived from them. This is the single source for what a bind produces.

// The pins this repo's own review workflows run on. The routine and deep
// models must be ones the pinned claude-code-action accepts; the backup runs
// on the CLI_VERSION the workflow templates install, so it must be one that
// version accepts. Change them together with those pins, never on their own.
export const REVIEW_MODELS = { routine: "claude-fable-5-1", deep: "claude-fable-5-1", backup: "claude-opus-5-5" };
export const REVIEW_EFFORTS = { routine: "low", deep: "low", backup: "high" };

export const CODE_RESEARCH_TOOLS = {
  // match: regex over tool-call names, used by the session-close adherence count.
  tokensave: { name: "tokensave", url: "https://github.com/aovestdipaperino/tokensave", bypass: "TOKENSAVE_BYPASS:", match: "tokensave" },
  "lsp-plugins": { name: "Claude Code LSP plugins", url: "https://code.claude.com/docs/en/discover-plugins", bypass: null, match: "^LSP$" },
  codegraph: { name: "CodeGraph", url: "https://github.com/colbymchenry/codegraph", bypass: null, match: "codegraph" },
  serena: { name: "Serena", url: "https://github.com/oraios/serena", bypass: null, match: "serena" },
  "codebase-memory": { name: "codebase-memory-mcp", url: "https://github.com/DeusData/codebase-memory-mcp", bypass: null, match: "codebase.memory" },
  none: { name: "none", url: "(no homepage)", bypass: null, match: null },
  // A tool the person names: valuesFor fills all four from codeResearchCustom.
  custom: { name: null, url: null, bypass: null, match: null },
};
// How setup installs each tool lives in _core/global-template/hooks/code-research-profiles.json.

// The custom tool's name lands in Markdown, a Python string and a regex; its
// URL in Markdown and a hook comment. Both are plain ASCII, so the two twins
// count the same length; quotes, backslashes, spaces and control characters
// in the URL are refused rather than escaped.
const CUSTOM_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9 ._+-]{0,38}[A-Za-z0-9._+-])?$/;
const CUSTOM_URL = /^https:\/\/[^\x00-\x20\x7f-￿"'`<>\\]{1,200}$/;

export const PRECOMMIT_MANAGERS = ["lefthook", "husky", "pre-commit", "simple-git-hooks"];
// Merge commits by default: every branch stays visible in the history graph.
export const MERGE_STYLES = ["merge", "squash", "rebase"];
export const ARCHITECTURES = ["none", "clean", "ddd", "ecs", "feature-based", "hexagonal", "layered", "mvc"];
// Where the guard hooks live: shipped in the repo (teammates and cloud
// sessions get them), or only in each person's ~/.claude (global-template).
export const HOOK_LOCATIONS = ["repo", "home"];
// How much the committed deny list blocks. "standard" stops force pushes,
// direct pushes to the protected branches, interactive rebase and admin
// merges; "strict" also stops local history wipes and destructive gh calls.
export const DENY_PROFILES = ["standard", "strict"];
// Where the work state lives between sessions: GitHub issues (with a Projects
// board when trackerProject names one), or the repo's hand-off file and
// ROADMAP.md.
export const TRACKERS = ["github", "file"];
// "<owner>/<number>" of a GitHub Projects board. The owner lands in gh
// command lines, so it is held to GitHub's own name rule.
const TRACKER_PROJECT = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[1-9][0-9]{0,5}$/;
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
      // { name, url } when codeResearch is "custom"; null otherwise.
      codeResearchCustom: null,
      branching: "gitflow",
      devIsDefault: false,
      mergeStyle: "merge",
      architecture: "none",
      hookLocation: "repo",
      attributionGuard: true,
      denyProfile: "standard",
      // Files the writing rule checks. null keeps the rule's own list.
      shippedTextPaths: null,
      // Add-on: a CI check that fails on any new code-size breach.
      codeSizeCheck: false,
      tracker: "github",
      // "<owner>/<number>" when tracker is "github" and the project has a
      // board; null keeps project status in a pinned issue instead.
      trackerProject: null,
      // With the github tracker: a short, git-ignored hand-off file that
      // points at the issues the last session worked on.
      handoffFile: true,
    },
  };
}

function check(cond, msg) {
  if (!cond) throw new Error(`Invalid answers: ${msg}`);
}

// Own keys only, so "toString" is not a license. The Python twin
// (model.py) has no prototype chain; this keeps the two in step.
const own = (obj, key) => typeof key === "string" && Object.prototype.hasOwnProperty.call(obj, key);

const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

export function validate(a) {
  // Setup codes carry answers from outside the page, so the shape comes first.
  check(isObject(a) && isObject(a.project) && isObject(a.advanced), "the answers must hold project and advanced objects");
  const adv = a.advanced;
  check(typeof a.team === "boolean" && typeof a.client === "boolean", "team and client must be true or false");
  const switches = ["aiReview", "deepEscalation", "uiRule", "confidentiality", "cleanRoom", "plainWriting", "codeSizeCheck", "handoffFile"];
  for (const key of switches) {
    check(typeof adv[key] === "boolean", `${key} must be true or false`);
  }
  check(typeof a.project.name === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(a.project.name), "project name must be 1-64 letters, digits, dot, dash or underscore");
  check(typeof a.project.repoUrl === "string" && typeof a.project.licenseHolder === "string", "repoUrl and licenseHolder must be text");
  check(own(LICENSES, a.project.license), `unknown license "${a.project.license}"`);
  check(own(CODE_RESEARCH_TOOLS, adv.codeResearch), `unknown code-research tool "${adv.codeResearch}"`);
  const custom = adv.codeResearchCustom;
  if (adv.codeResearch === "custom") {
    check(custom !== null && typeof custom === "object" && !Array.isArray(custom) &&
      typeof custom.name === "string" && CUSTOM_NAME.test(custom.name) && custom.name.replace(/[^A-Za-z0-9]/g, "").length >= 3 &&
      typeof custom.url === "string" && CUSTOM_URL.test(custom.url),
    "codeResearchCustom needs a name (up to 40 letters, digits, spaces, dot, plus, dash or underscore, with at least three letters or digits, starting with a letter or digit, not ending in a space) and an https:// url of plain ASCII without spaces or quotes");
  } else {
    check(custom === null || custom === undefined, 'codeResearchCustom is only for codeResearch "custom"');
  }
  check(adv.precommit === "none" || PRECOMMIT_MANAGERS.includes(adv.precommit), `unknown pre-commit manager "${adv.precommit}"`);
  check(ARCHITECTURES.includes(adv.architecture), `unknown architecture "${adv.architecture}"`);
  check(["gitflow", "trunk"].includes(adv.branching), `unknown branching model "${adv.branching}"`);
  check(MERGE_STYLES.includes(adv.mergeStyle), `unknown merge style "${adv.mergeStyle}"`);
  check(typeof adv.devIsDefault === "boolean", "devIsDefault must be true or false");
  check(HOOK_LOCATIONS.includes(adv.hookLocation), `unknown hook location "${adv.hookLocation}"`);
  check(typeof adv.attributionGuard === "boolean", "attributionGuard must be true or false");
  check(DENY_PROFILES.includes(adv.denyProfile), `unknown deny profile "${adv.denyProfile}"`);
  // Each glob lands in a double-quoted YAML string, so quotes, backslashes
  // and control characters are refused rather than escaped.
  check(adv.shippedTextPaths === null || (Array.isArray(adv.shippedTextPaths) && adv.shippedTextPaths.length > 0 &&
    adv.shippedTextPaths.every((g) => typeof g === "string" && /^[^"\\\x00-\x1f\x7f]{1,200}$/.test(g) && g.trim() === g)),
  "shippedTextPaths must be null or a non-empty list of globs without quotes, backslashes, line breaks or outer spaces");
  check(TRACKERS.includes(adv.tracker), `unknown tracker "${adv.tracker}"`);
  if (adv.tracker === "github") {
    check(adv.trackerProject === null || (typeof adv.trackerProject === "string" && TRACKER_PROJECT.test(adv.trackerProject)),
      'trackerProject must be null or "<owner>/<number>": a GitHub user or organization name and the board\'s number');
  } else {
    check(adv.trackerProject === null || adv.trackerProject === undefined, 'trackerProject is only for tracker "github"');
  }
  return a;
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
    guard_hooks_repo: adv.hookLocation === "repo",
    attribution_guard: adv.attributionGuard,
    deny_list_strict: adv.denyProfile === "strict",
    code_size_check: adv.codeSizeCheck,
    handoff_file: adv.tracker === "github" && adv.handoffFile,
    contributing_md: a.team,
    audit_trail_commits: a.client,
    definition_of_done_verification: true,
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
  tracker: TRACKERS,
};

export function choicesFor(a) {
  const adv = a.advanced;
  return { code_research: adv.codeResearch, precommit: adv.precommit, merge_style: adv.mergeStyle, tracker: adv.tracker };
}

function upperSnake(s) {
  return s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
}

// The custom tool's four fields, derived from the name the person gave. The
// adherence pattern matches only MCP tool calls (mcp__<server>__<tool>), so a
// name like "Grep" never counts the built-in tools, and lets each dash in the
// name also match an underscore or nothing, as servers spell names either way.
function customTool({ name, url }) {
  const kebab = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return { name, url, kebab, bypass: `${upperSnake(name)}_BYPASS:`, match: `^mcp__.*${kebab.split("-").join("[-_]?")}` };
}

function researchTool(adv) {
  if (adv.codeResearch === "custom") return customTool(adv.codeResearchCustom);
  return { ...CODE_RESEARCH_TOOLS[adv.codeResearch], kebab: adv.codeResearch };
}

export function valuesFor(a, { year = new Date().getFullYear() } = {}) {
  const tool = researchTool(a.advanced);
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
    REVIEW_BACKUP_MODEL: REVIEW_MODELS.backup,
    REVIEW_ROUTINE_EFFORT: REVIEW_EFFORTS.routine,
    REVIEW_DEEP_EFFORT: REVIEW_EFFORTS.deep,
    REVIEW_BACKUP_EFFORT: REVIEW_EFFORTS.backup,
    TOOLS_CODE_RESEARCH_NAME: tool.name,
    TOOLS_CODE_RESEARCH_URL: tool.url,
    TOOLS_CODE_RESEARCH_NAME_KEBAB: tool.kebab,
    TOOLS_CODE_RESEARCH_NAME_UPPER_SNAKE: upperSnake(tool.kebab),
    TOOLS_CODE_RESEARCH_BYPASS_MARKER: tool.bypass || "RESEARCH_BYPASS:",
    TOOLS_CODE_RESEARCH_MATCH: tool.match || "(?!)",
  };
}
