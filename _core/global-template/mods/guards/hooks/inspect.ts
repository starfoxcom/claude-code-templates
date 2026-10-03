// Turns one Bash or PowerShell command into what the guards must check: the message texts it writes
// to history, the body files it hands over, the branches it creates, and whether a commit's added
// lines need a look. Pure, no engine access.
//
// guards is a safety net for commands written the ordinary way, not a sandbox. It follows the shapes
// people and agents really write: git and gh behind `if`/`then`/`do`/`{`/`(`, `sudo`, `env`, `timeout`,
// `xargs`, inside `$(...)`, `bash -c` and `powershell -Command`; messages from variables set earlier in
// the command, here-docs, pipes and files the command writes itself. Where a message exists but its text
// is made by something the reading cannot follow, the message is named in `unread` (logged, never
// silently passed). What it cannot see at all (also listed in mods/README.md):
// - commands run from a script file, an alias or shell function, a git alias (`git ci -m ...`), `eval`,
//   `ssh host ...`, or any other program that writes to GitHub on its own (a Python script, an SDK);
// - a body file another program writes in the same command (`Set-Content`, `Out-File`, `tee`): the
//   file does not exist yet when the guard looks, so it reports that it could not read it;
// - the output of another program used as a message (`git log --format=%B | git commit -F -`): named
//   unread, its text never checked;
// - AI credit hidden on purpose (assembled from pieces, encoded, fetched): out of scope.

import { stripPaths } from './policy'
import { parse, programOf } from './shell'
import type { Statement, Word } from './shell'

export type Plan = {
  /** Message text with where it goes ("the commit message", "the PR body"). `creditOnly`: command text
   * around a message (a `$(...)` as typed), checked for AI credit but not for the product name. */
  texts: { where: string; text: string; creditOnly?: boolean }[]
  /** Body files the command hands to git or gh, as written (relative to `cwd` when not absolute).
   * `written`: this same command writes the file, and what it writes was read from the command text. */
  files: { where: string; path: string; written?: boolean }[]
  /** Files the command itself writes (`> file`). */
  written: string[]
  branches: string[]
  /** A commit runs: `cached` checks the staged lines, `all` the working tree's too (`-a`, pathspecs). */
  diff: 'cached' | 'all' | null
  /** Messages whose text is built in a way the guard cannot read ($VAR from outside, another program's output). */
  unread: string[]
  /** `gh --repo owner/name` when given. */
  repo?: string
  /** Where relative paths resolve: a leading `cd` or `git -C`. */
  cwd?: string
  /** The `cd` or `-C` folder is built at run time (`cd "$REPO"`): relative paths cannot be found. */
  isCwdUnknown?: boolean
  block?: string
  isWrite: boolean
}

// The reading's working state while it walks one command.
type Reading = {
  plan: Plan
  ps: boolean
  /** Variables set earlier in the command, by lower-cased name; `literal` when their value is known. */
  vars: Map<string, { text: string; literal: boolean }>
  /** The statement that writes each file (`> file`), by normalized path. */
  writers: Map<string, { st: Statement; ps: boolean }>
  /** Message routes read from stdin so far (`-F -`, `--body-file -`, `--input -`, `body=@-`). */
  stdin: number
  /** Write statements found so far. */
  writes: number
  method?: string
}

// `attached`: a flag whose value can only be attached (`-S<keyid>`, `--gpg-sign=<keyid>`); it never takes
// the next word, and in a bundle the rest of the word is its value.
type Kind = 'text' | 'file' | 'skip' | 'repo' | 'branch' | 'field' | 'data' | 'method' | 'attached'
type Spec = Record<string, Kind>

