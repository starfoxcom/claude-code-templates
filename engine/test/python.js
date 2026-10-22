// The full path of a Python 3.8+ interpreter, or undefined, for the tests that
// check the Python twins against the JS engine.
//
// It is found by a throwaway Node process. On Windows `python` is often an App
// Execution Alias, and once a process has started one, Node 20 aborts on its
// next start of an interpreter by full path (AssignProcessToJobObject: (87)).
// The test processes start interpreters by full path only.

import { spawnSync } from "node:child_process";

export const python = spawnSync(process.execPath, ["-e", `
  const { spawnSync } = require("node:child_process");
  for (const cmd of ["python", "python3"]) {
    const r = spawnSync(cmd, ["-c", "import sys; assert sys.version_info >= (3, 8); print(sys.executable)"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) { process.stdout.write(r.stdout.trim()); break; }
  }`], { encoding: "utf8" }).stdout || undefined;
