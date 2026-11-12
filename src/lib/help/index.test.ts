import { describe, expect, it } from "vitest";
import { searchHelp } from ".";

describe("help search", () => {
  it.each([
    ["How do I add after-hours pricing?", "profiles#add-after-hours-pricing"],
    ["who can turn on QuickBooks sync", "modules#who-can-switch-modules"],
    ["can I undo a change", "undo"],
    ["set up a winter maintenance plan", "maintenance-plans#set-up-a-maintenance-plan"],
    ["why did my bulk change need an owner", "bulk-changes#large-changes-need-an-owner"],
  ])("%s → %s", (q, want) => {
    const ids = searchHelp(q).map((s) => s.id);
    expect(ids.some((id) => id.startsWith(want))).toBe(true);
  });

  it("finds nothing for questions the docs don't cover", () => {
    expect(searchHelp("payroll tax remittance")).toEqual([]);
  });
});
