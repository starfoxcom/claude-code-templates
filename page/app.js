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
const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

let answers = defaults();
let files = [];
let selected = "CLAUDE.md";
let latest = 0;
// The summary on screen, and the name of the key that last changed it.
let shown = null;
let choice = null;
let fileChange = null;
// The setup step on screen: a question's index, or questions.length for Done.
let step = 0;
let copyTimer = 0;

function choose(question, value, label) {
  if (answers[question] === value) return;
  choice = label;
  // A new setup starts from that setup's defaults, as setup itself does.
  answers = defaults({ ...answers, [question]: value });
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

// One progress dot per question plus the final Done step; each jumps to its step.
function buildSteps() {
  const labels = [...questions.map((_, i) => `Question ${i + 1}`), "Done"];
  const dots = labels.map((label, i) => {
    const dot = el("button", { type: "button", className: "dot" });
    dot.setAttribute("aria-label", label);
    dot.addEventListener("click", () => show(i));
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
    key.setAttribute("aria-pressed", String(answers[question] === value));
    // The key's light shows the setup that pressing it would give.
    const next = { team, client, [question]: value };
    key.style.setProperty("--h", hueFor(next.team, next.client));
  }
  $("cmd-text").textContent = commandLine();
  $("done-line").textContent = plainAnswers();
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

// The summary, with what the last answer change added (green) and removed
// (struck through, red) marked until the next change.
function drawGroups() {
  const next = summarize(files);
  const change = shown && choice ? compare(shown, next) : null;
  shown = next;
  const items = next.map((group) => {
    const item = el("li", {}, el("b", { textContent: group.title }), el("p", { textContent: group.say }));
    if (change?.addedGroups.has(group.id)) item.className = "added";
    if (group.rules) item.append(rulesList(group.rules, change));
    return item;
  });
  for (const gone of change?.removedGroups ?? []) {
    const title = el("b", { textContent: gone.title });
    items.push(el("li", { className: "removed" }, title, el("p", { textContent: gone.say })));
  }
  $("groups").replaceChildren(...items);
  $("changed").textContent = change ? changeNote(change) : "";
  $("changed").hidden = !change;
  paintTally(next);
  $("toggle").textContent = $("files").hidden ? `Show the ${files.length} files` : "Back to the summary";
}

// "· 6 parts, 23 rules" after the heading, counted from the summary on screen.
function paintTally(groups) {
  const rules = groups.reduce((sum, group) => sum + (group.rules?.length ?? 0), 0);
  $("tally").textContent = `· ${count(groups.length, "part")}, ${count(rules, "rule")}`;
}

function rulesList(rules, change) {
  const rows = rules.map(([name, line]) => el("li", { className: change?.addedRules.has(name) ? "added" : "" },
    el("b", { textContent: name }), ` ${line}`));
  for (const name of change?.removedRules ?? []) {
    rows.push(el("li", { className: "removed" }, el("b", { textContent: name })));
  }
  const changed = change && (change.addedRules.size || change.removedRules.length);
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
});

// The summary and the file tree take turns in the same panel.
$("toggle").addEventListener("click", () => {
  const showFiles = $("files").hidden;
  $("files").hidden = !showFiles;
  $("groups").hidden = showFiles;
  $("toggle").setAttribute("aria-pressed", String(showFiles));
  $("toggle").textContent = showFiles ? "Back to the summary" : `Show the ${files.length} files`;
});

for (const key of document.querySelectorAll(".k[data-q]")) {
  key.addEventListener("click", () => pick(key));
}
$("back").addEventListener("click", () => show(Math.max(0, step - 1)));
$("edit").addEventListener("click", () => show(0));
$("copy").addEventListener("click", copyCommand);
document.addEventListener("keydown", pickByDigit);
buildSteps();
render();
