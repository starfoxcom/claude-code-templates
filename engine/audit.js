// What /bindwright:audit measures: how the repo's rules held up in its recent
// Claude Code sessions, counted from the logs the CLI keeps under
// <config>/projects/. Each check runs only when the repo has the rule it
// measures, and reports how often the rule applied (`seen`), how often it was
// broken (`broken`) and up to three examples from the newest sessions. Shell
// searches and anything else a log cannot show plainly are left out. Read
// only. Node only; audit.py is the Python twin.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { ANSWERS } from "./bind.js";
import { runSettings } from "./layers.js";
import { researchTool } from "./model.js";

export const SESSIONS = 50; // the newest main transcripts read
const EXAMPLES = 3;
const CUT = 100; // code points of an example's text
const EDIT_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
const TASK_TOOLS = ["TaskCreate", "TodoWrite"];
const EDITS_FOR_TASKS = 3;

// Patterns spell out ASCII classes, so both engines match the same text. A
// command counts only where it starts a line or follows ; & | or (, so a
// search or a message that merely names it does not.
const COMMIT = /(?:^|[\n;&|(][ \t]*)git[ \t]+(?:-C[ \t]+[^ \t\r\n]+[ \t]+)?commit(?![A-Za-z0-9_-])/;
const MESSAGE = /[ \t](?:-[A-Za-z]*m|--message)(?:[ \t]+|=)(["'])/;
const FORMAT = /^(feat|fix|refactor|perf|test|docs|chore|data|style)(\([^() \t]+\))?!?: [^ \t]/;
const WRITES = new RegExp(String.raw`(?:^|[\n;&|(][ \t]*)(?:git[ \t]+(?:-C[ \t]+[^ \t\r\n]+[ \t]+)?commit`
  + String.raw`|gh[ \t]+(?:pr|issue)[ \t]+(?:create|edit|comment))(?![A-Za-z0-9_-])`);
const ATTRIBUTION_BLOCK = "BLOCKED (no AI attribution)";
const CI = /(?:^|[\n;&|(][ \t]*)gh[ \t]+(?:run[ \t]+(?:watch|list|view)|pr[ \t]+checks)(?![A-Za-z0-9_-])/;
const RUN_WATCH = /(?:^|[\n;&|(][ \t]*)gh[ \t]+run[ \t]+watch(?![A-Za-z0-9_-])/;
const NON_CODE = /\.(md|mdx|txt|log|json|jsonl|ya?ml|csv)(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(md|json|yaml|txt)$/i;

const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const text = (x) => (typeof x === "string" ? x : "");
const byUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const cut = (s) => [...s.split("\n")[0].replace(/\r$/, "")].slice(0, CUT).join("");

// The CLI names a project's log folder after its path, each character other
// than an ASCII letter or digit turned into "-", and cuts names past 200
// characters (adding a hash), so a long one is found by its first 200.
export function logFolder(root, config) {
  let names;
  try {
    names = readdirSync(join(config, "projects")).sort(byUnits);
  } catch {
    return null;
  }
  const want = resolve(root).replace(/[^A-Za-z0-9]/g, "-").toLowerCase();
  const exact = names.find((n) => n.toLowerCase() === want);
  if (exact !== undefined || want.length <= 200) return exact ?? null;
  return names.find((n) => n.toLowerCase().startsWith(`${want.slice(0, 200)}-`)) ?? null;
}

// The newest SESSIONS main transcripts, newest first, each with its subagents' logs.
function sessions(dir) {
  const mains = readdirSync(dir).filter((n) => n.endsWith(".jsonl"))
    .map((n) => ({ n, t: statSync(join(dir, n), { bigint: true }).mtimeNs }))
    .sort((a, b) => (a.t === b.t ? byUnits(a.n, b.n) : a.t > b.t ? -1 : 1))
    .slice(0, SESSIONS);
  return mains.map(({ n }) => {
    const id = n.slice(0, -".jsonl".length);
    const sub = join(dir, id, "subagents");
    let agents = [];
    try {
      agents = readdirSync(sub).filter((x) => x.endsWith(".jsonl")).sort(byUnits).map((x) => join(sub, x));
    } catch {
      // no subagents
    }
    return { id, files: [join(dir, n), ...agents] };
  });
}

function entries(file) {
  const out = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    try {
      const entry = JSON.parse(line);
      if (isObject(entry) && isObject(entry.message) && Array.isArray(entry.message.content)) out.push(entry);
    } catch {
      // not a log entry
    }
  }
  return out;
}

const STAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}/;
const stamp = (t) => (STAMP.test(text(t)) ? `${t.slice(0, 10)} ${t.slice(11, 16)}` : "");

function resultText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((c) => isObject(c) && c.type === "text").map((c) => text(c.text)).join("\n");
}

// A session's tool calls in log order, each counted once across all sessions
// (a resumed or forked session copies earlier calls), with its result's text.
function toolCalls(files, counted) {
  const calls = [];
  const results = new Map();
  for (const entry of files.flatMap(entries)) {
    for (const item of entry.message.content.filter(isObject)) {
      if (item.type === "tool_use" && typeof item.id === "string" && !counted.has(item.id)) {
        counted.add(item.id);
        const input = isObject(item.input) ? item.input : {};
        calls.push({ id: item.id, name: text(item.name), input, when: stamp(entry.timestamp) });
      } else if (item.type === "tool_result" && typeof item.tool_use_id === "string") {
        results.set(item.tool_use_id, resultText(item.content));
      }
    }
  }
  return calls.map((c) => ({ ...c, result: results.get(c.id) ?? "" }));
}

// The text between the quote at `start - 1` and its closing quote.
function quoted(s, start, q) {
  let out = "";
  for (let i = start; i < s.length; i++) {
    if (s[i] === q) return out;
    if (s[i] === "\\" && q === '"' && i + 1 < s.length) i++;
    out += s[i];
  }
  return null;
}

// The command with ; & | ( and line breaks inside quotes blanked, so a quoted
// search pattern or message cannot start a command. Lengths stay the same.
function unquote(command) {
  let out = "";
  let quote = null;
  for (const ch of command) {
    if (quote === null && (ch === "'" || ch === '"')) quote = ch;
    else if (ch === quote) quote = null;
    else if (quote !== null && "|;&\n(".includes(ch)) {
      out += " ";
      continue;
    }
    out += ch;
  }
  return out;
}

// The first line of the message a `git commit -m` command gives, or null.
export function commitMessage(command) {
  const at = unquote(command).search(COMMIT);
  if (at === -1) return null;
  const m = MESSAGE.exec(command.slice(at));
  if (m === null) return null;
  const message = quoted(command, at + m.index + m[0].length, m[1]);
  if (message === null) return null;
  const lines = message.split("\n");
  // A heredoc message, `-m "$(cat <<'EOF'`, starts on the next line.
  return (message.startsWith("$(cat <<") ? lines[1] ?? "" : lines[0]).replace(/\r$/, "");
}

const goodCommit = (m) => m.startsWith("Merge ") || (FORMAT.test(m) && [...m].length <= 72);
// The CLI reports a hook's refusal on the result's first line ("PreToolUse:Bash hook error: BLOCKED ...").
const guardBlocked = (result) => {
  const first = result.split("\n")[0];
  return first.includes("hook") && first.includes(ATTRIBUTION_BLOCK);
};
const shell = (call) => (call.name === "Bash" || call.name === "PowerShell" ? text(call.input.command) : "");

// Per call: null when the rule does not apply, else whether it broke and what to show.
const PER_CALL = {
  "commit-format": (call) => {
    const m = commitMessage(shell(call));
    return m === null ? null : { broke: !goodCommit(m), shown: m };
  },
  attribution: (call) => {
    const command = shell(call);
    return WRITES.test(unquote(command)) ? { broke: guardBlocked(call.result), shown: command } : null;
  },
  "ci-watch": (call) => {
    const plain = unquote(shell(call));
    return CI.test(plain) ? { broke: RUN_WATCH.test(plain), shown: shell(call) } : null;
  },
  "code-research": (call, tool) => {
    if (tool.test(call.name)) return { broke: false, shown: call.name };
    if (call.name !== "Grep" && call.name !== "Glob") return null;
    const keys = call.name === "Glob" ? ["pattern", "path"] : ["path", "glob", "type"];
    if (NON_CODE.test(keys.map((k) => text(call.input[k])).join(" "))) return null;
    return { broke: true, shown: `${call.name} ${text(call.input.pattern)}` };
  },
};

function count(tally, broke, example) {
  tally.seen += 1;
  if (!broke) return;
  tally.broken += 1;
  if (tally.examples.length < EXAMPLES) tally.examples.push({ ...example, text: cut(example.text) });
}

// The pattern for the repo's code-research tool calls, or null when it has none.
function researchPattern(root, config) {
  const value = runSettings(root, config).settings.codeResearch?.value;
  if (value === undefined || value === "none") return null;
  let custom;
  if (value === "custom") {
    // Only the project layer can pick "custom", and runSettings has read that file already.
    const answers = JSON.parse(readFileSync(join(root, ...ANSWERS.split("/")), "utf8"));
    custom = isObject(answers.advanced) ? answers.advanced.codeResearchCustom : undefined;
    if (!(isObject(custom) && typeof custom.name === "string" && typeof custom.url === "string")) return null;
  }
  return new RegExp(researchTool({ codeResearch: value, codeResearchCustom: custom }).match);
}

// Which checks apply to the repo at `root`, as [id, rule file, why skipped or null].
function applicable(root, research) {
  const has = (p) => statSync(join(root, ...p.split("/")), { throwIfNoEntry: false })?.isFile() === true;
  const rules = [
    ["commit-format", ".claude/rules/git.md"], ["attribution", ".claude/rules/git.md"],
    ["code-research", ".claude/skills/find/SKILL.md"], ["task-tracking", ".claude/rules/task-tracking.md"],
    ["ci-watch", ".claude/rules/token-efficiency.md"],
  ];
  return rules.map(([id, rule]) => {
    if (!has(rule)) return [id, rule, `${rule} is missing`];
    if (id === "code-research" && research === null) return [id, rule, "no code-research tool is chosen"];
    return [id, rule, null];
  });
}

export function runAudit(root, config) {
  const research = researchPattern(root, config);
  const checks = applicable(root, research);
  const skipped = checks.filter((c) => c[2] !== null).map(([id, , why]) => ({ id, why }));
  const tallies = Object.fromEntries(checks.filter((c) => c[2] === null)
    .map(([id, rule]) => [id, { id, rule, seen: 0, broken: 0, examples: [] }]));
  const folder = logFolder(root, config);
  const list = folder === null ? [] : sessions(join(config, "projects", folder));
  const counted = new Set();
  const days = [];
  for (const { id, files } of list) {
    const calls = toolCalls(files, counted);
    days.push(...calls.map((c) => c.when.slice(0, 10)).filter(Boolean));
    tallySession(id.slice(0, 8), calls, tallies, research);
  }
  days.sort(byUnits);
  const logs = { folder, sessions: list.length, from: days[0] ?? null, to: days.at(-1) ?? null };
  return { logs, checks: Object.values(tallies), skipped };
}

function tallySession(session, calls, tallies, research) {
  for (const call of calls) {
    for (const [id, check] of Object.entries(PER_CALL)) {
      const hit = tallies[id] ? check(call, research) : null;
      if (hit !== null) count(tallies[id], hit.broke, { session, when: call.when, text: hit.shown });
    }
  }
  const edits = calls.filter((c) => EDIT_TOOLS.includes(c.name));
  if (tallies["task-tracking"] && edits.length >= EDITS_FOR_TASKS) {
    const tracked = calls.some((c) => TASK_TOOLS.includes(c.name));
    const example = { session, when: edits[0].when, text: `${edits.length} edits, no task list` };
    count(tallies["task-tracking"], !tracked, example);
  }
}
