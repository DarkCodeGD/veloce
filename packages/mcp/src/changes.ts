/**
 * "While you were away": what others did to the deck since an agent's last tool call.
 *
 * MCP is request/response, and clients rarely show server-pushed notifications to the model,
 * so instead every tool result starts with this digest (D71). Without it, an agent whose work
 * the user reverted would happily rebuild it on its next call, fighting the user; and one
 * holding IDs from a slide the user rewrote would edit blind.
 *
 * It must not lose anything that matters (D72): each change is reported once, so whatever is
 * cut here is never seen. A revert and its undo collapse into one "no net change" line, the
 * newest lines are kept, and older ones fold into a summary of the slides they touched.
 *
 * Pure: takes the deck's history entries (already filtered to the ones the agent hasn't
 * seen and didn't make) and returns text, or "" when there's nothing to say.
 */
import type { HistoryEntry, Origin } from "@veloce/core";

/** Lines shown; older ones fold into one "Earlier:" summary line. */
const MAX_LINES = 8;
/** Labels quoted, and slide or node IDs listed, per line before "and N more" / "+N". */
const MAX_LABELS = 4;
const MAX_IDS = 6;

export interface DigestOptions {
  /** The agent reading the digest (its own origin reads as "another session of you"). */
  origin: Origin;
  /** Versions this agent session made: a revert of one of these is a revert of *its* work. */
  mine: (version: number) => boolean;
  /** Labels of changes by version, to name what a revert took back. */
  labelOf: (version: number) => string | undefined;
  /** A removed node's name or text snippet, so the agent recognises it. */
  nodeLabel?: (nodeId: string) => string | undefined;
  /** Some changes since the last call already fell off the history (it's bounded). */
  missedEarlier?: boolean;
}

/** One line of the digest, with the slides behind it (for folding into "Earlier:"). */
interface Line {
  text: string;
  touched: Set<string>;
  removed: Set<string>;
  /** A revert of this agent's work that still stands. */
  revertOfMine: boolean;
  /** A revert whose versions a following undo may cancel. */
  revert?: { origin: Origin; versions: string; head: string };
}

/** Plain changes by one author, gathered until someone else (or a revert) comes along. */
interface Run {
  origin: Origin;
  labels: string[];
  touched: Set<string>;
  removed: Set<string>;
  nodes: string[];
}

function who(origin: Origin, self: Origin): string {
  if (origin === "user") return "The user";
  if (origin === "system") return "Veloce";
  if (origin === self) return "Another session of you";
  return `Another agent (${origin.slice("agent:".length)})`;
}

