// Turns one Bash or PowerShell command into what the guards must check: the message texts it writes
// to history, the body files it hands over, the branches it creates, and whether a commit's added
// lines need a look. Pure, no engine access.

import { parse, programOf } from './shell'
import type { Statement, Word } from './shell'

export type Plan = {
  /** Message text with where it goes ("the commit message", "the PR body"). */
  texts: { where: string; text: string }[]
  /** Body files the command hands to git or gh, as written (relative to `cwd` when not absolute). */
  files: { where: string; path: string }[]
  /** Files the command itself writes (`> file`): a body file among them is read from the command text. */
  written: string[]
  branches: string[]
  /** A commit runs: `cached` checks the staged lines, `all` the working tree's too (`-a`, pathspecs). */
  diff: 'cached' | 'all' | null
  /** Message values built at run time ($VAR, $(...)) the guard cannot read. */
  unread: string[]
  /** `gh --repo owner/name` when given. */
  repo?: string
  /** Where relative paths resolve: a leading `cd` or `git -C`. */
  cwd?: string
  block?: string
  isWrite: boolean
}

type Kind = 'text' | 'file' | 'skip' | 'repo' | 'branch' | 'field' | 'data'
type Spec = Record<string, Kind>

const COMMIT: Spec = {
  '-m': 'text', '--message': 'text', '-F': 'file', '--file': 'file', '-t': 'file', '--template': 'file',
  '-C': 'skip', '-c': 'skip', '--reuse-message': 'skip', '--reedit-message': 'skip', '--fixup': 'skip',
  '--squash': 'skip', '--author': 'text', '--date': 'skip', '--trailer': 'text', '--cleanup': 'skip',
}
const MESSAGE: Spec = { '-m': 'text', '--message': 'text', '-F': 'file', '--file': 'file' }
const GH_BODY: Spec = {
  '-t': 'text', '--title': 'text', '-b': 'text', '--body': 'text', '-F': 'file', '--body-file': 'file',
  '-R': 'repo', '--repo': 'repo', '-T': 'skip', '--template': 'skip', '-B': 'skip', '--base': 'skip',
  '-H': 'skip', '--head': 'skip', '-a': 'skip', '--assignee': 'skip', '-l': 'skip', '--label': 'skip',
  '-m': 'skip', '--milestone': 'skip', '-p': 'skip', '--project': 'skip', '-r': 'skip', '--reviewer': 'skip',
  '--add-label': 'skip', '--remove-label': 'skip', '--comment': 'text',
}
// Subcommands whose short flags mean something else: a boolean read as value-taking would swallow the
// next word (`gh pr review 5 -a -b '<text>'` would hide the body), so each gets its own table. Flags
// absent from a table are read as booleans.
const GH_REVIEW: Spec = {
  '-b': 'text', '--body': 'text', '-F': 'file', '--body-file': 'file', '-R': 'repo', '--repo': 'repo',
}
const GH_MERGE: Spec = {
  '-b': 'text', '--body': 'text', '-F': 'file', '--body-file': 'file', '-t': 'text', '--subject': 'text',
  '-A': 'skip', '--author-email': 'skip', '--match-head-commit': 'skip', '-R': 'repo', '--repo': 'repo',
}
const GH_CLOSE: Spec = {
  '-c': 'text', '--comment': 'text', '-r': 'skip', '--reason': 'skip', '-R': 'repo', '--repo': 'repo',
}
const GH_RELEASE: Spec = {
  '-t': 'text', '--title': 'text', '-n': 'text', '--notes': 'text', '-F': 'file', '--notes-file': 'file',
  '-R': 'repo', '--repo': 'repo', '--target': 'skip',
}
const GH_DESC: Spec = { '-d': 'text', '--desc': 'text', '--description': 'text', '-R': 'repo', '--repo': 'repo' }
const GH_API: Spec = {
  '-f': 'field', '--raw-field': 'field', '-F': 'field', '--field': 'field', '--input': 'file',
  '-X': 'skip', '--method': 'skip', '-H': 'skip', '--header': 'skip', '--jq': 'skip', '-q': 'skip',
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
  const statements = parse(command, powershell)
  for (const st of statements) {
    plan.written.push(...st.writes)
    const { name, args } = programOf(st)
    if ((name === 'cd' || name === 'set-location' || name === 'pushd' || name === 'sl') && !plan.cwd) {
      plan.cwd = args.find(a => !a.text.startsWith('-'))?.text
      continue
    }
    if (name === 'git') git(st, args, plan)
    else if (name === 'gh') gh(st, args, plan)
    else if (name === 'curl' && args.some(a => a.text.includes('api.github.com'))) {
      write(plan, st, 'the GitHub API call')
      walk(args, CURL, plan, 'the GitHub API call')
    } else if (/^(invoke-restmethod|invoke-webrequest|irm|iwr)$/.test(name) && args.some(a => a.text.includes('api.github.com'))) {
      write(plan, st, 'the GitHub API call')
      walk(args.map(a => ({ ...a, text: a.text.startsWith('-') ? a.text.toLowerCase() : a.text })), PS_WEB, plan, 'the GitHub API call')
    }
  }
  return plan
}

