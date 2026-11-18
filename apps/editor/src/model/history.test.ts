import type { HistoryEntry, Origin } from "@veloce/core";
import { describe, expect, it } from "vitest";
import { historyGroups, originName, timeAgo } from "./history.js";

const entry = (version: number, origin: Origin, label = `change ${version}`): HistoryEntry => ({
  version,
  origin,
  label,
  slideIds: [],
  at: version * 1000,
});

describe("history", () => {
  it("names who made a change", () => {
    expect(originName("user")).toBe("You");
    expect(originName("agent:claude-code")).toBe("Claude Code");
    expect(originName("agent:my_bot.v2")).toBe("My Bot V2");
    expect(originName("agent:unknown")).toBe("AI agent");
  });

  it("says how long ago, coarsely", () => {
    const now = 10_000_000;
    expect(timeAgo(now - 10_000, now)).toBe("just now");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(timeAgo(now - 2 * 3_600_000, now)).toBe("2 h ago");
    expect(timeAgo(now - 3 * 86_400_000, now)).toBe("3 d ago");
    expect(timeAgo(now + 5000, now)).toBe("just now"); // clock skew
  });

  it("lists newest first, grouping consecutive changes by the same author", () => {
    const entries = [
      entry(1, "agent:claude-code"),
      entry(2, "agent:claude-code"),
      entry(3, "user"),
      entry(4, "agent:claude-code"),
    ];
    const groups = historyGroups(entries);
    expect(groups.map((g) => [g.origin, g.entries.map((e) => e.version)])).toEqual([
      ["agent:claude-code", [4]],
      ["user", [3]],
      ["agent:claude-code", [2, 1]],
    ]);
    // Filtering: the agent's changes merge into one run once yours are hidden.
    expect(historyGroups(entries, "ai").map((g) => g.entries.length)).toEqual([3]);
    expect(historyGroups(entries, "you").map((g) => g.origin)).toEqual(["user"]);
    expect(historyGroups([])).toEqual([]);
  });
});
