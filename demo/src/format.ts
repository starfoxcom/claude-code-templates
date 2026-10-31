export type Currency = { symbol: string; decimals: number };

// "$12.30", "¥1,200": the symbol, then the amount with thousands separators.
export function formatMoney(amount: number, currency: Currency): string {
  const fixed = Math.abs(amount).toFixed(currency.decimals);
  const [whole, cents] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = amount < 0 ? "-" : "";
  return `${sign}${currency.symbol}${cents ? `${grouped}.${cents}` : grouped}`;
}

// One line per person, names padded so the amounts line up.
export function formatTable(rows: [string, string][]): string {
  const width = Math.max(0, ...rows.map(([name]) => name.length));
  return rows.map(([name, amount]) => `${name.padEnd(width)}  ${amount}`).join("\n");
}