// A write statement: its here-doc bodies are message text (a `--body-file -` or `-F -` reads them).
function write(plan: Plan, st: Statement, where: string) {
  plan.isWrite = true
  for (const body of st.heredocs) plan.texts.push({ where, text: body })
}

function git(st: Statement, args: Word[], plan: Plan) {
  let k = 0
  while (k < args.length) {
    const t = args[k]?.text ?? ''
    if (t === '-C') {
      plan.cwd ??= args[k + 1]?.text
      k += 2
    } else if (t === '-c' || t === '--git-dir' || t === '--work-tree' || t === '--namespace') k += 2
    else if (t.startsWith('-')) k++
    else break
  }
  const sub = args[k]?.text ?? ''
  const rest = args.slice(k + 1)
  switch (sub) {
    case 'commit': {
      write(plan, st, 'the commit message')
      const positional = walk(rest, COMMIT, plan, 'the commit message')
      const all = rest.some(a => a.text === '--all' || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(a.text) && !a.text.startsWith('--'))
      plan.diff = all || positional.length > 0 ? 'all' : (plan.diff ?? 'cached')
      return
    }
    case 'tag':
    case 'merge':
    case 'commit-tree':
      write(plan, st, `the ${sub} message`)
      walk(rest, MESSAGE, plan, `the ${sub} message`)
      return
    case 'notes':
      write(plan, st, 'the git note')
      walk(rest.slice(1), MESSAGE, plan, 'the git note')
      return
    case 'checkout':
      walk(rest, { '-b': 'branch', '-B': 'branch' }, plan, '')
      return
    case 'switch':
      walk(rest, { '-c': 'branch', '-C': 'branch', '--create': 'branch', '--force-create': 'branch' }, plan, '')
      return
    case 'worktree':
      if (rest[0]?.text === 'add') walk(rest.slice(1), { '-b': 'branch', '-B': 'branch' }, plan, '')
      return
    case 'branch': {
      const flags = rest.filter(a => a.text.startsWith('-')).map(a => a.text)
      const names = rest.filter(a => !a.text.startsWith('-')).map(a => a.text)
      if (flags.some(f => /^-(m|M|c|C)$|^--(move|copy)$/.test(f))) plan.branches.push(...names.slice(-1))
      else if (!flags.some(f => /^-[dDlarvu]|^--(delete|list|all|remotes|show-current|contains|merged|no-merged|set-upstream|unset-upstream|edit-description)/.test(f)))
        plan.branches.push(...names.slice(0, 1))
      return
    }
  }
}

