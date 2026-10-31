// The page's state and controls. The engine's own model holds the answers,
// so the page and /bindwright:setup always start from the same defaults.
import { defaults } from "../engine/model.js";

// One accent hue per setup (docs/v2/DESIGN.md).
const HUES = { "false,false": 150, "true,false": 200, "false,true": 70, "true,true": 340 };
const hueFor = (team, client) => HUES[`${team},${client}`];

let answers = defaults();

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
}

for (const key of document.querySelectorAll(".k[data-q]")) {
  key.addEventListener("click", () => choose(key.dataset.q, key.dataset.v === "true"));
}
render();
