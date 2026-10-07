// How each git, gh and web-call option is read: the flag tables the command reading walks, the raw write
// patterns, and git's long-option names with the lookup of a shortened one. Declarative data, and that lookup.

// `attached`: a flag whose value can only be attached (`-S<keyid>`, `--gpg-sign=<keyid>`); it never takes
// the next word, and in a bundle the rest of the word is its value.
export type Kind = 'text' | 'file' | 'skip' | 'repo' | 'branch' | 'field' | 'data' | 'method' | 'attached'
export type Spec = Record<string, Kind>

export const COMMIT: Spec = {
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
export const MESSAGE: Spec = { '-m': 'text', '--message': 'text', '-F': 'file', '--file': 'file' }
// `git notes add`: `-C` and `-c` take the note from another object, refused as a reuse.
export const NOTES: Spec = {
  ...MESSAGE,
  '-C': 'skip',
  '-c': 'skip',
  '--reuse-message': 'skip',
  '--reedit-message': 'skip',
}
// `git switch`: the options that name a new branch.
export const SWITCH: Spec = {
  '-c': 'branch',
  '-C': 'branch',
  '--create': 'branch',
  '--force-create': 'branch',
  '--orphan': 'branch',
}
export const GH_BODY: Spec = {
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
export const GH_REVIEW: Spec = {
  '-b': 'text',
  '--body': 'text',
  '-F': 'file',
  '--body-file': 'file',
  '-R': 'repo',
  '--repo': 'repo',
}
export const GH_MERGE: Spec = {
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
export const GH_CLOSE: Spec = {
  '-c': 'text',
  '--comment': 'text',
  '-r': 'skip',
  '--reason': 'skip',
  '-R': 'repo',
  '--repo': 'repo',
}
export const GH_RELEASE: Spec = {
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
export const GH_DESC: Spec = { '-d': 'text', '--desc': 'text', '--description': 'text', '-R': 'repo', '--repo': 'repo' }
export const GH_API: Spec = {
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
export const CURL: Spec = { '-d': 'data', '--data': 'data', '--data-raw': 'data', '--data-binary': 'data' }
export const PS_WEB: Spec = { '-body': 'text', '-infile': 'file' }

// git reads a long option written as any start of its name that names no other option (`--no-verif`,
// `--mess`, `--rem`). Each subcommand's long options, as `git <sub> --git-completion-helper` lists them
// (git 2.53); `config` is its classic form, with the verbs of git 2.46+ (`config set`) under their own.
const GIT_OPTIONS: Record<string, string> = {
  commit:
    'quiet verbose file author date message reedit-message reuse-message fixup squash reset-author trailer ' +
    'signoff template edit cleanup status gpg-sign all include interactive patch unified inter-hunk-context ' +
    'only no-verify dry-run short branch ahead-behind porcelain long null amend no-post-rewrite ' +
    'untracked-files pathspec-from-file pathspec-file-nul allow-empty allow-empty-message verify post-rewrite ' +
    'no-quiet no-verbose no-file no-author no-date no-message no-reedit-message no-reuse-message no-fixup ' +
    'no-squash no-reset-author no-signoff no-template no-edit no-cleanup no-status no-gpg-sign no-all ' +
    'no-include no-interactive no-patch no-only no-dry-run no-short no-branch no-ahead-behind no-porcelain ' +
    'no-long no-null no-amend no-untracked-files no-pathspec-from-file no-pathspec-file-nul no-allow-empty ' +
    'no-allow-empty-message',
  tag:
    'list delete verify annotate message file trailer edit sign cleanup local-user force create-reflog column ' +
    'contains no-contains with without merged no-merged omit-empty sort points-at format color ignore-case ' +
    'no-annotate no-file no-edit no-sign no-cleanup no-local-user no-force no-create-reflog no-column ' +
    'no-omit-empty no-sort no-points-at no-format no-color no-ignore-case',
  merge:
    'stat summary compact-summary log squash commit edit cleanup ff ff-only rerere-autoupdate ' +
    'verify-signatures strategy strategy-option message file into-name verbose quiet abort quit continue ' +
    'allow-unrelated-histories progress gpg-sign autostash overwrite-ignore signoff no-verify verify no-stat ' +
    'no-summary no-compact-summary no-log no-squash no-commit no-edit no-cleanup no-ff no-rerere-autoupdate ' +
    'no-verify-signatures no-strategy no-strategy-option no-message no-into-name no-verbose no-quiet ' +
    'no-abort no-quit no-continue no-allow-unrelated-histories no-progress no-gpg-sign no-autostash ' +
    'no-overwrite-ignore no-signoff',
  push:
    'verbose quiet repo all branches mirror delete tags dry-run porcelain force force-with-lease ' +
    'force-if-includes recurse-submodules thin receive-pack exec set-upstream progress prune no-verify ' +
    'follow-tags signed atomic push-option ipv4 ipv6 verify no-verbose no-quiet no-repo no-all no-branches ' +
    'no-mirror no-delete no-tags no-dry-run no-porcelain no-force no-force-with-lease no-force-if-includes ' +
    'no-recurse-submodules no-thin no-receive-pack no-exec no-set-upstream no-progress no-prune ' +
    'no-follow-tags no-signed no-atomic no-push-option',
  rebase:
    'onto keep-base no-verify quiet verbose no-stat signoff committer-date-is-author-date reset-author-date ' +
    'ignore-whitespace whitespace force-rebase no-ff continue skip abort quit edit-todo show-current-patch ' +
    'apply merge interactive rerere-autoupdate empty autosquash update-refs gpg-sign autostash exec ' +
    'rebase-merges fork-point strategy strategy-option root reschedule-failed-exec reapply-cherry-picks ' +
    'verify stat ff no-onto no-keep-base no-quiet no-verbose no-signoff no-committer-date-is-author-date ' +
    'no-reset-author-date no-ignore-whitespace no-whitespace no-force-rebase no-rerere-autoupdate ' +
    'no-autosquash no-update-refs no-gpg-sign no-autostash no-exec no-rebase-merges no-fork-point ' +
    'no-strategy no-strategy-option no-root no-reschedule-failed-exec no-reapply-cherry-picks',
  am:
    'interactive no-verify 3way quiet signoff utf8 keep keep-non-patch message-id keep-cr scissors quoted-cr ' +
    'whitespace ignore-space-change ignore-whitespace directory exclude include patch-format reject ' +
    'resolvemsg continue resolved skip abort quit show-current-patch retry allow-empty ' +
    'committer-date-is-author-date ignore-date rerere-autoupdate gpg-sign empty verify no-interactive ' +
    'no-3way no-quiet no-signoff no-utf8 no-keep no-keep-non-patch no-message-id no-keep-cr no-scissors ' +
    'no-whitespace no-ignore-space-change no-ignore-whitespace no-directory no-exclude no-include ' +
    'no-patch-format no-reject no-resolvemsg no-committer-date-is-author-date no-ignore-date ' +
    'no-rerere-autoupdate no-gpg-sign',
  'cherry-pick':
    'quit continue abort skip cleanup no-commit edit signoff mainline rerere-autoupdate strategy ' +
    'strategy-option gpg-sign ff allow-empty allow-empty-message keep-redundant-commits empty commit ' +
    'no-cleanup no-edit no-signoff no-mainline no-rerere-autoupdate no-strategy no-strategy-option ' +
    'no-gpg-sign no-ff no-allow-empty no-allow-empty-message no-keep-redundant-commits',
  revert:
    'quit continue abort skip cleanup no-commit edit signoff mainline rerere-autoupdate strategy ' +
    'strategy-option gpg-sign reference commit no-cleanup no-edit no-signoff no-mainline ' +
    'no-rerere-autoupdate no-strategy no-strategy-option no-gpg-sign no-reference',
  notes:
    'message file reedit-message edit reuse-message allow-empty separator stripspace no-edit no-allow-empty ' +
    'no-separator no-stripspace',
  config:
    'global system local worktree file blob get get-all get-regexp get-urlmatch replace-all add unset ' +
    'unset-all rename-section remove-section list edit get-color get-colorbool null name-only show-origin ' +
    'show-scope show-names type bool int bool-or-int bool-or-str path expiry-date default comment ' +
    'fixed-value includes no-global no-system no-local no-worktree no-file no-blob no-null no-name-only ' +
    'no-show-origin no-show-scope no-show-names no-type no-default no-comment no-fixed-value no-includes',
  'config set':
    'global system local worktree file blob type bool int bool-or-int bool-or-str path expiry-date all ' +
    'value fixed-value comment append no-global no-system no-local no-worktree no-file no-blob no-type ' +
    'no-all no-value no-fixed-value no-comment no-append',
  'config unset':
    'global system local worktree file blob all value fixed-value no-global no-system no-local ' +
    'no-worktree no-file no-blob no-all no-value no-fixed-value',
  switch:
    'create force-create guess discard-changes quiet recurse-submodules progress merge conflict detach ' +
    'track orphan ignore-other-worktrees no-create no-force-create no-guess no-discard-changes no-quiet ' +
    'no-recurse-submodules no-progress no-merge no-conflict no-detach no-track no-orphan ' +
    'no-ignore-other-worktrees',
  checkout:
    'guess overlay quiet recurse-submodules progress merge conflict detach track orphan ' +
    'ignore-other-worktrees ours theirs patch unified inter-hunk-context ignore-skip-worktree-bits ' +
    'pathspec-from-file pathspec-file-nul no-guess no-overlay no-quiet no-recurse-submodules no-progress ' +
    'no-merge no-conflict no-detach no-track no-orphan no-ignore-other-worktrees no-patch ' +
    'no-ignore-skip-worktree-bits no-pathspec-from-file no-pathspec-file-nul',
  branch:
    'verbose quiet track set-upstream-to unset-upstream color remotes contains no-contains abbrev all delete ' +
    'move omit-empty copy list show-current create-reflog edit-description merged no-merged column sort ' +
    'points-at ignore-case recurse-submodules format no-verbose no-quiet no-track no-set-upstream-to ' +
    'no-unset-upstream no-color no-abbrev no-delete no-move no-omit-empty no-copy no-list no-show-current ' +
    'no-create-reflog no-edit-description no-column no-sort no-points-at no-ignore-case ' +
    'no-recurse-submodules no-format',
}
const GIT_LONG = new Map(Object.entries(GIT_OPTIONS).map(([sub, names]) => [sub, names.split(' ')]))

/** A git long option as git reads it: the option written out in full when `text` starts its name and no
 * other's, with its `=value`. Anything else is returned as written. `sub`: the subcommand, or a
 * `config` verb (`config set`). */
export function gitLong(sub: string, text: string): string {
  const names = GIT_LONG.get(sub)
  if (!names || !text.startsWith('--') || text === '--') return text
  const eq = text.indexOf('=')
  const name = text.slice(2, eq === -1 ? undefined : eq)
  if (names.includes(name)) return text
  const matches = names.filter(n => n.startsWith(name))
  return matches.length === 1 ? `--${matches[0]}${eq === -1 ? '' : text.slice(eq)}` : text
}

// The shipped no-ai-attribution hook's write patterns (`_core/global-template/hooks/no-ai-attribution.py`),
// matched on the raw command text, plus the history rewrites. A `gh api` call counts only with a writing
// method or fields: a read reaches no history. `REST`: the rest of the same command, up to a separator or
// a line end.
const REST = String.raw`[^|;&\n]*?`
const GIT_WRITES = 'commit|merge|push|tag|notes|am|cherry-pick|revert|rebase|filter-branch|filter-repo|replace'
const GH_NOUNS = 'pr|issue|release|gist|repo'
const GH_VERBS = 'create|edit|comment|review|merge|close|reopen'
// A writing method, or a field: a field flag counts spaced (`-f body=x`) or attached (`-fbody=x`), as gh
// reads both.
const API_METHOD = String.raw`(?:-X|--method)[\s=]*(?:POST|PATCH|PUT|DELETE)`
const API_WRITE = String.raw`${API_METHOD}|(?<=\s)-[fF](?:\s|\S*=)|--field|--raw-field|--input`
export const RAW_WRITES = [
  String.raw`\bgit\b${REST}\b(?:${GIT_WRITES})\b`,
  String.raw`\bgh\b${REST}\b(?:${GH_NOUNS})\b${REST}\b(?:${GH_VERBS})\b`,
  String.raw`\bgh\b${REST}\bapi\b(?=${REST}(?:${API_WRITE}))`,
  String.raw`\b(?:curl|Invoke-(?:RestMethod|WebRequest))\b${REST}api\.github\.com`,
].map(source => new RegExp(source, 'i'))

export const GH_WRITES: Record<string, string[]> = {
  pr: ['create', 'edit', 'comment', 'review', 'merge', 'close', 'reopen'],
  issue: ['create', 'edit', 'comment', 'close', 'reopen'],
  release: ['create', 'edit'],
  gist: ['create', 'edit'],
  repo: ['create', 'edit'],
}

// A hashtable typed in full: each key a name or a quoted string, each value a quoted string with nothing
// to fill in, a number, or `$true`, `$false` or `$null`. Any other value runs at run time.
// A double-quoted string may escape with a backtick (`` `n ``, `` `$ ``) or double its quote; a here-string
// starts its text on the next line.
const DOUBLE = String.raw`"(?:[^"$\x60]|\x60[\s\S]|"")*"`
const HERE = String.raw`@'[ \t]*\r?\n[\s\S]*?\n'@|@"[ \t]*\r?\n(?:[^$\x60]|\x60[\s\S])*?\n"@`
const TYPED_KEY = String.raw`(?:\w+|'[^']*'|${DOUBLE})`
const TYPED_VALUE = String.raw`(?:'(?:[^']|'')*'|${DOUBLE}|${HERE}|-?\d+(?:\.\d+)?|\$(?:true|false|null))`
const TYPED_ENTRY = String.raw`${TYPED_KEY}\s*=\s*${TYPED_VALUE}`
const TYPED_ENTRIES = String.raw`(?:${TYPED_ENTRY}(?:\s*[;\n]\s*${TYPED_ENTRY})*)?`
export const TYPED_TABLE = new RegExp(String.raw`^@\{\s*${TYPED_ENTRIES}\s*;?\s*\}$`, 'i')