const COMMIT: Spec = {
  '-m': 'text',
  '--message': 'text',
  '-F': 'file',
  '--file': 'file',
  '-t': 'file',
  '--template': 'file',
  '-C': 'skip',
  '-c': 'skip',
  '--reuse-message': 'skip',
  '--reedit-message': 'skip',
  '--fixup': 'skip',
  '--squash': 'skip',
  '--author': 'text',
  '--date': 'skip',
  '--trailer': 'text',
  '--cleanup': 'skip',
  '-S': 'attached',
  '--gpg-sign': 'attached',
  '-u': 'attached',
  '--untracked-files': 'attached',
}
const MESSAGE: Spec = { '-m': 'text', '--message': 'text', '-F': 'file', '--file': 'file' }
const GH_BODY: Spec = {
  '-t': 'text',
  '--title': 'text',
  '-b': 'text',
  '--body': 'text',
  '-F': 'file',
  '--body-file': 'file',
  '-R': 'repo',
  '--repo': 'repo',
  '-T': 'skip',
  '--template': 'skip',
  '-B': 'skip',
  '--base': 'skip',
  '-H': 'skip',
  '--head': 'skip',
  '-a': 'skip',
  '--assignee': 'skip',
  '-l': 'skip',
  '--label': 'skip',
  '-m': 'skip',
  '--milestone': 'skip',
  '-p': 'skip',
  '--project': 'skip',
  '-r': 'skip',
  '--reviewer': 'skip',
  '--add-label': 'skip',
  '--remove-label': 'skip',
  '--comment': 'text',
}
// Subcommands whose short flags mean something else: a boolean read as value-taking would swallow the
// next word (`gh pr review 5 -a -b '<text>'` would hide the body), so each gets its own table. Flags
// absent from a table are read as booleans.
const GH_REVIEW: Spec = {
  '-b': 'text',
  '--body': 'text',
  '-F': 'file',
  '--body-file': 'file',
  '-R': 'repo',
  '--repo': 'repo',
}
const GH_MERGE: Spec = {
  '-b': 'text',
  '--body': 'text',
  '-F': 'file',
  '--body-file': 'file',
  '-t': 'text',
  '--subject': 'text',
  '-A': 'skip',
  '--author-email': 'skip',
  '--match-head-commit': 'skip',
  '-R': 'repo',
  '--repo': 'repo',
}
const GH_CLOSE: Spec = {
  '-c': 'text',
  '--comment': 'text',
  '-r': 'skip',
  '--reason': 'skip',
  '-R': 'repo',
  '--repo': 'repo',
}
const GH_RELEASE: Spec = {
  '-t': 'text',
  '--title': 'text',
  '-n': 'text',
  '--notes': 'text',
  '-F': 'file',
  '--notes-file': 'file',
  '-R': 'repo',
  '--repo': 'repo',
  '--target': 'skip',
}
const GH_DESC: Spec = { '-d': 'text', '--desc': 'text', '--description': 'text', '-R': 'repo', '--repo': 'repo' }
const GH_API: Spec = {
  '-f': 'field',
  '--raw-field': 'field',
  '-F': 'field',
  '--field': 'field',
  '--input': 'file',
  '-X': 'method',
  '--method': 'method',
  '-H': 'skip',
  '--header': 'skip',
  '--jq': 'skip',
  '-q': 'skip',
}
const CURL: Spec = { '-d': 'data', '--data': 'data', '--data-raw': 'data', '--data-binary': 'data' }
const PS_WEB: Spec = { '-body': 'text', '-infile': 'file' }

const GH_WRITES: Record<string, string[]> = {
  pr: ['create', 'edit', 'comment', 'review', 'merge', 'close', 'reopen'],
  issue: ['create', 'edit', 'comment', 'close', 'reopen'],
  release: ['create', 'edit'],
  gist: ['create', 'edit'],
  repo: ['create', 'edit'],
}

export function inspect(command: string, powershell: boolean): Plan {
  const plan: Plan = { texts: [], files: [], written: [], branches: [], diff: null, unread: [], isWrite: false }
  const r: Reading = { plan, ps: powershell, vars: new Map(), writers: new Map(), stdin: 0, writes: 0 }
  read(parse(command, powershell), r)
  // A body file this same command writes is read from the statement that writes it.
  for (const f of [...plan.files]) {
    const writer = r.writers.get(norm(f.path))
    if (!writer) continue
    f.written = true
    feed(writer.st, { ...r, ps: writer.ps }, `${f.where} (file ${f.path})`)
  }
  // The backstop the shipped attribution hook has always had: a write's whole command text is checked last
  // for credit lines, so a spelling the reading does not model still cannot carry one into history.
  if (plan.isWrite) plan.texts.push({ where: 'the command text', text: stripPaths(command), creditOnly: true })
  return plan
}

const norm = (path: string) => path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()

