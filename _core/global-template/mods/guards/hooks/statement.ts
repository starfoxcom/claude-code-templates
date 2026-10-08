// The shapes the shell reading hands on: a word as its program receives it, and a statement with its
// words, redirects, bodies and where it runs.

export type Word = {
  /** The word as the program receives it: quotes removed, escapes applied. */
  text: string
  /** Holds an expansion ($VAR, $(...), backticks) whose value the reading cannot know. */
  dynamic: boolean
  /** Here-doc bodies written inside a `$(...)` of this word: `-m "$(cat <<'EOF' ... EOF)"`. */
  bodies: string[]
  /** Its first character came from quotes or an escape, so a leading `<` or `>` is text, not a redirect;
   * `quotedStart` when from quotes (`'`, `"`, a here-string, `$'`), so it is a value, never a command. */
  literalStart?: boolean
  quotedStart?: boolean
  /** Holds an expansion outside quotes, which the shell splits into words at blanks (`$F`, not `"$F"`). */
  splits?: boolean
  /** PowerShell: holds a comma outside quotes, so it is a list, passed to a program as several arguments. */
  list?: boolean
  /** PowerShell: an expression PowerShell computes (`'--x'.Trim()`, `$o.Trim()`, `[string]'x'`), so its
   * value is unknown. */
  expr?: boolean
  /** PowerShell: holds a quoted part, so an unquoted character after it makes the word an expression. */
  quoted?: boolean
  /** Where in `text` a `$` or a backtick was typed as plain text (in single quotes, or escaped): the shell
   * passes it on as is, so it starts no expansion. */
  literals?: number[]
}

export type Statement = {
  words: Word[]
  /** Here-doc, here-string and `<<<` bodies fed to this statement. */
  heredocs: string[]
  /** Files this statement writes through `>` / `>>`. */
  writes: string[]
  /** The word of each `writes` entry that holds an expansion, at the same index; none for a literal one. */
  writeWords?: (Word | undefined)[]
  /** Files fed to this statement through `<`. */
  reads: string[]
  /** The word of each `reads` entry that holds an expansion, at the same index. */
  readWords?: (Word | undefined)[]
  /** Its input comes from the statement before it, through a pipe. */
  pipeIn: boolean
  /** Commands run inside a `$(...)` of its words (`PR=$(gh pr create ...)`); they run before it. */
  inner: Statement[]
  /** A body holds an expansion the shell fills in at run time (`<<< "$MSG"`, an unquoted `<<EOF`). */
  hasDynamicBody?: boolean
  /** Inside a `( )` subshell or a PowerShell `{ }` block: a `cd` there may not move what follows. */
  isNested?: boolean
  /** Where it runs, outermost first (`1/c3`); none at the top. A number is a Bash subshell (a `( )`, a
   * pipeline part, a job sent to the background): what it sets is gone once it closes. `c<n>` is a branch
   * that may not run (an `if` or `case` arm, a loop body, the part after `&&` or `||`, a function body, a
   * PowerShell block): what it sets is known inside it, and unknown where the branch sits. */
  scope?: string
  /** For a statement inside a `$(...)` or backticks: which one, numbered within its parse. */
  group?: number
  /** PowerShell: run through the call operator (`& $git commit`), or dot-sourced (`. $git commit`). */
  isCall?: boolean
  /** PowerShell: dot-sourced, so what it runs sets variables in this scope. */
  isSourced?: boolean
  /** In a function body, a `trap` action or a PowerShell script block: it may run at any later point, so a
   * value it sets leaves the name unknown from then on. */
  isDeferred?: boolean
  /** In a loop body or a loop's own condition: it may run again after a statement that follows it, with
   * the value that statement sets. */
  isLooped?: boolean
}
