// Resolves one template's toggle blocks and placeholders. Pure text in, text out.
//
// Block grammar (one marker per line, blocks may nest):
//   <!-- TOGGLE:name START -->        kept when flag `name` is on
//   <!-- TOGGLE:name:off START -->    kept when flag `name` is off
//   <!-- TOGGLE:slot:value START -->  kept when choice `slot` equals `value`;
//                                     `value` must be listed in options[slot]
//   <!-- TOGGLE:... END -->           closes the innermost open block
// Marker lines never survive. Placeholders are {{UPPER_SNAKE}}.

const MARKER = /^[ \t]*<!-- TOGGLE:([a-z0-9_]+)(?::([a-z0-9_-]+))? (START|END) -->[ \t]*$/;
const PLACEHOLDER = /\{\{([A-Z0-9_]+)\}\}/g;

export class TemplateError extends Error {}

function keepBlock(name, value, { flags = {}, choices = {}, options = {} }, where) {
  if (value === "off") {
    if (typeof flags[name] !== "boolean") throw new TemplateError(`${where}: unknown flag "${name}"`);
    return !flags[name];
  }
  if (value !== undefined) {
    if (!(name in choices)) throw new TemplateError(`${where}: unknown choice "${name}"`);
    if (!(options[name] || []).includes(value)) throw new TemplateError(`${where}: "${value}" is not an option of "${name}"`);
    return choices[name] === value;
  }
  if (typeof flags[name] !== "boolean") throw new TemplateError(`${where}: unknown flag "${name}"`);
  return flags[name];
}

export function resolveBlocks(text, ctx = {}, file = "template") {
  const out = [];
  const open = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const where = `${file}:${i + 1}`;
    const m = MARKER.exec(line);
    if (!m) {
      if (line.includes("<!-- TOGGLE:")) throw new TemplateError(`${where}: malformed toggle marker`);
      if (open.every((b) => b.keep)) out.push(line);
      return;
    }
    const [, name, value, edge] = m;
    const id = value === undefined ? name : `${name}:${value}`;
    if (edge === "START") {
      const parentKeep = open.every((b) => b.keep);
      open.push({ id, keep: parentKeep && keepBlock(name, value, ctx, where) });
    } else {
      const top = open.pop();
      if (!top || top.id !== id) throw new TemplateError(`${where}: END for "${id}" does not close "${top ? top.id : "nothing"}"`);
    }
  });
  if (open.length) throw new TemplateError(`${file}: unclosed block "${open[open.length - 1].id}"`);
  return out.join("\n");
}

// `values` are substituted. Names in `deferred` stay as-is for the tailoring step.
export function fillPlaceholders(text, values, deferred = new Set(), file = "template") {
  return text.replace(PLACEHOLDER, (whole, name) => {
    if (Object.prototype.hasOwnProperty.call(values, name)) return String(values[name]);
    if (deferred.has(name)) return whole;
    throw new TemplateError(`${file}: no value for placeholder {{${name}}}`);
  });
}

export function renderTemplate(text, ctx, file) {
  const lf = text.replace(/\r\n/g, "\n");
  const resolved = resolveBlocks(lf, ctx, file);
  const filled = fillPlaceholders(resolved, ctx.values || {}, ctx.deferred, file);
  return filled.replace(/\n{3,}/g, "\n\n");
}
