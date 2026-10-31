// The page's state and controls. The engine's own model holds the answers,
// so the page and /bindwright:setup always start from the same defaults.
import { defaults } from "../engine/model.js";
import { repoFiles } from "./files.js";
import { summarize } from "./summary.js";

// One accent hue per setup (docs/v2/DESIGN.md).
const HUES = { "false,false": 150, "true,false": 200, "false,true": 70, "true,true": 340 };
const hueFor = (team, client) => HUES[`${team},${client}`];
const $ = (id) => document.getElementById(id);

let answers = defaults();
let files = [];
let selected = "CLAUDE.md";
let latest = 0;

function choose(question, value) {
  if (answers[question] === value) return;
  // A new setup starts from that setup's defaults, as setup itself does.
  answers = defaults({ ...answers, [question]: value });
  render();
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
  refresh();
}

// Re-render the files; only the newest request draws, so fast clicks never
// leave an older setup on screen.
async function refresh() {
  const ticket = ++latest;
  try {
    const next = await repoFiles(answers);
    if (ticket !== latest) return;
    files = next;
    if (!files.some(([path]) => path === selected)) selected = files[0]?.[0];
    drawGroups();
    drawTree();
    drawFile();
    $("status").textContent = "What you get is updated.";
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

function drawGroups() {
  $("groups").replaceChildren(...summarize(files).map((group) => {
    const item = el("li", {}, el("b", { textContent: group.title }), el("p", { textContent: group.say }));
    if (group.rules) {
      const list = el("ul", { className: "rules" },
        ...group.rules.map(([name, line]) => el("li", {}, el("b", { textContent: name }), ` ${line}`)));
      item.append(el("details", {}, el("summary", { textContent: `See the ${group.rules.length} rules` }), list));
    }
    return item;
  }));
  $("toggle").textContent = $("files").hidden ? `Show the ${files.length} files` : "Back to the summary";
}

// Folder rows wherever a path enters a new folder, then the file itself.
function drawTree() {
  const rows = [];
  let open = [];
  for (const [path] of files) {
    const parts = path.split("/");
    const dirs = parts.slice(0, -1);
    let same = 0;
    while (same < dirs.length && open[same] === dirs[same]) same++;
    for (let d = same; d < dirs.length; d++) rows.push(row("div", "dir", d, `${dirs[d]}/`));
    open = dirs;
    const file = row("button", "file", dirs.length, parts.at(-1));
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
  key.addEventListener("click", () => choose(key.dataset.q, key.dataset.v === "true"));
}
render();