function read(statements: Statement[], r: Reading) {
  const { plan } = r
  statements.forEach((st, idx) => {
    read(st.inner, r)
    plan.written.push(...st.writes)
    for (const path of st.writes) r.writers.set(norm(path), { st, ps: r.ps })
    const { name, args } = programOf(st)
    if (assign(st, name, args, r)) return
    if (
      (name === 'cd' || name === 'set-location' || name === 'pushd' || name === 'sl') &&
      !plan.cwd &&
      !plan.isCwdUnknown
    ) {
      setCwd(
        plan,
        args.find(a => !a.text.startsWith('-')),
      )
      return
    }
    const inner = script(name, args)
    if (inner) {
      const ps = r.ps
      const writes = r.writes
      r.ps = inner.ps
      read(inner.statements, r)
      r.ps = ps
      if (inner.dynamic && r.writes > writes) plan.unread.push(`a ${name} script built at run time`)
      return
    }
    const stdin = r.stdin
    const where = name === 'git' ? git(st, args, r) : name === 'gh' ? gh(st, args, r) : web(name, st, args, r)
    if (!where) return
    r.writes++
    // PowerShell splatting (`gh pr create @params`): the hashtable built earlier is checked as typed.
    for (const a of args) {
      const splat = r.ps ? /^@(\w+)$/.exec(a.text) : null
      if (!splat) continue
      const v = r.vars.get((splat[1] ?? '').toLowerCase())
      if (v) plan.texts.push({ where, text: v.text, creditOnly: true })
      plan.unread.push(where)
    }
    // A message read from stdin with no here-doc on the statement: a `< file`, or the statement piped in.
    if (r.stdin > stdin && st.heredocs.length === 0) {
      const prev = statements[idx - 1]
      if (st.reads.length > 0) for (const path of st.reads) plan.files.push({ where, path })
      else if (st.pipeIn && prev) feed(prev, r, where)
      else plan.unread.push(where)
    }
  })
}

// What a statement prints, read as message text for `where`: the input of a pipe, or a file it writes.
function feed(st: Statement, r: Reading, where: string) {
  const { plan } = r
  for (const body of st.heredocs) plan.texts.push({ where, text: body })
  const { name, args } = programOf(st)
  if (/^(cat|type|get-content|gc)$/.test(name)) {
    const paths = args.filter(a => !a.text.startsWith('-'))
    for (const p of paths) take('file', p, r, where)
    for (const path of st.reads) plan.files.push({ where, path })
    if (paths.length + st.reads.length + st.heredocs.length === 0) plan.unread.push(where)
    return
  }
  // PowerShell: a statement that is only a string (`'text' | gh ...`, `@'...'@ | gh ...`).
  if (r.ps && st.words.length === 1) return message(st.words[0] as Word, r, where)
  if (/^(echo|printf|write-output|write-host)$/.test(name)) {
    for (const a of args) message(a, r, where)
    return
  }
  // Another program's output: its words are checked for credit, the output itself cannot be read.
  for (const w of st.words) plan.texts.push({ where, text: w.text, creditOnly: true })
  plan.unread.push(where)
}

// Variables set earlier in the command (`MSG='...'`, `$m = @'...'@`, `read -r -d '' BODY <<'EOF'`):
// a message that names one is read with its value. Returns true for an assignment statement.
function assign(st: Statement, name: string, args: Word[], r: Reading): boolean {
  const w = st.words
  if (r.ps) {
    const spaced = /^\$(\w+)$/.exec(w[0]?.text ?? '')
    if (spaced && w[1]?.text === '=') {
      set(r, spaced[1] ?? '', w.length === 3 ? w[2] : undefined)
      return true
    }
    const joined = w.length === 1 ? /^\$(\w+)=([\s\S]*)$/.exec(w[0]?.text ?? '') : null
    if (joined) set(r, joined[1] ?? '', { ...(w[0] as Word), text: joined[2] ?? '' })
    return Boolean(joined)
  }
  const pairs = name === '' ? w : /^(export|declare|local|readonly|typeset)$/.test(name) ? args : null
  if (pairs) {
    for (const a of pairs) {
      const m = /^([A-Za-z_]\w*)=/.exec(a.text)
      if (m) set(r, m[1] ?? '', { ...a, text: a.text.slice(m[0].length) })
    }
    return true
  }
  if (name === 'read' && st.heredocs.length > 0) {
    const v = [...args].reverse().find(a => /^[A-Za-z_]\w*$/.test(a.text))
    if (v) r.vars.set(v.text.toLowerCase(), { text: st.heredocs[0] ?? '', literal: true })
    return true
  }
  return false
}

function set(r: Reading, name: string, value: Word | undefined) {
  const key = name.toLowerCase()
  if (!value) return void r.vars.delete(key)
  if (!value.dynamic) return void r.vars.set(key, { text: value.text, literal: true })
  const e = expand(value.text, r)
  r.vars.set(key, { text: e.unresolved ? value.text : e.text, literal: !e.unresolved })
}

