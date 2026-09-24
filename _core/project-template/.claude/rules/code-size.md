---
paths:
  - "**/*.{js,jsx,ts,tsx,mjs,cjs,py,go,rs,java,kt,kts,cs,c,cc,cpp,h,hpp,swift,dart,rb,php,gd,lua,ex,exs,scala}"
---

# Code size

Soft limit: the reviewer mentions it, nothing is owed. Hard limit: a blocking finding unless the code falls under an exception below. Lines are physical lines including blanks and comments; a function counts from its signature to its closing brace.

## Every language

| Construct | Soft | Hard |
|---|---|---|
| Nesting depth | 4 | 6 |
| Parameters | 5 | 8 |
| Cyclomatic complexity per function | 15 | 25 |
| Inline lambda or closure | 15 lines | 40 lines |

## Per language

Keep the rows for this project's languages and delete the rest.

| Language | File | Function | Line length |
|---|---|---|---|
| C / C++ | 800 (.h 400) / 1 500 (.h 800) | 60 / 150 | 100 / 120 |
| C# / Java / Kotlin | 600 / 1 200 | 50 / 100 | 100 / 120 |
| Dart | 600 / 1 200 (build method 80 / 150) | 50 / 100 | 80 / 120 |
| GDScript | 600 / 1 200 | 40 / 80 | 100 / 120 |
| Go | 800 / 1 500 | 60 / 120 | 100 / 120 |
| JavaScript / TypeScript | 400 / 800 | 50 / 100 | 100 / 120 |
| Python | 500 / 1 000 | 50 / 100 | 100 / 120 |
| Rust | 800 / 1 500 | 60 / 120 | 100 / 120 |
| Other | 600 / 1 200 | 50 / 100 | 100 / 120 |

Values are soft / hard. Test files may run 1.5 times the file limit.

## Exceptions

1. Generated or vendored code: out of scope.
2. Declarative data (tables, schemas, translation files): no file limit.
3. Test batteries of many small cases: file limit only.
4. A hot loop kept in one function for measured performance: allowed past soft with a comment stating the measurement. Never past hard.

## Working the rule

New code meets the table from its first commit. A new file or function that would pass the hard limit is designed smaller before it lands: extract functions, split the file, flatten nesting with early returns. Existing code over the limit shrinks when it is next substantially changed, not in drive-by edits.
