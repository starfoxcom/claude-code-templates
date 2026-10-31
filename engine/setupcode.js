// The setup code the page hands to /bindwright:setup: "bw1-" followed by the
// answers as UTF-8 JSON in base64url without padding. The Python twin
// (setupcode.py) decodes it with the same checks and messages.

export const PREFIX = "bw1-";
// Real answers encode to about 1 KB and nest three levels deep. The caps keep
// a huge code from reaching the JSON reader, and a deep one from Python's,
// which gives up near 1000 levels where JSON.parse keeps going.
const MAX_BODY = 20000;
export const MAX_DEPTH = 64;

function fail(msg) {
  throw new Error(`Invalid setup code: ${msg}`);
}

// The deepest bracket nesting outside JSON strings.
export function depthOf(text) {
  let depth = 0;
  let deepest = 0;
  let inString = false;
  let escaped = false;
  for (const c of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "[" || c === "{") deepest = Math.max(deepest, ++depth);
    else if (c === "]" || c === "}") depth--;
  }
  return deepest;
}

export function encodeSetupCode(answers) {
  const bytes = new TextEncoder().encode(JSON.stringify(answers));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return PREFIX + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeSetupCode(code) {
  if (typeof code !== "string" || !code.startsWith(PREFIX)) fail(`it must start with ${PREFIX}`);
  const body = code.slice(PREFIX.length);
  if (body.length > MAX_BODY) fail("it is too long");
  if (!/^[A-Za-z0-9_-]+$/.test(body) || body.length % 4 === 1) fail("the part after the prefix is not base64url");
  const binary = atob(body.replace(/-/g, "+").replace(/_/g, "/"));
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    fail("it does not hold UTF-8 JSON");
  }
  if (depthOf(text) > MAX_DEPTH) fail("it nests too deeply");
  let answers;
  try {
    answers = JSON.parse(text);
  } catch {
    fail("it does not hold UTF-8 JSON");
  }
  if (answers === null || typeof answers !== "object" || Array.isArray(answers)) fail("the answers must be an object");
  return answers;
}