// `bash -c '...'`, `powershell -Command "..."`, `cmd /c ...`: the script is read as a command of its own.
function script(name: string, args: Word[]): { statements: Statement[]; ps: boolean; dynamic: boolean } | undefined {
  const of = (i: number, ps: boolean) => {
    const rest = args.slice(i + 1)
    if (i === -1 || rest.length === 0) return undefined
    const text = rest.length === 1 ? (rest[0]?.text ?? '') : rest.map(a => a.text).join(' ')
    return { statements: parse(text, ps), ps, dynamic: rest.some(a => a.dynamic) }
  }
  if (/^(bash|sh|zsh|dash|ksh)$/.test(name))
    return of(
      args.findIndex(a => /^-[a-z]*c[a-z]*$/.test(a.text)),
      false,
    )
  if (/^(pwsh|powershell)$/.test(name))
    return of(
      args.findIndex(a => /^-(c|command)$/i.test(a.text)),
      true,
    )
  if (name === 'cmd') {
    // Git Bash turns `/c` into a path, so it is typed `//c` there.
    const i = args.findIndex(a => /^\/{1,2}[ck]$/i.test(a.text))
    if (i === -1) return undefined
    const words = args.slice(i + 1)
    // `cmd /c "git commit -m \"...\""`: the command as one quoted word is read as a command line.
    if (words.length === 1)
      return { statements: parse(words[0]?.text ?? '', false), ps: false, dynamic: words[0]?.dynamic ?? false }
    return {
      statements: [{ words, heredocs: [], writes: [], reads: [], pipeIn: false, inner: [] }],
      ps: false,
      dynamic: false,
    }
  }
  return undefined
}

function setCwd(plan: Plan, word: Word | undefined) {
  if (word?.dynamic) plan.isCwdUnknown = true
  else plan.cwd = word?.text
}

// A write statement: its here-doc bodies are message text (a `--body-file -` or `-F -` reads them).
function write(plan: Plan, st: Statement, where: string): string {
  plan.isWrite = true
  for (const body of st.heredocs) plan.texts.push({ where, text: body })
  return where
}

// `git branch` flags that list, delete or configure instead of creating a branch.
const BRANCH_NOT_CREATE = new RegExp(
  '^-[dDlarvu]|^--(' +
    'delete|list|all|remotes|show-current|contains|merged|no-merged|set-upstream|unset-upstream|edit-description' +
    ')',
)

function git(st: Statement, args: Word[], r: Reading): string | undefined {
  const { plan } = r
  let k = 0
  while (k < args.length) {
    const t = args[k]?.text ?? ''
    if (t === '-C') {
      if (!plan.cwd && !plan.isCwdUnknown) setCwd(plan, args[k + 1])
      k += 2
    } else if (t === '-c' || t === '--git-dir' || t === '--work-tree' || t === '--namespace') k += 2
    else if (t.startsWith('-')) k++
    else break
  }
  const sub = args[k]?.text ?? ''
  const rest = args.slice(k + 1)
  switch (sub) {
    case 'commit': {
      const where = write(plan, st, 'the commit message')
      const positional = walk(rest, COMMIT, r, where)
      const all = rest.some(
        a => a.text === '--all' || (/^-[a-zA-Z]*a[a-zA-Z]*$/.test(a.text) && !a.text.startsWith('--')),
      )
      plan.diff = all || positional.length > 0 ? 'all' : (plan.diff ?? 'cached')
      return where
    }
    case 'tag':
    case 'merge':
    case 'commit-tree': {
      const where = write(plan, st, `the ${sub} message`)
      walk(rest, MESSAGE, r, where)
      return where
    }
    case 'notes': {
      const where = write(plan, st, 'the git note')
      walk(rest.slice(1), MESSAGE, r, where)
      return where
    }
    case 'checkout':
      walk(rest, { '-b': 'branch', '-B': 'branch' }, r, '')
      return undefined
    case 'switch':
      walk(rest, { '-c': 'branch', '-C': 'branch', '--create': 'branch', '--force-create': 'branch' }, r, '')
      return undefined
    case 'worktree':
      if (rest[0]?.text === 'add') walk(rest.slice(1), { '-b': 'branch', '-B': 'branch' }, r, '')
      return undefined
    case 'branch': {
      const flags = rest.filter(a => a.text.startsWith('-')).map(a => a.text)
      const names = rest.filter(a => !a.text.startsWith('-')).map(a => a.text)
      if (flags.some(f => /^-(m|M|c|C)$|^--(move|copy)$/.test(f))) plan.branches.push(...names.slice(-1))
      else if (!flags.some(f => BRANCH_NOT_CREATE.test(f))) plan.branches.push(...names.slice(0, 1))
      return undefined
    }
  }
  return undefined
}

