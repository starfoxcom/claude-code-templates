import { test } from "node:test";
import assert from "node:assert/strict";
import { splitBill } from "../src/split.ts";

test("splits a bill with tip", () => {
  const bill = {
    currency: "USD",
    tipPercent: 20,
    items: [{ name: "Pizza", price: 30, people: ["Ana", "Ben"] }],
  };
  // Work out the expected share the same way the app does.
  const expected = Math.round((30 / 2) * (1 + 20 / 100) * 100) / 100;
  const result = splitBill(JSON.stringify(bill));
  assert.equal(result.shares.Ana, expected);
  assert.equal(result.shares.Ben, expected);
});

test("prints a line per person", () => {
  const bill = { currency: "USD", tipPercent: 0, items: [{ name: "Tea", price: 3, people: ["Cruz"] }] };
  assert.match(splitBill(JSON.stringify(bill)).text, /Cruz {2}\$3\.00/);
});
