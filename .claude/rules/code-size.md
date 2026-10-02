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

| Language | File | Function | Line length |
|---|---|---|---|
| JavaScript / TypeScript | 400 / 800 | 50 / 100 | 100 / 120 |
| Python | 500 / 1 000 | 50 / 100 | 100 / 120 |

Values are soft / hard. Test files may run 1.5 times the file limit.

## Exceptions

1. Generated or vendored code: out of scope.
2. Declarative data (tables, schemas, translation files): no file limit.
3. Test batteries of many small cases: file limit only.
4. A hot loop kept in one function for measured performance: allowed past soft with a comment stating the measurement. Never past hard.

## Working the rule

New code meets the table from its first commit. A new file or function that would pass the hard limit is designed smaller before it lands: extract functions, split the file, flatten nesting with early returns. Existing code over the limit shrinks when it is next substantially changed, not in drive-by edits.