function gh(st: Statement, args: Word[], plan: Plan) {
  const words = args.filter(a => !/^(-R|--repo)$/.test(a.text))
  const [group = '', action = ''] = words.filter(a => !a.text.startsWith('-')).map(a => a.text)
  if (group === 'run' && action === 'watch') {
    plan.block =
      '`gh run watch` streams a live log into the tool call. Watch checks with the ci-watch mod (it starts on push), or the Monitor tool when that mod is not loaded.'
    return
  }
  if (group === 'api') {
    const before = plan.files.length + plan.texts.length
    const method = args.find((a, i) => /^(-X|--method)$/.test(args[i - 1]?.text ?? '') && a)?.text.toUpperCase()
    walk(args.slice(1), GH_API, plan, 'the GitHub API call')
    const hasFields = plan.files.length + plan.texts.length > before
    if (hasFields || /^(POST|PATCH|PUT)$/.test(method ?? '')) write(plan, st, 'the GitHub API call')
    return
  }
  if (!GH_WRITES[group]?.includes(action)) {
    walk(args, { '-R': 'repo', '--repo': 'repo' }, plan, '')
    return
  }
  const where = `the ${group === 'pr' ? 'PR' : group} ${action === 'create' ? 'text' : action}`
  write(plan, st, where)
  const spec =
    group === 'release' ? GH_RELEASE
    : group === 'gist' || group === 'repo' ? GH_DESC
    : group === 'pr' && action === 'review' ? GH_REVIEW
    : group === 'pr' && action === 'merge' ? GH_MERGE
    : action === 'close' || action === 'reopen' ? GH_CLOSE
    : GH_BODY
  walk(args.slice(2), spec, plan, where)
}

// Reads options by the spec; returns the positional words. Short flags may be bundled (`-am "msg"`)
// or carry their value attached (`-m"msg"`, `-Fbody.md`); long ones may use `=`.
function walk(args: Word[], spec: Spec, plan: Plan, where: string): Word[] {
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
      if (!kind) continue
      const value = eq === -1 ? args[++i] : { ...w, text: t.slice(eq + 1) }
      if (value) take(kind, value, plan, where)
      continue
    }
    if (t.startsWith('-') && t.length > 1 && !w.dynamic) {
      if (spec[t]) {
        const value = args[++i]
        if (value) take(spec[t] as Kind, value, plan, where)
        continue
      }
      // A bundle: the first letter that takes a value takes the rest of the word, or the next word.
      for (let j = 1; j < t.length; j++) {
        const kind = spec[`-${t[j]}`]
        if (!kind) continue
        const attached = t.slice(j + 1)
        const value = attached ? { ...w, text: attached } : args[++i]
        if (value) take(kind, value, plan, where)
        break
      }
      continue
    }
    positional.push(w)
  }
  return positional
}

function take(kind: Kind, value: Word, plan: Plan, where: string) {
  switch (kind) {
    case 'text':
      return message(value, plan, where)
    case 'file':
      if (value.text === '-') return
      if (value.dynamic) return fileOrUnread(value, plan, where)
      return void plan.files.push({ where, path: value.text })
    case 'repo':
      plan.repo = value.text.split('/').pop()
      return
    case 'branch':
      if (!value.dynamic) plan.branches.push(value.text)
      return
    case 'field': {
      const eq = value.text.indexOf('=')
      const v = eq === -1 ? '' : value.text.slice(eq + 1)
      if (v.startsWith('@')) {
        if (v !== '@-') plan.files.push({ where, path: v.slice(1) })
        return
      }
      return message({ ...value, text: v }, plan, where)
    }
    case 'data':
      if (value.text.startsWith('@')) return void plan.files.push({ where, path: value.text.slice(1) })
      return message(value, plan, where)
  }
}

// A message value: literal text is checked; text built at run time is read where the reading can
// (a here-doc inside `$(cat <<'EOF' ... EOF)`, a `$(cat file)`) and named as unread otherwise.
function message(value: Word, plan: Plan, where: string) {
  if (!value.dynamic) return void plan.texts.push({ where, text: value.text })
  for (const body of value.bodies) plan.texts.push({ where, text: body })
  const literal = value.text.replace(/\$\((?:[^()]|\([^()]*\))*\)/g, ' ').replace(/\$\{?\w+\}?/g, ' ')
  plan.texts.push({ where, text: literal })
  fileOrUnread(value, plan, where)
}

function fileOrUnread(value: Word, plan: Plan, where: string) {
  const cat = /\$\(\s*(?:cat|Get-Content(?:\s+-Raw)?)\s+(?:"([^"$]+)"|'([^']+)'|([^\s)$]+))\s*\)/.exec(value.text)
  if (cat) return void plan.files.push({ where, path: (cat[1] ?? cat[2] ?? cat[3]) as string })
  if (value.bodies.length > 0) return
  const rest = value.text.replace(/\$\(\s*cat\s+<<[\s\S]*$/, '')
  if (/\$\(|\$\{?\w|`/.test(rest)) plan.unread.push(where)
}
