// What counts as heavy work on this PC. This is your list: edit it to match your projects and tools, and a
// save reloads the mod. It is one global list, so every session sees every project's rules.
//
// Checked per command segment (split on && || ; | and newlines outside quotes; leading VAR=x and
// PowerShell '&' dropped; the command word unquoted), case-insensitively. Light wins over heavy.
// Unmatched = light. `projects` is keyed by project folder name or absolute root and checked before the
// global lists. A command can also carry '# shared-pc: heavy' or '# shared-pc: light'.

export type RuleList = { light: readonly string[]; heavy: readonly string[] }

export const RULES: RuleList & { projects: Record<string, RuleList> } = {
  // Per-project rules, checked before the global lists below. Example (a made-up project):
  //
  //   'my-game': {
  //     heavy: [
  //       String.raw`^ctest\b`,              // the full native test suite
  //       String.raw`tools[\\/]perf[\\/]`,   // profiling scripts
  //       String.raw`start-runners\.cmd`,    // local CI runners
  //     ],
  //     light: [
  //       String.raw`^ctest\b.*(\s-R\s|--tests-regex)`, // one scoped test run
  //     ],
  //   },
  projects: {},
  light: [
    String.raw`^(git|gh|tokensave)\b`,
    String.raw`(^|\s)--(version|help)\b`,
    String.raw`^(flutter|dart)\s+test\s+\S+_test\.dart\s*$`,
    String.raw`^(flutter|dart)\s+analyze\s+\S+\.dart\s*$`,
    String.raw`^node\s+--test\s+\S+\.(c|m)?[jt]s\s*$`,
    String.raw`^(python3?\s+-m\s+)?pytest\s+\S+\.py(::\S+)?\s*$`,
    String.raw`^cargo\s+test\s+--test\s+\S+\s*$`,
  ],
  heavy: [
    String.raw`^(flutter|dart)\s+(test|build|run|drive|analyze|gen-l10n)\b`,
    String.raw`^dart\s+run\s+build_runner\b`,
    String.raw`--update-goldens\b`,
    String.raw`(^|[\\/])godot[\w.-]*(\.exe)?(\s|$)`,
    String.raw`^cargo\s+(build|test|run|bench|clippy)\b`,
    String.raw`^(npm|pnpm|yarn|bun)\s+(run\s+)?(build|test|bench|e2e|ci)\b`,
    String.raw`^node\s+--test\b`,
    String.raw`^(\.[\\/])?gradlew?(\.bat)?\b`,
    String.raw`^cmake\s+--build\b`,
    String.raw`^(make|ninja|msbuild|xcodebuild)\b`,
    String.raw`^dotnet\s+(build|test|run|publish)\b`,
    String.raw`^go\s+(build|test)\b`,
    String.raw`^(python3?\s+-m\s+)?pytest\b`,
    String.raw`^act\b`,
  ],
}

// The light and heavy lists in force for a project root: its own first, then the global ones.
export function rulesFor(root: string): RuleList {
  const folder = (root.split(/[\\/]/).filter(Boolean).pop() ?? '').toLowerCase()
  const normalRoot = root.replace(/\\/g, '/').toLowerCase()
  const key = Object.keys(RULES.projects).find(
    k => k.toLowerCase() === folder || k.replace(/\\/g, '/').toLowerCase() === normalRoot,
  )
  const own = (key && RULES.projects[key]) || { light: [], heavy: [] }
  return { light: [...own.light, ...RULES.light], heavy: [...own.heavy, ...RULES.heavy] }
}
