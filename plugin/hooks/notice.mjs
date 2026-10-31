// Bindwright's SessionStart notice. At most once a day per repo it says when
// the repo's Bindwright files are older than the plugin (/bindwright:update
// brings them up) or a newer plugin is out. It asks the network at most once
// a day, with a short timeout, and says nothing when offline, when nothing is
// behind, or on any error. Node 18+; the hook skips it where Node is missing.

import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The released version: main moves only on a release, and the plugin packs this file.
export const LATEST_URL = "https://raw.githubusercontent.com/starfoxcom/claude-code-templates/main/VERSION";
const PRISTINE = join(".bindwright", "pristine.json");

// "v1.4.0" or "1.4.0" as [1, 4, 0], or null for anything else.
function parse(version) {
  const m = /^v*(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  return m ? m.slice(1).map(Number) : null;
}

// The version as plain "x.y.z", or null: only this form reaches the text.
const clean = (version) => parse(version)?.join(".") ?? null;

// True when version `a` comes before `b`; false when either is unreadable.
export function older(a, b) {
  const [x, y] = [parse(a), parse(b)];
  if (!x || !y) return false;
  const i = x.findIndex((n, k) => n !== y[k]);
  return i !== -1 && x[i] < y[i];
}

// The set-up repo holding `cwd`, or null. The search stops at a git root.
export function findRepo(cwd) {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, PRISTINE))) return dir;
    if (existsSync(join(dir, ".git")) || dirname(dir) === dir) return null;
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// Today's entries only, which also clears a damaged cache.
const todays = (shown, today) => Object.entries(shown ?? {}).filter(([, day]) => day === today);

// Writes the cache, keeping today's entries another session saved meanwhile,
// through a temporary file so no reader sees it half written.
function save(cacheFile, cache, today) {
  for (const [key, day] of todays(readJson(cacheFile)?.shown, today)) cache.shown[key] ??= day;
  mkdirSync(dirname(cacheFile), { recursive: true });
  const temp = `${cacheFile}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(cache)}\n`);
  renameSync(temp, cacheFile);
}

// The notice text, or null. `fetchLatest()` gives the released version or
// null; `cacheFile` remembers the day of the last check, what it found, and
// the day each repo last saw a notice.
export async function notice({ cwd, today, cacheFile, pluginVersion, fetchLatest }) {
  const cache = { checked: null, latest: null, ...readJson(cacheFile) };
  cache.shown = Object.fromEntries(todays(cache.shown, today));
  const repo = findRepo(cwd);
  const key = repo ?? "";
  if (cache.shown[key] === today) return null;
  let dirty = false;
  if (cache.checked !== today) {
    cache.checked = today;
    // Offline keeps what the last check found.
    cache.latest = (await fetchLatest().catch(() => null)) ?? cache.latest;
    dirty = true;
  }
  const lines = [];
  const latest = clean(cache.latest);
  if (older(pluginVersion, latest)) {
    lines.push(`Bindwright ${latest} is out; this machine has ${pluginVersion}. Update the plugin with /plugin.`);
  }
  const repoVersion = repo && clean(readJson(join(repo, PRISTINE))?.version);
  if (older(repoVersion, pluginVersion)) {
    lines.push(`This repo's Bindwright files come from ${repoVersion} and the plugin is ${pluginVersion}: `
      + "/bindwright:update brings them up to date and keeps the repo's own edits.");
  }
  if (lines.length) {
    cache.shown[key] = today;
    dirty = true;
  }
  if (dirty) save(cacheFile, cache, today);
  return lines.length ? lines.join("\n") : null;
}

// The released version at `url`, or null; gives up after two seconds.
export async function fetchVersion(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
  if (!res.ok) return null;
  const text = (await res.text()).trim();
  return parse(text) ? text.replace(/^v+/, "") : null;
}

async function main() {
  const input = readJson(0) ?? {};
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const pluginVersion = existsSync(join(root, "VERSION")) ? readFileSync(join(root, "VERSION"), "utf8").trim() : null;
  if (!parse(pluginVersion)) return;
  const config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const url = process.env.BINDWRIGHT_LATEST_URL || LATEST_URL;
  const text = await notice({
    cwd: input.cwd || process.cwd(),
    today: new Date().toLocaleDateString("en-CA"),
    cacheFile: join(config, "bindwright", "notice.json"),
    pluginVersion: pluginVersion.replace(/^v+/, ""),
    fetchLatest: () => fetchVersion(url),
  });
  if (!text) return;
  const hookSpecificOutput = { hookEventName: "SessionStart", additionalContext: text };
  process.stdout.write(JSON.stringify({ systemMessage: text, hookSpecificOutput }));
}

// Run as the hook, not when a test imports it. The loader names this module
// by its real path, so the command's path is compared after following links.
function isEntry() {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (process.argv[1] && isEntry()) {
  main().catch(() => {});
}