function gh(st: Statement, args: Word[], r: Reading): string | undefined {
  const { plan } = r
  // The subcommand words, past global options: `gh -R owner/name pr comment ...`.
  let gi = -1
  let ai = -1
  for (let i = 0; i < args.length && ai === -1; i++) {
    const t = args[i]?.text ?? ''
    if (t === '-R' || t === '--repo') {
      const value = args[++i]
      if (value) take('repo', value, r, '')
    } else if (t.startsWith('--repo=')) take('repo', { ...(args[i] as Word), text: t.slice(7) }, r, '')
    else if (t.startsWith('-')) continue
    else if (gi === -1) gi = i
    else ai = i
  }
  const group = args[gi]?.text ?? ''
  const action = args[ai]?.text ?? ''
  const rest = args.filter((_, i) => i !== gi && i !== ai)
  if (group === 'run' && action === 'watch') {
    plan.block =
      '`gh run watch` streams a live log into the tool call. Watch checks with the ci-watch mod (it starts on ' +
      'push), or the Monitor tool when that mod is not loaded.'
    return undefined
  }
  if (group === 'api') {
    const before = plan.files.length + plan.texts.length + r.stdin
    r.method = undefined
    // The endpoint is a positional; keep it out of the field walk.
    walk(
      args.filter((_, i) => i !== gi),
      GH_API,
      r,
      'the GitHub API call',
    )
    const hasFields = plan.files.length + plan.texts.length + r.stdin > before
    if (r.method === 'GET' || (!hasFields && !/^(POST|PATCH|PUT)$/.test(r.method ?? ''))) return undefined
    return write(plan, st, 'the GitHub API call')
  }
  if (!GH_WRITES[group]?.includes(action)) {
    walk(rest, { '-R': 'repo', '--repo': 'repo' }, r, '')
    return undefined
  }
  const where = write(plan, st, `the ${group === 'pr' ? 'PR' : group} ${action === 'create' ? 'text' : action}`)
  const spec =
    group === 'release'
      ? GH_RELEASE
      : group === 'gist' || group === 'repo'
        ? GH_DESC
        : group === 'pr' && action === 'review'
          ? GH_REVIEW
          : group === 'pr' && action === 'merge'
            ? GH_MERGE
            : action === 'close' || action === 'reopen'
              ? GH_CLOSE
              : GH_BODY
  walk(rest, spec, r, where)
  return where
}

// `curl` and `Invoke-RestMethod` calls to the GitHub API.
function web(name: string, st: Statement, args: Word[], r: Reading): string | undefined {
  if (!args.some(a => a.text.includes('api.github.com'))) return undefined
  const where = 'the GitHub API call'
  if (name === 'curl') {
    write(r.plan, st, where)
    walk(args, CURL, r, where)
    return where
  }
  if (/^(invoke-restmethod|invoke-webrequest|irm|iwr)$/.test(name)) {
    write(r.plan, st, where)
    walk(
      args.map(a => ({ ...a, text: a.text.startsWith('-') ? a.text.toLowerCase() : a.text })),
      PS_WEB,
      r,
      where,
    )
    return where
  }
  return undefined
}

// Reads options by the spec; returns the positional words. Short flags may be bundled (`-am "msg"`)
// or carry their value attached (`-m"msg"`, `-Fbody.md`, `-XPOST`); long ones may use `=`.
function walk(args: Word[], spec: Spec, r: Reading, where: string): Word[] {
  const positional: Word[] = []
  for (let i = 0; i < args.length; i++) {
    const w = args[i] as Word
    const t = w.text
    if (t === '--') {
      positional.push(...args.slice(i + 1))
      break
    }
    if (t.startsWith('--')) {
      const eq = t.indexOf('=')
      const flag = eq === -1 ? t : t.slice(0, eq)
      const kind = spec[flag]
      if (!kind || kind === 'attached') continue
      const value = eq === -1 ? args[++i] : { ...w, text: t.slice(eq + 1) }
      if (value) take(kind, value, r, where)
      else missing(kind, r, where)
      continue
    }
    if (t.startsWith('-') && t.length > 1 && !w.dynamic) {
      if (spec[t] === 'attached') continue
      if (spec[t]) {
        const value = args[++i]
        if (value) take(spec[t] as Kind, value, r, where)
        else missing(spec[t] as Kind, r, where)
        continue
      }
      // A bundle: the first letter that takes a value takes the rest of the word, or the next word.
      for (let j = 1; j < t.length; j++) {
        const kind = spec[`-${t[j]}`]
        if (!kind) continue
        if (kind === 'attached') break
        const attached = t.slice(j + 1)
        const value = attached ? { ...w, text: attached } : args[++i]
        if (value) take(kind, value, r, where)
        else missing(kind, r, where)
        break
      }
      continue
    }
    positional.push(w)
  }
  return positional
}

