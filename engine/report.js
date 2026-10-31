// /bindwright:report's engine step: a bug report about Bindwright, drafted
// from the doctor's findings and what failed, with personal data taken out
// before anyone sees it. Nothing is sent from here: the skill shows the draft
// and files it only on a yes. Node only; report.py is the Python twin.

import { runDoctor } from "./doctor.js";

export const ISSUES = "https://github.com/starfoxcom/claude-code-templates/issues/new";

// Secrets, and the places and names that identify the person. Word edges are
// spelled out in ASCII, which both engines read alike.
const EDGE = "(?<![A-Za-z0-9_])";
const TOKENS = [
  new RegExp(`${EDGE}(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})`, "g"),
  new RegExp(`${EDGE}sk-[A-Za-z0-9_-]{20,}`, "g"),
  new RegExp(`${EDGE}(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9_])`, "g"),
  new RegExp(`${EDGE}[A-Za-z0-9+/_-]{40,}={0,2}`, "g"),
];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Every spelling of a path the text may carry: as given, with either slash,
// JSON-escaped, and each in lower case; longest first.
function spellings(path) {
  if (!path) return [];
  const forward = path.split("\\").join("/");
  const back = path.split("/").join("\\");
  const all = [path, forward, back, back.split("\\").join("\\\\")];
  const unique = [...new Set([...all, ...all.map((s) => s.toLowerCase())])];
  return unique.sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// `text` without the repo and home paths, emails, the user name, or tokens.
// Paths go first: a token pattern could swallow part of one and hide the rest
// from the path pass. Tokens go last; no placeholder holds a character they match.
export function scrub(text, { repo, home, user }) {
  let out = String(text);
  for (const [path, mark] of [[repo, "<repo>"], [home, "~"]]) {
    for (const spelled of spellings(path)) out = out.split(spelled).join(mark);
  }
  out = out.replace(EMAIL, "<email>");
  if (user && user.length >= 3) {
    out = out.replace(new RegExp(`${EDGE}${escape(user)}(?![A-Za-z0-9_])`, "g"), "<user>");
  }
  for (const pattern of TOKENS) out = out.replace(pattern, "<token>");
  return out;
}

// Cut by whole characters, as Python counts them.
const cut = (s, n) => Array.from(s).slice(0, n).join("");

// The draft: { title, body, url }, where `url` opens GitHub's new-issue page
// with both filled in, for a machine without `gh`. `what` is
// { title, command, error, expected } from the skill; `facts` the versions;
// `who` the repo and home paths and the user name to take out.
export function draftReport(root, config, what, facts, who) {
  const doctor = runDoctor(root, config, facts);
  const found = doctor.checks.filter((c) => !c.ok).map((c) => `- ${c.say} (${c.id})`);
  const happened = what.error
    ? `\`${what.command ?? "?"}\` failed:\n\n\`\`\`\n${what.error}\n\`\`\``
    : (what.command ?? "(not given)");
  const lines = [
    "## What happened", happened, "",
    "## What I expected", what.expected ?? "(not given)", "",
    "## Doctor", found.length ? found.join("\n") : "No problems found.", "",
    "## Versions",
    `- Bindwright: ${facts.pluginVersion}`,
    `- CLI: ${facts.cliVersion ? facts.cliVersion.join(".") : "unknown"}`,
    `- OS: ${facts.os}`,
    `- Engine: ${facts.engine}`,
  ];
  const body = scrub(lines.join("\n"), who);
  const title = scrub(cut(`bug: ${what.title ?? (what.error ?? "report").split("\n")[0]}`, 100), who);
  const url = `${ISSUES}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(cut(body, 6000))}`;
  return { title, body, url };
}
