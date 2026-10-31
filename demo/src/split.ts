import { readFileSync } from "node:fs";

type Item = { name: string; price: number; people: string[] };
type Bill = { currency: string; tipPercent: number; items: Item[] };

export type Split = { shares: Record<string, number>; total: number; text: string };

// Reads a bill (JSON text) and works out what each person owes, tip included.
export function splitBill(json: string): Split {
  let bill: Bill;
  try {
    bill = JSON.parse(json);
  } catch {
    throw new Error("the bill is not valid JSON");
  }
  if (typeof bill !== "object" || bill === null) {
    throw new Error("the bill must be an object");
  }
  if (!Array.isArray(bill.items) || bill.items.length === 0) {
    throw new Error("the bill has no items");
  }
  if (typeof bill.tipPercent !== "number" || bill.tipPercent < 0) {
    throw new Error("tipPercent must be a number of 0 or more");
  }

  const table = JSON.parse(readFileSync(new URL("../data/currencies.json", import.meta.url), "utf8"));
  const currency = table[bill.currency];
  if (!currency) {
    throw new Error(`unknown currency ${bill.currency}`);
  }

  const subtotals: Record<string, number> = {};
  let subtotal = 0;
  for (const item of bill.items) {
    if (typeof item.price !== "number" || item.price < 0) {
      throw new Error(`${item.name} has no valid price`);
    }
    if (!Array.isArray(item.people) || item.people.length === 0) {
      throw new Error(`nobody had ${item.name}`);
    }
    subtotal += item.price;
    const each = item.price / item.people.length;
    for (const person of item.people) {
      subtotals[person] = (subtotals[person] ?? 0) + each;
    }
  }

  const factor = 10 ** currency.decimals;
  const tip = 1 + bill.tipPercent / 100;
  const total = Math.round(subtotal * tip * factor) / factor;
  const shares: Record<string, number> = {};
  for (const person of Object.keys(subtotals)) {
    shares[person] = Math.round(subtotals[person] * tip * factor) / factor;
  }

  const names = Object.keys(shares).sort();
  let width = 0;
  for (const name of names) {
    if (name.length > width) width = name.length;
  }
  const lines: string[] = [];
  for (const name of names) {
    const amount = shares[name].toFixed(currency.decimals);
    lines.push(`${name.padEnd(width)}  ${currency.symbol}${amount}`);
  }
  lines.push("");
  lines.push(`Total (with ${bill.tipPercent}% tip): ${currency.symbol}${total.toFixed(currency.decimals)}`);

  return { shares, total, text: lines.join("\n") };
}
