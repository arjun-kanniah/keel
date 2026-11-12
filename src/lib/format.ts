// Formatting shared by the server (tool results, audit text) and the browser.

export function money(cents: number): string {
  const d = cents / 100;
  return d.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(d) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function pct(p: number): string {
  const r = Math.round(p * 10) / 10;
  return `${r > 0 ? "+" : ""}${r}%`;
}

export function mult(m: number): string {
  return `${Number(m).toFixed(2).replace(/\.?0+$/, "")}×`;
}

export function when(iso: string | Date): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
