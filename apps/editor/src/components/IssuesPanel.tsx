/**
 * The deck's lint, for people (D73): the same issues agents get after each change, worded for
 * the editor and grouped by slide. Clicking an issue goes to its slide and selects the layers
 * involved; tips (info) stay folded away. It's a spell checker, not a gate: nothing blocks.
 */
import type { Deck, LintReport, LintSeverity } from "@veloce/core";
import { CircleCheck, CircleX, Lightbulb, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { openPreferences } from "../dialogs.js";
import { issueCounts, viewIssues } from "../model/lint-view.js";

const ICONS: Record<LintSeverity, typeof CircleX> = {
  error: CircleX,
  warning: TriangleAlert,
  info: Lightbulb,
};
const SEVERITY_NAME: Record<LintSeverity, string> = {
  error: "Error",
  warning: "Warning",
  info: "Tip",
};

interface Props {
  deck: Deck;
  /** The deck's version: a report older than this is being re-checked. */
  version: number;
  lint: LintReport | null;
  /** Lint is turned off in Preferences (D91). */
  off?: boolean;
  currentSlideId: string;
  /** Go to a slide and select these layers on it (none: just the slide). */
  onReveal(slideId: string, nodeIds: string[]): void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function IssuesPanel({ deck, version, lint, off, currentSlideId, onReveal }: Props) {
  const [showTips, setShowTips] = useState(false);
  const groups = useMemo(
    () => (lint ? viewIssues(deck, lint.issues, { showTips }) : []),
    [deck, lint, showTips],
  );
  const counts = useMemo(() => issueCounts(lint?.issues ?? []), [lint]);
  if (off) {
    return (
      <div className="panel-empty">
        <p>Checking for issues is off.</p>
        <button type="button" className="button" onClick={() => openPreferences("editing")}>
          Open Preferences
        </button>
      </div>
    );
  }
  if (!lint) return <p className="panel-empty">Checking the deck…</p>;

  const checking = lint.version < version;
  const problems = counts.error + counts.warning;
  const summary =
    problems === 0
      ? "No problems found"
      : [
          counts.error && plural(counts.error, "error"),
          counts.warning && plural(counts.warning, "warning"),
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="issues-panel">
      <div className="issues-summary" aria-live="polite">
        {problems === 0 && <CircleCheck size={14} className="issues-ok" aria-hidden />}
        <span>{summary}</span>
        {checking && <span className="issues-checking">Checking…</span>}
      </div>
      {lint.visual !== true && (
        <p className="issues-note">
          Layout checks (text that doesn't fit, contrast, overlaps) are off: {lint.visual}.
        </p>
      )}
      {groups.length > 0 && (
        <ol className="issues-list" aria-label="Issues by slide">
          {groups.map((group) => (
            <li key={group.slideId} className="issues-group">
              <button
                type="button"
                className={`issues-slide${group.slideId === currentSlideId ? " is-current" : ""}`}
                onClick={() => onReveal(group.slideId, [])}
              >
                Slide {group.number}
                {group.name && <span className="issues-slide-name"> · {group.name}</span>}
              </button>
              <ol>
                {group.issues.map((issue) => {
                  const Icon = ICONS[issue.severity];
                  return (
                    <li key={issue.key}>
                      <button
                        type="button"
                        className={`issue is-${issue.severity}`}
                        onClick={() => onReveal(issue.slideId, issue.nodeIds)}
                      >
                        <Icon size={14} className="issue-icon" aria-hidden />
                        <span className="issue-text">
                          <span className="issue-title">
                            <span className="sr-only">{SEVERITY_NAME[issue.severity]}: </span>
                            {issue.title}
                          </span>
                          <span className="issue-detail">{issue.detail}</span>
                          <span className="issue-hint">{issue.hint}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </li>
          ))}
        </ol>
      )}
      {counts.info > 0 && (
        <button
          type="button"
          className="issues-tips"
          aria-pressed={showTips}
          onClick={() => setShowTips((v) => !v)}
        >
          <Lightbulb size={13} aria-hidden />
          {showTips ? "Hide tips" : `Show ${plural(counts.info, "tip")}`}
        </button>
      )}
    </div>
  );
}
