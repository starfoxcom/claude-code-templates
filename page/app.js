// The page's state and controls. The engine's own model holds the answers,
// so the page and /bindwright:setup always start from the same defaults.
import { defaults } from "../engine/model.js";
import { repoFiles, byFolder } from "./files.js";
import { summarize, compare, describe } from "./summary.js";
import { encodeSetupCode } from "../engine/setupcode.js";

// One accent hue per setup (docs/v2/DESIGN.md).
const HUES = { "false,false": 150, "true,false": 200, "false,true": 70, "true,true": 340 };
const hueFor = (team, client) => HUES[`${team},${client}`];
const $ = (id) => document.getElementById(id);
const questions = [...document.querySelectorAll(".q")];
const ADVANCE_MS = 350;
const RISE_STEP_MS = 90;
const DISSOLVE_STEP_MS = 70;
const DISSOLVE_MS = 700;
const TALLY_MS = 500;
const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const mix = (from, to, t) => Math.round(from + (to - from) * t);
const ruleCount = (groups) => groups.reduce((sum, group) => sum + (group.rules?.length ?? 0), 0);
const filesOpen = () => !$("files").classList.contains("away");

// Restarts the one-shot CSS animation that the named class sets on the node.
function restart(node, name) {
  if (still()) return;
  node.classList.remove(name);
  void node.offsetWidth;
  node.classList.add(name);
}

let answers = defaults();
// The questions the reader has picked an answer for.
const answered = new Set();
let files = [];
let selected = "CLAUDE.md";
let latest = 0;
// The summary on screen, and the name of the key that last changed it.
let shown = [];
let choice = null;
let fileChange = null;
// The tally on screen, counting toward the summary's numbers.
let tally = { parts: 0, rules: 0 };
let tallyFrame = 0;
// Set while the summary dissolves before the page starts over.
let dissolving = false;
let snapTimer = 0;
// The group ids on screen just before each question's answer was picked.
const snapshots = new Map();
// The setup step on screen: a question's index, or questions.length for Done.
let step = 0;
let copyTimer = 0;

function choose(question, value, label) {
  if (dissolving) return;
  if (!answered.has(question) || answers[question] !== value) {
    snapshots.set(question, new Set(shown.map((group) => group.id)));
  }
  answered.add(question);
  const same = answers[question] === value;
  // Picking the answer already set changes nothing, so no change is named.
  choice = same ? null : label;
  // A new setup starts from that setup's defaults, as setup itself does.
  if (!same) answers = defaults({ ...answers, [question]: value });
  render();
}

// Answer from a key, then move to the next step after a short pause. A pause
// that finds the reader on another step does nothing.
function pick(key) {
  const from = questions.indexOf(key.closest(".q"));
  choose(key.dataset.q, key.dataset.v === "true", key.querySelector("b").textContent);
  setTimeout(() => { if (step === from) show(from + 1); }, ADVANCE_MS);
}

// Keys 1 and 2 pick that answer of the current question, unless a text field has focus.
function pickByDigit(event) {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target.closest("input, textarea, select, [contenteditable]")) return;
  const keys = questions[step]?.querySelectorAll(".k") ?? [];
  const key = keys[Number(event.key) - 1];
  if (key) pick(key);
}

// Keyboard focus on the step being left moves to the new step's heading.
function show(next) {
  const leaving = $("stage").contains(document.activeElement);
  step = next;
  paintStage();
  if (leaving) stageHeading().focus({ preventScroll: true });
}

function stageHeading() {
  const node = step < questions.length ? questions[step] : $("done");
  return node.querySelector("h3");
}

function paintStage() {
  questions.forEach((node, i) => { node.hidden = i !== step; });
  $("done").hidden = step !== questions.length;
  $("back").hidden = step === 0;
  [...$("steps").children].forEach((dot, i) => {
    if (i === step) dot.setAttribute("aria-current", "step");
    else dot.removeAttribute("aria-current");
  });
}

// One progress dot per question plus the final Done step. The dots only show
// progress: Back moves one step at a time and Edit answers starts over.
function buildSteps() {
  const labels = [...questions.map((_, i) => `Question ${i + 1}`), "Done"];
  const dots = labels.map((label) => {
    const dot = el("li", { className: "dot" });
    dot.setAttribute("aria-label", label);
    return dot;
  });
  $("steps").replaceChildren(...dots);
}

