import { readFileSync } from "node:fs";
import { splitBill } from "./split.ts";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm start <bill.json>");
  process.exit(1);
}

try {
  console.log(splitBill(readFileSync(file, "utf8")).text);
} catch (err) {
  console.error(`Could not split ${file}: ${(err as Error).message}`);
  process.exit(1);
}
