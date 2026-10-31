// The setup's files as a few plain groups, for people who will never open
// them: what each group does for the project, not what the files are called.

const GROUPS = [
  {
    id: "rules", title: "Rules Claude follows", match: /^\.claude\/rules\//,
    say: "Claude reads these at the start of every session, so it works your way without being told again.",
  },
  {
    id: "reviews", title: "Pull request reviews",
    match: new RegExp("^\\.github/(workflows/(claude|pin-check)|review-|CODEOWNERS|PULL_REQUEST"
      + "|scripts/(review_gate|setup-review-gate|pin_check))"),
    say: "An AI reviews every pull request, and nothing merges until the review passes.",
  },
  {
    id: "guards", title: "Safety guards", match: /^\.claude\/(hooks\/|settings)/,
    say: "Risky commands, like a force push to your main branch, are stopped before they run.",
  },
  {
    id: "sessions", title: "Session routines", match: /^(\.claude\/skills\/|\.bindwright\/session-steps)/,
    say: "/session-start plans the work with you. /session-close checks what is really done "
      + "and leaves a note for next time.",
  },
  {
    id: "checks", title: "Code checks",
    match: /^(lefthook\.yml|\.husky\/|\.pre-commit|\.github\/(workflows\/size-check|scripts\/size_check|size-check\/))/,
    say: "Checks that run before each commit or on every pull request.",
  },
  {
    id: "issues", title: "Issue forms", match: /^\.github\/ISSUE_TEMPLATE\//,
    say: "Ready-made forms for bug reports, feature requests and planned work.",
  },
  {
    id: "project", title: "Project files",
    match: /^(CLAUDE\.md|README|LICENSE|CHANGELOG|CONTRIBUTING|\.gitattributes|docs\/)/,
    say: "The main file Claude reads about your project, plus a readme, license and changelog. "
      + "Setup merges them with yours.",
  },
  { id: "notes", title: "Bindwright's notes", match: /^\.bindwright\//,
    say: "Your answers, so a later update keeps your own edits." },
];

// One plain line per rule file, by name.
const RULES = {
  "architecture": ["Your code structure", "New code goes into the layers of the structure you picked."],
  "clean-room": ["Clean room", "Code inspired by another product never copies it."],
  "code-size": ["Small, readable code", "Functions and files stay short enough to follow."],
  "collaboration": ["Working together", "How teammates share branches and answer reviews."],
  "confidentiality": ["Client secrets", "Client secrets stay out of Claude's memory."],
  "git": ["Clean history", "Clear commit messages and one branch per change."],
  "review-tiers": ["How reviews work", "What the AI reviewer checks, and when it looks deeper."],
  "shipped-text": ["Plain writing", "Text people read sounds like a person wrote it."],
  "task-tracking": ["A visible to-do list", "Claude keeps a task list on any job with several steps."],
  "testing": ["Real tests", "Tests check the real code, edge cases included."],
  "token-efficiency": ["Less wasted usage", "Claude looks code up before reading whole files."],
  "tracker": ["Work tracking", "Work is written down between sessions, so nothing gets lost."],
  "visual": ["Screen changes in small steps", "Anything people see is built in pieces you check by eye."],
};

// What an answer change did to the summary: groups and rules that came or went.
export function compare(before, after) {
  const ids = (list) => new Set(list.map((g) => g.id));
  const ruleNames = (list) => new Set((list.find((g) => g.id === "rules")?.rules ?? []).map(([name]) => name));
  const [was, now] = [ids(before), ids(after)];
  const [hadRules, hasRules] = [ruleNames(before), ruleNames(after)];
  return {
    addedGroups: new Set([...now].filter((id) => !was.has(id))),
    removedGroups: before.filter((g) => !now.has(g.id)),
    addedRules: new Set([...hasRules].filter((name) => !hadRules.has(name))),
    removedRules: [...hadRules].filter((name) => !hasRules.has(name)),
  };
}

// "Code checks and the Working together rule", for the change note.
export function describe(groups, rules) {
  const parts = [...groups, ...rules.map((name) => `the ${name} rule`)];
  if (parts.length < 2) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

// [{ id, title, say, files, rules? }] for the groups that have files, in GROUPS order.
export function summarize(files) {
  const groups = GROUPS.map((g) => ({ ...g, files: [] }));
  const other = { id: "other", title: "Other files", say: "Supporting files the rest relies on.", files: [] };
  for (const [path] of files) (groups.find((g) => g.match.test(path)) ?? other).files.push(path);
  const rules = groups.find((g) => g.id === "rules");
  rules.rules = rules.files.map((p) => p.split("/").pop().replace(/\.md$/, ""))
    .map((name) => RULES[name] ?? [name, ""]);
  return [...groups, other].filter((g) => g.files.length);
}