// The two answers in plain words, e.g. "Just me, my own project".
function plainAnswers() {
  const team = answers.team ? "A team" : "Just me";
  const client = answers.client ? "a client's project" : "my own project";
  return `${team}, ${client}`;
}

function commandLine() {
  return `/bindwright:setup ${encodeSetupCode(answers)}`;
}

async function copyCommand() {
  try {
    await navigator.clipboard.writeText(commandLine());
    $("copy").textContent = "Copied";
    restart($("copy"), "pulse");
  } catch {
    $("copy").textContent = "Select and copy";
  }
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { $("copy").textContent = "Copy"; }, 1500);
}

function render() {
  const { team, client } = answers;
  document.documentElement.style.setProperty("--hue", hueFor(team, client));
  for (const key of document.querySelectorAll(".k[data-q]")) {
    const value = key.dataset.v === "true";
    const question = key.dataset.q;
    const picked = answered.has(question) && answers[question] === value;
    key.setAttribute("aria-pressed", String(picked));
    // The key's light shows the setup that pressing it would give.
    const next = { team, client, [question]: value };
    key.style.setProperty("--h", hueFor(next.team, next.client));
  }
  const ready = answered.size === questions.length;
  $("cmd-text").textContent = commandLine();
  $("command").hidden = !ready;
  $("switch").hidden = !ready;
  $("idle").hidden = answered.size > 0;
  const line = plainAnswers();
  if (line !== $("done-line").textContent) restart($("done"), "fade-up");
  $("done-line").textContent = line;
  paintStage();
  refresh();
}

