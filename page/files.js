// The files a setup writes, rendered in the browser by the same engine
// /bindwright:setup runs, so the preview is never a hand-made copy.
import { bind } from "../engine/bind.js";

const repo = new URL("../", import.meta.url);
const cache = new Map();
const fetchText = (path) => {
  if (!cache.has(path)) {
    cache.set(path, fetch(new URL(path, repo)).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.text();
    }));
  }
  return cache.get(path);
};

const STAGING = ".bindwright/incoming/";
// Engine bookkeeping and the ~/.claude extras, which setup offers apart.
const HIDDEN = [".bindwright/pristine.json", ".bindwright/global/"];

// [[path, text], ...] as the files land in the repo, sorted folders first.
export async function repoFiles(answers) {
  const [coreFiles, version] = await Promise.all([
    fetchText("engine/core-files.json").then(JSON.parse),
    fetchText("VERSION").then((v) => v.trim().replace(/^v+/, "")),
  ]);
  const files = await bind(answers, { readFile: fetchText, coreFiles, year: new Date().getFullYear(), version });
  const out = [];
  for (const [dest, text] of files) {
    if (HIDDEN.some((h) => dest.startsWith(h))) continue;
    out.push([dest.startsWith(STAGING) ? dest.slice(STAGING.length) : dest, text]);
  }
  return out.sort(([a], [b]) => byFolder(a, b));
}

// Folders before files at each level, then by name.
export function byFolder(a, b) {
  const [x, y] = [a.split("/"), b.split("/")];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const [xDir, yDir] = [i < x.length - 1, i < y.length - 1];
    if (xDir !== yDir) return xDir ? -1 : 1;
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return x.length - y.length;
}