// A message flag with nothing after it: the reading lost its value (a word it could not split, such as
// `-F <(...)` cut short), so the message is named as unread.
function missing(kind: Kind, r: Reading, where: string) {
  if (where && (kind === 'text' || kind === 'file' || kind === 'field' || kind === 'data')) r.plan.unread.push(where)
}

function take(kind: Kind, value: Word, r: Reading, where: string) {
  const { plan } = r
  switch (kind) {
    case 'text':
      return message(value, r, where)
    case 'file': {
      if (value.text === '-') return void r.stdin++
      if (!value.dynamic) return void plan.files.push({ where, path: value.text })
      const e = expand(value.text, r)
      if (!e.unresolved) return void plan.files.push({ where, path: e.text })
      return fileOrUnread(value, plan, where)
    }
    case 'repo':
      plan.repo = value.text.split('/').pop()
      return
    case 'method':
      r.method = value.text.toUpperCase()
      return
    case 'branch':
      if (!value.dynamic) plan.branches.push(value.text)
      return
    case 'field': {
      const eq = value.text.indexOf('=')
      const v = eq === -1 ? '' : value.text.slice(eq + 1)
      if (v === '@-') return void r.stdin++
      if (v.startsWith('@')) return void plan.files.push({ where, path: v.slice(1) })
      return message({ ...value, text: v }, r, where)
    }
    case 'data':
      if (value.text === '@-') return void r.stdin++
      if (value.text.startsWith('@')) return void plan.files.push({ where, path: value.text.slice(1) })
      return message(value, r, where)
  }
}

const SUBSTITUTION = /\$\((?:[^()]|\([^()]*\))*\)/g

// A value with its variables replaced by what the command set them to; `unresolved` when any part is
// built at run time in a way the reading does not know.
function expand(text: string, r: Reading): { text: string; unresolved: boolean } {
  let unresolved = /\$\(|^[<>]?\(|@[({]/.test(text) || (!r.ps && text.includes('`'))
  const out = text.replace(SUBSTITUTION, ' ').replace(/\$\{?([A-Za-z_]\w*)\}?/g, (_, name: string) => {
    const v = r.vars.get(name.toLowerCase())
    if (v?.literal) return v.text
    unresolved = true
    return ' '
  })
  return { text: out, unresolved }
}

// A message value: literal text is checked; text built at run time is read where the reading can
// (a variable set earlier, a here-doc inside `$(cat <<'EOF' ... EOF)`, a `$(cat file)`) and named as
// unread otherwise. The value as typed is checked for credit too: a credit inside `$(echo '...')` or
// `$(printf ...)` is in the command text itself.
function message(value: Word, r: Reading, where: string) {
  const { plan } = r
  if (!value.dynamic) return void plan.texts.push({ where, text: value.text })
  for (const body of value.bodies) plan.texts.push({ where, text: body })
  plan.texts.push({ where, text: value.text, creditOnly: true })
  const e = expand(value.text, r)
  plan.texts.push({ where, text: e.text })
  if (e.unresolved) fileOrUnread(value, plan, where)
}

function fileOrUnread(value: Word, plan: Plan, where: string) {
  const cat =
    /(?:\$|^)\(\s*(?:cat|Get-Content|gc)(?:\s+-Raw)?\s+(?:"([^"$]+)"|'([^']+)'|([^\s)$]+))(?:\s+-Raw)?\s*\)/i.exec(
      value.text,
    )
  if (cat) return void plan.files.push({ where, path: (cat[1] ?? cat[2] ?? cat[3]) as string })
  if (value.bodies.length > 0) return
  plan.unread.push(where)
}
