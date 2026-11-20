import type { HistoryEntry, Origin } from "@veloce/core";
import { describe, expect, it } from "vitest";
import {
  canRevert,
  historyGroups,
  originName,
  revertMessage,
  revertVersions,
  timeAgo,
} from "./history.js";

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

  it("reverts only agents' changes still in effect", () => {
    const agent = entry(1, "agent:claude-code");
    expect(canRevert(agent)).toBe(true);
    expect(canRevert({ ...agent, reverted: true })).toBe(false);
    expect(canRevert(entry(2, "user"))).toBe(false);
    expect(canRevert(entry(3, "system"))).toBe(false);
    expect(
      revertVersions([agent, { ...entry(4, "agent:x"), reverted: true }, entry(5, "user")]),
    ).toEqual([1]);
  });

  it("says what a revert took back, and which of your later edits it touched", () => {
    const history: HistoryEntry[] = [
      { ...entry(1, "agent:claude-code", "Add slide"), slideIds: ["a"] },
      { ...entry(2, "agent:claude-code", "Retitle"), slideIds: ["b"] },
      { ...entry(3, "user", "Edit text"), slideIds: ["a"] },
      { ...entry(4, "user", "Earlier"), slideIds: ["b"] },
    ];
    const number = (id: string) => ({ a: 1, b: 2 })[id];
    const all = () => true;
    expect(revertMessage(history, [2], number, all)).toBe(
      'Reverted "Retitle". It also touched slide 2 you\'d edited since.',
    );
    expect(revertMessage(history, [1, 2], number, all)).toBe(
      "Reverted 2 AI changes. It also touched slides 1, 2 you'd edited since.",
    );
    // Your edits before the change, or on other slides, aren't mentioned.
    const before = [history[2], history[0]].map(
      (e, i) => ({ ...e, version: i + 1 }) as HistoryEntry,
    );
    expect(revertMessage(before, [2], number, all)).toBe('Reverted "Add slide".');
    // Slides the revert removed keep the number they had (numbered before the revert).
    expect(revertMessage(history, [1, 2], number, (id) => id === "b")).toBe(
      "Reverted 2 AI changes. It also touched slide 2 and removed slide 1 you'd edited since.",
    );
    expect(
      revertMessage(
        history,
        [1],
        () => undefined,
        () => false,
      ),
    ).toBe('Reverted "Add slide". It also removed a slide you\'d edited since.');
  });

  it("doesn't count your reverts (or undoing them) as edits of yours", () => {
    const history: HistoryEntry[] = [
      { ...entry(1, "agent:claude-code", "Add slide"), slideIds: ["a"] },
      { ...entry(2, "agent:claude-code", "Retitle"), slideIds: ["a"] },
      { ...entry(3, "user", "Revert"), slideIds: ["a"], reverts: [2] },
      { ...entry(4, "user", "Undo: Revert"), slideIds: ["a"], restores: [2] },
    ];
    expect(
      revertMessage(
        history,
        [1, 2],
        () => 1,
        () => false,
      ),
    ).toBe("Reverted 2 AI changes.");
  });
});
