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
// and JSON-escaped; longest first. Each is matched in any letter case, since
// Windows and macOS paths are, and tools print them in either.
function spellings(path) {
  // A bare root (/, C:\, \\) would replace every slash in the text.
  if (!path || !path.replace(/^[A-Za-z]:/, "").replace(/[\\/]/g, "")) return [];
  const forward = path.split("\\").join("/");
  const back = path.split("/").join("\\");
  const all = [path, forward, back, back.split("\\").join("\\\\")];
  // A drive path as Git Bash and WSL print it: C:\x is /c/x and /mnt/c/x.
  const drive = /^([A-Za-z]):\//.exec(forward);
  if (drive) all.push(`/${drive[1]}/${forward.slice(3)}`, `/mnt/${drive[1]}/${forward.slice(3)}`);
  const unique = [...new Set(all)];
  return unique.sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// `s` as a pattern that matches it in any letter case. Built by hand, not
// with a case-blind flag, so both engines agree: JS and Python fold letters
// such as the Turkish dotted I differently. The four I's all match each
// other, since hiding too much is the safe side. Any other letter whose other
// case is more than one character (ß) matches only as written.
const EYES = "Iiİı";
function anyCase(s) {
  return [...s].map((c) => {
    if (EYES.includes(c)) return `[${EYES}]`;
    const forms = [...new Set([c, c.toLowerCase(), c.toUpperCase()])].filter((f) => [...f].length === 1);
    return forms.length > 1 ? `[${forms.sort().join("")}]` : escape(c);
  }).join("");
}

// `text` without the repo and home paths, emails, the user name, or tokens.
// Paths go first: a token pattern could swallow part of one and hide the rest
// from the path pass. Tokens go last; no placeholder holds a character they match.
export function scrub(text, { repo, home, user }) {
  let out = String(text);
  for (const [path, mark] of [[repo, "<repo>"], [home, "~"]]) {
    for (const spelled of spellings(path)) out = out.replace(new RegExp(anyCase(spelled), "gu"), () => mark);
  }
  out = out.replace(EMAIL, "<email>");
  if (user && user.length >= 3) {
    out = out.replace(new RegExp(`${EDGE}${anyCase(user)}(?![A-Za-z0-9_])`, "gu"), () => "<user>");
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
  // Scrubbed before the cut, so a cut cannot leave part of a path or token unmatched.
  const title = cut(scrub(`bug: ${what.title ?? (what.error ?? "report").split("\n")[0]}`, who), 100);
  const url = `${ISSUES}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(cut(body, 6000))}`;
  return { title, body, url };
}
