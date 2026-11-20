import type { HistoryEntry, Origin } from "@veloce/core";
import { describe, expect, it } from "vitest";
import { othersChanges } from "./changes.js";

const entry = (
  version: number,
  origin: Origin,
  label: string,
  extra: Partial<HistoryEntry> = {},
): HistoryEntry => ({ version, origin, label, slideIds: [], at: 0, ...extra });

const labels = new Map([
  [1, "Add slide s1"],
  [2, "Add slide s2"],
  [3, "Set theme"],
]);
const options = {
  origin: "agent:claude-code" as const,
  mine: (v: number) => v <= 2,
  labelOf: (v: number) => labels.get(v),
};

describe("othersChanges", () => {
  it("says nothing when nothing happened", () => {
    expect(othersChanges([], options)).toBe("");
  });

  it("merges a run of one author's changes into a line, and names every author", () => {
    const digest = othersChanges(
      [
        entry(4, "user", "Edit text", { slideIds: ["s1"] }),
        entry(5, "user", "Move", { slideIds: ["s1", "s3"] }),
        entry(6, "user", "Delete slide", { removedSlideIds: ["s3"] }),
        entry(7, "agent:claude-code", "Add slide s9", { slideIds: ["s9"] }),
        entry(8, "agent:cursor", "Set theme"),
        entry(9, "system", "Migrate"),
      ],
      options,
    );
    expect(digest.split("\n")).toEqual([
      "Since your last call, others changed this deck:",
      // s3 was moved, then removed: listed once, as removed.
      '- The user: "Edit text", "Move", "Delete slide"; changed slide s1; removed slide s3.',
      '- Another session of you: "Add slide s9"; changed slide s9.',
      '- Another agent (cursor): "Set theme".',
      '- Veloce: "Migrate".',
      "IDs and content you saw on those slides may have changed: get_slide before editing them.",
    ]);
  });

  it("describes reverts by whose work they took back", () => {
    const line = (reverts: number[]) =>
      othersChanges([entry(10, "user", "Revert", { reverts })], options).split("\n")[1];
    expect(line([1])).toBe('- The user reverted your change "Add slide s1".');
    expect(line([2, 1])).toBe(
      '- The user reverted 2 of your changes: "Add slide s2", "Add slide s1".',
    );
    expect(line([3, 1])).toBe(
      '- The user reverted 2 changes (1 of them yours): "Set theme", "Add slide s1".',
    );
    expect(line([3])).toBe('- The user reverted a change "Set theme".');
    expect(line([1, 42])).toBe('- The user reverted 2 changes (1 of them yours): "Add slide s1".');
    // Only a revert of the agent's own work comes with the "don't redo it" rule.
    expect(othersChanges([entry(10, "user", "Revert", { reverts: [3] })], options)).not.toMatch(
      /decision/,
    );
    expect(
      othersChanges([entry(11, "user", "Undo: Revert", { restores: [1] })], options),
    ).toContain('- The user undid a revert, bringing back your change "Add slide s1".');
  });

  it("names removed nodes, says restored, and doesn't nest quotes", () => {
    const digest = othersChanges(
      [
        entry(4, "user", 'Delete "Questions?"', { slideIds: ["s4"], removedNodeIds: ["sub4"] }),
        entry(5, "agent:cursor", "Tidy", { slideIds: ["s1"] }),
        entry(6, "user", "Undo: Revert", { restores: [3], slideIds: ["s2"] }),
      ],
      { ...options, nodeLabel: (id) => (id === "sub4" ? 'The "end"' : undefined) },
    );
    expect(digest.split("\n").slice(1, 4)).toEqual([
      "- The user: \"Delete 'Questions?'\"; changed slide s4; removed node sub4 (\"The 'end'\").",
      '- Another agent (cursor): "Tidy"; changed slide s1.',
      '- The user undid a revert, bringing back a change "Set theme"; restored slide s2.',
    ]);
  });

  it("collapses a revert undone right away into one line with no net change", () => {
    const digest = othersChanges(
      [
        entry(10, "user", "Revert", { reverts: [2, 1], removedSlideIds: ["s1", "s2"] }),
        entry(11, "user", "Undo: Revert", { restores: [1, 2], slideIds: ["s1", "s2"] }),
      ],
      options,
    );
    expect(digest).toBe(
      [
        "Since your last call, others changed this deck:",
        '- The user reverted 2 of your changes: "Add slide s2", "Add slide s1", then undid that (no net change).',
      ].join("\n"),
    );
    // Not undone (or undone by someone else, or only partly): both stay.
    const partly = othersChanges(
      [
        entry(10, "user", "Revert", { reverts: [2, 1] }),
        entry(11, "user", "Undo", { restores: [1] }),
      ],
      options,
    );
    expect(partly.split("\n")).toHaveLength(4); // header, 2 lines, the "decision" rule
  });

  it("stays short without losing the newest: older lines fold into the slides they touched", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      entry(20 + i, "user", `Edit ${i}`, { slideIds: [`s${i}`, `t${i}`] }),
    );
    expect(othersChanges(many, options).split("\n")[1]).toBe(
      '- The user: "Edit 0", "Edit 1", "Edit 2", "Edit 3" and 2 more; changed slides s0, t0, s1, t1, s2, t2 +6.',
    );
    const alternating = Array.from({ length: 12 }, (_, i) =>
      entry(40 + i, i % 2 ? "user" : "agent:cursor", `Step ${i}`, {
        slideIds: [`s${i}`],
        ...(i === 0 && { removedSlideIds: ["gone"] }),
      }),
    );
    const lines = othersChanges(alternating, { ...options, missedEarlier: true }).split("\n");
    expect(lines[0]).toBe(
      "Since your last call, others changed this deck (the earliest of these changes aren't listed):",
    );
    expect(lines).toHaveLength(1 + 8 + 1);
    // The 5 oldest fold into one line naming their slides; the 7 newest are shown in full.
    expect(lines[1]).toBe(
      "- Earlier: 5 more updates; changed slides s0, s1, s2, s3, s4; removed slide gone.",
    );
    expect(lines[2]).toBe('- The user: "Step 5"; changed slide s5.');
    expect(lines[8]).toBe('- The user: "Step 11"; changed slide s11.');
  });
});