/** Labels in quotes; quotes inside a label become single ones, so they don't nest. */
const quoteAll = (labels: readonly string[]) => {
  const shown = labels.slice(0, MAX_LABELS).map((l) => `"${l.replaceAll('"', "'")}"`);
  const more = labels.length - shown.length;
  return `${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
};

const idList = (ids: Iterable<string>) => {
  const all = [...ids];
  const shown = all.slice(0, MAX_IDS);
  return `${shown.join(", ")}${all.length > shown.length ? ` +${all.length - shown.length}` : ""}`;
};

const plural = (n: number, word: string) => (n === 1 ? word : `${word}s`);

/**
 * "your change "Add title"", "2 of your changes: "A", "B"", "3 changes (1 of them yours): …".
 * Labels of changes that fell off the history are left out (the count still says how many).
 */
function describeMarked(
  versions: readonly number[],
  mine: number,
  labelOf: (version: number) => string | undefined,
): string {
  const labels = versions.map(labelOf).filter((l): l is string => l !== undefined);
  const n = versions.length;
  const head =
    n === 1
      ? mine
        ? "your change"
        : "a change"
      : mine === n
        ? `${n} of your changes`
        : mine
          ? `${n} changes (${mine} of them yours)`
          : `${n} changes`;
  if (!labels.length) return head;
  return n === 1 ? `${head} ${quoteAll(labels)}` : `${head}: ${quoteAll(labels)}`;
}

/** "changed slide s1", "removed node sub4 ("Questions?")", "removed slides s2, s3". */
function slideParts(
  touched: ReadonlySet<string>,
  removed: ReadonlySet<string>,
  options: { verb?: string; nodes?: readonly string[]; nodeLabel?: DigestOptions["nodeLabel"] },
): string[] {
  const parts: string[] = [];
  const changed = [...touched].filter((id) => !removed.has(id));
  const verb = options.verb ?? "changed";
  if (changed.length) parts.push(`${verb} ${plural(changed.length, "slide")} ${idList(changed)}`);
  const nodes = options.nodes ?? [];
  if (nodes.length) {
    const named = nodes.map((id) => {
      const label = options.nodeLabel?.(id);
      return label ? `${id} ("${label.replaceAll('"', "'")}")` : id;
    });
    parts.push(`removed ${plural(nodes.length, "node")} ${idList(named)}`);
  }
  if (removed.size) parts.push(`removed ${plural(removed.size, "slide")} ${idList(removed)}`);
  return parts;
}

export function othersChanges(entries: readonly HistoryEntry[], options: DigestOptions): string {
  if (entries.length === 0) return "";
  const lines: Line[] = [];

  // A run of plain changes by one author becomes one line. (`as`: TS can't see that the
  // flush() closure resets it, and would narrow it to null.)
  let run = null as Run | null;
  const flush = () => {
    if (!run) return;
    const head = `${who(run.origin, options.origin)}: ${quoteAll(run.labels)}`;
    const parts = slideParts(run.touched, run.removed, {
      nodes: run.nodes,
      ...(options.nodeLabel && { nodeLabel: options.nodeLabel }),
    });
    lines.push({
      text: `- ${[head, ...parts].join("; ")}.`,
      touched: run.touched,
      removed: run.removed,
      revertOfMine: false,
    });
    run = null;
  };

  for (const entry of entries) {
    const marks = entry.reverts ?? entry.restores;
    if (marks?.length) {
      flush();
      const by = who(entry.origin, options.origin);
      const ofMine = marks.filter(options.mine).length;
      const what = describeMarked(marks, ofMine, options.labelOf);
      const key = [...marks].sort((a, b) => a - b).join(",");
      const previous = lines.at(-1);
      // Reverted, then undone right away: no net change, one line.
      if (
        entry.restores &&
        previous?.revert?.origin === entry.origin &&
        previous.revert.versions === key
      ) {
        lines[lines.length - 1] = {
          text: `- ${previous.revert.head}, then undid that (no net change).`,
          touched: new Set(),
          removed: new Set(),
          revertOfMine: false,
        };
        continue;
      }
      const touched = new Set(entry.slideIds);
      const removed = new Set(entry.removedSlideIds);
      const head = entry.reverts
        ? `${by} reverted ${what}`
        : `${by} undid a revert, bringing back ${what}`;
      const parts = slideParts(touched, removed, {
        ...(entry.restores && { verb: "restored" }),
        nodes: entry.removedNodeIds ?? [],
        ...(options.nodeLabel && { nodeLabel: options.nodeLabel }),
      });
      lines.push({
        text: `- ${[head, ...parts].join("; ")}.`,
        touched,
        removed,
        revertOfMine: Boolean(entry.reverts && ofMine),
        ...(entry.reverts && { revert: { origin: entry.origin, versions: key, head } }),
      });
      continue;
    }
    let current = run;
    if (current?.origin !== entry.origin) {
      flush();
      current = {
        origin: entry.origin,
        labels: [],
        touched: new Set(),
        removed: new Set(),
        nodes: [],
      };
      run = current;
    }
    current.labels.push(entry.label);
    for (const id of entry.slideIds) current.touched.add(id);
    for (const id of entry.removedSlideIds ?? []) current.removed.add(id);
    current.nodes.push(...(entry.removedNodeIds ?? []));
  }
  flush();

  // Keep the newest lines; fold the older ones into the slides they touched.
  let shown = lines;
  if (lines.length > MAX_LINES) {
    const hidden = lines.slice(0, lines.length - (MAX_LINES - 1));
    shown = lines.slice(hidden.length);
    const touched = new Set(hidden.flatMap((l) => [...l.touched]));
    const removed = new Set(hidden.flatMap((l) => [...l.removed]));
    const parts = slideParts(touched, removed, {});
    const summary = `- Earlier: ${hidden.length} more ${plural(hidden.length, "update")}${parts.length ? `; ${parts.join("; ")}` : ""}.`;
    shown = [{ text: summary, touched, removed, revertOfMine: false }, ...shown];
  }

  const out = [
    `Since your last call, others changed this deck${options.missedEarlier ? " (the earliest of these changes aren't listed)" : ""}:`,
    ...shown.map((l) => l.text),
  ];
  if (lines.some((l) => l.revertOfMine)) {
    out.push(
      "A revert is the user's decision: don't redo that work unless they ask for it. If unsure, ask them.",
    );
  }
  if (lines.some((l) => l.touched.size || l.removed.size || /removed nodes? /.test(l.text))) {
    out.push(
      "IDs and content you saw on those slides may have changed: get_slide before editing them.",
    );
  }
  return out.join("\n");
}