// Re-render the files; only the newest request draws, so fast clicks never
// leave an older setup on screen.
async function refresh() {
  const ticket = ++latest;
  try {
    const next = await repoFiles(answers);
    if (ticket !== latest) return;
    const before = new Set(files.map(([path]) => path));
    files = next;
    const now = new Set(files.map(([path]) => path));
    // Files the last answer change added or removed; none on the first draw.
    fileChange = choice && before.size ? {
      added: new Set([...now].filter((path) => !before.has(path))),
      removed: [...before].filter((path) => !now.has(path)),
    } : null;
    if (!files.some(([path]) => path === selected)) selected = files[0]?.[0];
    drawGroups();
    drawTree();
    drawFile();
    $("status").textContent = $("changed").textContent || "What you get is updated.";
  } catch (err) {
    if (ticket !== latest) return;
    const fail = document.createElement("li");
    fail.textContent = `This part of the page could not load (${err.message || err}). Reload the page to try again.`;
    $("groups").replaceChildren(fail);
  }
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// The summary. Groups the change adds rise in list order; groups it removes
// dissolve as they leave. Unchanged groups are drawn again without motion.
function drawGroups() {
  const before = shown;
  const next = answered.size ? summarize(files) : [];
  const change = compare(before, next);
  shown = next;
  let risen = 0;
  const items = next.map((group) => {
    const added = change.addedGroups.has(group.id);
    const item = el("li", {},
      el("b", { textContent: group.title }), el("p", { textContent: group.say }));
    item.dataset.id = group.id;
    if (added) {
      item.className = "added enter";
      item.style.animationDelay = `${risen++ * RISE_STEP_MS}ms`;
    }
    if (group.rules) item.append(rulesList(group.rules, change, added));
    return item;
  });
  items.push(...departing(change.removedGroups));
  $("groups").replaceChildren(...items);
  // The first summary has nothing to compare with, so it names no change.
  const note = choice && before.length ? changeNote(change) : "";
  if (note && note !== $("changed").textContent) restart($("changed"), "fade-up");
  $("changed").textContent = note;
  $("changed").hidden = !note;
  countTally(next);
  setFilesView(filesOpen());
}

// Groups the last change removed, struck through, then gone once they dissolve.
function departing(gone) {
  if (still()) return [];
  return gone.map((group, i) => {
    const item = el("li", { className: "removed leaving" },
      el("b", { textContent: group.title }), el("p", { textContent: group.say }));
    item.style.animationDelay = `${i * DISSOLVE_STEP_MS}ms`;
    item.addEventListener("animationend", () => item.remove(), { once: true });
    return item;
  });
}

// The tally counts from its old numbers to the new ones over TALLY_MS.
function countTally(groups) {
  const to = { parts: groups.length, rules: ruleCount(groups) };
  const from = tally;
  const start = performance.now();
  cancelAnimationFrame(tallyFrame);
  const frame = (now) => {
    const t = still() ? 1 : Math.min(Math.max(now - start, 0) / TALLY_MS, 1);
    tally = { parts: mix(from.parts, to.parts, t), rules: mix(from.rules, to.rules, t) };
    paintTally();
    if (t < 1) tallyFrame = requestAnimationFrame(frame);
  };
  frame(start);
}

// "· 6 parts, 23 rules" after the heading; empty until the first answer.
function paintTally() {
  const { parts, rules } = tally;
  const text = `· ${count(parts, "part")}, ${count(rules, "rule")}`;
  $("tally").textContent = answered.size ? text : "";
}

// A group the change added is marked New, and its rules are not marked again.
function rulesList(rules, change, entering) {
  const isNew = (name) => !entering && change.addedRules.has(name);
  const rows = rules.map(([name, line], i) => {
    const row = el("li", { className: isNew(name) ? "added" : "" },
      el("b", { textContent: name }), ` ${line}`);
    row.style.setProperty("--i", i);
    return row;
  });
  for (const name of change.removedRules) {
    rows.push(el("li", { className: "removed" }, el("b", { textContent: name })));
  }
  const changed = !entering && (change.addedRules.size || change.removedRules.length);
  return el("details", { open: Boolean(changed) },
    el("summary", { textContent: `See the ${rules.length} rules` }), el("ul", { className: "rules" }, ...rows));
}

function changeNote(change) {
  const newGroups = [...change.addedGroups].map((id) => shown.find((g) => g.id === id).title);
  const added = describe(newGroups, [...change.addedRules]);
  const removed = describe(change.removedGroups.map((g) => g.title), change.removedRules);
  if (!added && !removed) return `${choice} changes settings inside the files, not this list.`;
  if (!added) return `${choice} removes ${removed}.`;
  return `${choice} adds ${added}. ${removed ? `It removes ${removed}.` : "Nothing is removed."}`;
}

// Folder rows wherever a path enters a new folder, then the file itself. Files
// the last change added are marked green; removed ones stay, struck through.
function drawTree() {
  const rows = [];
  let open = [];
  const removed = new Set(fileChange?.removed ?? []);
  const paths = [...files.map(([path]) => path), ...removed].sort(byFolder);
  for (const path of paths) {
    const parts = path.split("/");
    const dirs = parts.slice(0, -1);
    let same = 0;
    while (same < dirs.length && open[same] === dirs[same]) same++;
    for (let d = same; d < dirs.length; d++) rows.push(row("div", "dir", d, `${dirs[d]}/`));
    open = dirs;
    if (removed.has(path)) {
      rows.push(row("div", "file removed", dirs.length, parts.at(-1)));
      continue;
    }
    const file = row("button", fileChange?.added.has(path) ? "file added" : "file", dirs.length, parts.at(-1));
    file.type = "button";
    file.dataset.path = path;
    if (path === selected) file.setAttribute("aria-current", "true");
    rows.push(file);
  }
  $("tree").replaceChildren(...rows);
}

function row(tag, kind, depth, text) {
  const node = el(tag, { className: kind, textContent: text });
  node.style.setProperty("--d", depth);
  return node;
}

function drawFile() {
  const file = files.find(([path]) => path === selected);
  $("path").textContent = file ? file[0] : "";
  $("code").textContent = file ? file[1] : "";
  $("code").scrollTop = 0;
}

$("tree").addEventListener("click", (event) => {
  const file = event.target.closest(".file");
  if (!file || file.dataset.path === selected) return;
  selected = file.dataset.path;
  for (const node of $("tree").querySelectorAll(".file")) {
    if (node === file) node.setAttribute("aria-current", "true");
    else node.removeAttribute("aria-current");
  }
  drawFile();
  restart($("code").parentElement, "swap");
});

// The summary and the file tree take turns in the same panel. The view that
// leaves fades and slides out, the one that comes in fades up. Neither is
// rebuilt, so the summary's cards keep their place and do not rise again.
function setFilesView(open) {
  const view = open ? "files" : "overview";
  const panel = $("files");
  const groups = $("groups");
  if (panel.classList.contains("away") === open) {
    const [leaving, arriving] = open ? [groups, panel] : [panel, groups];
    leaving.classList.remove("arrive");
    leaving.classList.add("away", "leave");
    arriving.classList.remove("away", "leave");
    arriving.classList.add("arrive");
  }
  $("switch").dataset.view = view;
  for (const opt of $("switch").querySelectorAll(".seg-opt")) {
    opt.setAttribute("aria-pressed", String(opt.dataset.view === view));
  }
  $("files-opt").textContent = `Files · ${files.length}`;
}

// Dissolves the given summary items, from the last one up, then calls done once.
function snap(items, done) {
  if (dissolving) return;
  dissolving = true;
  const finish = () => {
    if (!dissolving) return;
    clearTimeout(snapTimer);
    dissolving = false;
    done();
  };
  if (still() || items.length === 0) {
    finish();
    return;
  }
  items.forEach((item, i) => {
    item.classList.add("leaving");
    item.style.animationDelay = `${(items.length - 1 - i) * DISSOLVE_STEP_MS}ms`;
  });
  // The first item starts last, so it ends last; the timer covers a missed event.
  const last = items[0];
  last.addEventListener("animationend", (event) => { if (event.target === last) finish(); });
  snapTimer = setTimeout(finish, (items.length - 1) * DISSOLVE_STEP_MS + DISSOLVE_MS + 100);
}

// Back returns one step. The question it returns to is un-answered: the groups
// that answer added dissolve, and the groups it removed come back with the rise.
function goBack() {
  if (step === 0 || dissolving) return;
  const to = step - 1;
  show(to);
  const question = questions[to].querySelector("[data-q]").dataset.q;
  if (!answered.has(question)) return;
  const before = snapshots.get(question) ?? new Set();
  const added = [...$("groups").children]
    .filter((item) => item.dataset.id && !before.has(item.dataset.id));
  snap(added, () => unanswer(to, before));
}

// Drops the answers from a question index on, so the summary falls back to what came before.
function unanswer(index, before) {
  const base = defaults();
  for (const node of questions.slice(index)) {
    const key = node.querySelector("[data-q]").dataset.q;
    answered.delete(key);
    answers = defaults({ ...answers, [key]: base[key] });
  }
  choice = null;
  shown = shown.filter((group) => before.has(group.id));
  render();
}

// Back to the empty start: no answers picked, question 1, files closed, default hue.
function reset() {
  answers = defaults();
  answered.clear();
  snapshots.clear();
  choice = null;
  shown = [];
  fileChange = null;
  selected = "CLAUDE.md";
  setFilesView(false);
  show(0);
  render();
}

// Opening or closing a rules list resizes its card to the full row and moves
// the cards after it; each card glides from where it was instead of jumping.
function glideRules(event) {
  const summary = event.target.closest("summary");
  if (!summary || still()) return;
  event.preventDefault();
  const cards = [...$("groups").children];
  const before = cards.map((card) => card.getBoundingClientRect());
  summary.parentElement.open = !summary.parentElement.open;
  cards.forEach((card, i) => {
    const was = before[i];
    const now = card.getBoundingClientRect();
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    if (!dx && !dy && was.width === now.width) return;
    card.animate([
      { transform: `translate(${dx}px, ${dy}px)`, width: `${was.width}px` },
      { transform: "none", width: `${now.width}px` },
    ], { duration: 280, easing: "cubic-bezier(.2, .8, .2, 1)" });
  });
}

for (const key of document.querySelectorAll(".k[data-q]")) {
  key.addEventListener("click", () => pick(key));
}
$("switch").addEventListener("click", (event) => {
  const opt = event.target.closest(".seg-opt");
  if (opt) setFilesView(opt.dataset.view === "files");
});
$("groups").addEventListener("click", glideRules);
$("back").addEventListener("click", goBack);
$("edit").addEventListener("click", () => snap([...$("groups").children], reset));
$("copy").addEventListener("click", copyCommand);
document.addEventListener("keydown", pickByDigit);
buildSteps();
render();
