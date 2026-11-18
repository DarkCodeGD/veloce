import { useState } from "react";

/** Shown until the deck has slides: how to point an AI agent at this Veloce. */
export function EmptyState({ hasDeck, online }: { hasDeck: boolean; online: boolean }) {
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
      </div>
    </section>
  );
}
