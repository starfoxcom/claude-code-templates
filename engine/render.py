# Python twin of render.js: resolves one template's toggle blocks and
# placeholders. Pure text in, text out. Same grammar and error messages.
#
# Block grammar (one marker per line, blocks may nest):
#   <!-- TOGGLE:name START -->        kept when flag `name` is on
#   <!-- TOGGLE:name:off START -->    kept when flag `name` is off
#   <!-- TOGGLE:slot:value START -->  kept when choice `slot` equals `value`;
#                                     `value` must be listed in options[slot]
#   <!-- TOGGLE:... END -->           closes the innermost open block
# Marker lines never survive. Placeholders are {{UPPER_SNAKE}}.

import re

MARKER = re.compile(r"[ \t]*<!-- TOGGLE:([a-z0-9_]+)(?::([a-z0-9_-]+))? (START|END) -->[ \t]*")
PLACEHOLDER = re.compile(r"\{\{([A-Z0-9_]+)\}\}")


class TemplateError(Exception):
    pass


def _keep_block(name, value, ctx, where):
    flags = ctx.get("flags", {})
    choices = ctx.get("choices", {})
    options = ctx.get("options", {})
    if value == "off":
        if type(flags.get(name)) is not bool:
            raise TemplateError('%s: unknown flag "%s"' % (where, name))
        return not flags[name]
    if value is not None:
        if name not in choices:
            raise TemplateError('%s: unknown choice "%s"' % (where, name))
        if value not in options.get(name, []):
            raise TemplateError('%s: "%s" is not an option of "%s"' % (where, value, name))
        return choices[name] == value
    if type(flags.get(name)) is not bool:
        raise TemplateError('%s: unknown flag "%s"' % (where, name))
    return flags[name]


def resolve_blocks(text, ctx=None, file="template"):
    ctx = ctx or {}
    out = []
    open_blocks = []
    for i, line in enumerate(text.split("\n")):
        where = "%s:%d" % (file, i + 1)
        m = MARKER.fullmatch(line)
        if not m:
            if "<!-- TOGGLE:" in line:
                raise TemplateError("%s: malformed toggle marker" % where)
            if all(b["keep"] for b in open_blocks):
                out.append(line)
            continue
        name, value, edge = m.groups()
        block_id = name if value is None else "%s:%s" % (name, value)
        if edge == "START":
            parent_keep = all(b["keep"] for b in open_blocks)
            open_blocks.append({"id": block_id, "keep": parent_keep and _keep_block(name, value, ctx, where)})
        else:
            top = open_blocks.pop() if open_blocks else None
            if not top or top["id"] != block_id:
                raise TemplateError('%s: END for "%s" does not close "%s"' % (where, block_id, top["id"] if top else "nothing"))
    if open_blocks:
        raise TemplateError('%s: unclosed block "%s"' % (file, open_blocks[-1]["id"]))
    return "\n".join(out)


def fill_placeholders(text, values, deferred=frozenset(), file="template"):
    """`values` are substituted. Names in `deferred` stay as-is for the tailoring step."""
    def sub(m):
        name = m.group(1)
        if name in values:
            return str(values[name])
        if name in deferred:
            return m.group(0)
        raise TemplateError("%s: no value for placeholder {{%s}}" % (file, name))
    return PLACEHOLDER.sub(sub, text)


def render_template(text, ctx, file):
    lf = text.replace("\r\n", "\n")
    resolved = resolve_blocks(lf, ctx, file)
    filled = fill_placeholders(resolved, ctx.get("values") or {}, ctx.get("deferred", frozenset()), file)
    # Only a template with toggle blocks has gaps from removed blocks to close; any other file keeps
    # its own blank lines (Python's two between functions, for one).
    if "<!-- TOGGLE:" not in lf:
        return filled
    return re.sub(r"\n{3,}", "\n\n", filled)
