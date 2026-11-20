import { useState } from "react";
import { run } from "../actions.js";
import { addSlide } from "../model/commands.js";

/** Shown until the deck has slides: how to point an AI agent at this Veloce. */
export function EmptyState({
  hasDeck,
  online,
  onNewDeck,
}: {
  hasDeck: boolean;
  online: boolean;
  /** Start a deck by hand instead (File → New deck, D77). */
  onNewDeck(): void;
}) {
  const command = `claude mcp add --transport http veloce ${location.origin}/mcp`;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the command is selectable anyway.
    }
  };
  return (
    <section className="empty">
      <div className="empty-card">
        <span className="empty-pulse" aria-hidden="true" />
        <h1>{hasDeck ? "This deck is empty" : "Waiting for your AI agent"}</h1>
        <p>
          {online
            ? "Slides appear here live as your agent builds them."
            : "Connecting to the Veloce server…"}
        </p>
        <ol className="steps">
          <li>
            <span>Connect Claude Code (once):</span>
            <div className="command">
              <code>{command}</code>
              <button type="button" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </li>
          <li>
            <span>Then ask it something like:</span>
            <blockquote>
              “Make a 5-slide pitch deck about a solar-powered coffee cart. Use the midnight theme.”
            </blockquote>
          </li>
        </ol>
        {online && (
          // Building by hand starts here too: a deck made with File → New has no slides yet.
          <p className="empty-or">
            Or start {hasDeck ? "it" : "one"} yourself:{" "}
            {hasDeck ? (
              <button type="button" className="button" onClick={() => void run(addSlide(-1))}>
                New slide
              </button>
            ) : (
              <button type="button" className="button" onClick={onNewDeck}>
                New deck
              </button>
            )}
          </p>
        )}
      </div>
    </section>
  );
}
