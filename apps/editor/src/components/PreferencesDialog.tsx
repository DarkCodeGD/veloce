/**
 * File → Preferences (D91): the app settings, by tab. Every change applies at once and is
 * saved by the server to the user's settings file (no Save button, as in VS Code and Figma);
 * every open tab follows. A setting at its default shows the default as a placeholder, a
 * changed one gets the inspector's reset button, so fields read the same as everywhere else.
 *
 * Tabs ship only with settings that work: Interface (UI scale, light theme) waits for the
 * desktop app (D91 §2).
 */
import {
  DEFAULT_SETTINGS,
  LINT_RULES,
  type LintRule,
  type Settings,
  type SettingsPatch,
} from "@veloce/core";
import { Check, Copy, Search } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { initialPreferencesTab, type PreferencesTab } from "../dialogs.js";
import { RULE_NAMES } from "../model/lint-view.js";
import { changeSettings, useSettings, useSettingsReport } from "../settings.js";
import { Dialog } from "./Dialog.js";
import { NumberField, Section, TextField, ToggleField } from "./fields.js";
import { ShortcutList } from "./ShortcutsDialog.js";

const TABS: ReadonlyArray<readonly [PreferencesTab, string]> = [
  ["editing", "Editing"],
  ["files", "Files"],
  ["keymap", "Keymap"],
  ["ai", "AI"],
];

/** A field's value: undefined (the placeholder shows the default) unless it was changed. */
const changed = <T,>(value: T, fallback: T): T | undefined =>
  value === fallback ? undefined : value;

/** A number setting's commit: a number sets it, null (reset) goes back to the default. */
const numberCommit =
  <S extends "editing" | "files" | "ai">(section: S, key: keyof Settings[S], scale = 1) =>
  (value: unknown) => {
    const fallback = DEFAULT_SETTINGS[section][key];
    const next = typeof value === "number" ? Math.round(value * scale * 100) / 100 : fallback;
    changeSettings({ [section]: { [key]: next } } as SettingsPatch);
  };

export function PreferencesDialog({ onClose }: { onClose(): void }) {
  const [tab, setTab] = useState<PreferencesTab>(initialPreferencesTab);
  const ids = useId();
  const report = useSettingsReport();
  return (
    <Dialog
      title="Preferences"
      className="preferences-dialog"
      fieldKeys="field"
      onClose={onClose}
      onSubmit={onClose}
      actions={
        <>
          {report?.file && (
            <p className="preferences-file" title={report.file}>
              Saved in {report.file}
            </p>
          )}
          <button type="submit" className="button button-primary">
            Done
          </button>
        </>
      }
    >
      <div className="dialog-tabs" role="tablist" aria-label="Preferences">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`${ids}-${id}`}
            aria-selected={tab === id}
            aria-controls={`${ids}-panel`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="preferences-panel"
        role="tabpanel"
        id={`${ids}-panel`}
        aria-labelledby={`${ids}-${tab}`}
      >
        {tab === "editing" && <EditingTab />}
        {tab === "files" && <FilesTab />}
        {tab === "keymap" && <KeymapTab />}
        {tab === "ai" && <AiTab />}
      </div>
    </Dialog>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="inspector-hint">{children}</p>;
}

function EditingTab() {
  const { editing } = useSettings();
  const defaults = DEFAULT_SETTINGS.editing;
  const muted = new Set(editing.mutedRules);
  const setRule = (rule: LintRule, on: boolean) =>
    changeSettings({
      editing: {
        mutedRules: on
          ? editing.mutedRules.filter((r) => r !== rule)
          : [...editing.mutedRules, rule],
      },
    });
  return (
    <>
      <Section title="Moving layers">
        <ToggleField
          label="Snapping"
          value={editing.snapping}
          onCommit={(on) => changeSettings({ editing: { snapping: on === true } })}
        />
        <Hint>Snap to other layers and the frame while dragging. Hold Alt to skip it once.</Hint>
        <NumberField
          label="Nudge"
          value={changed(editing.nudge, defaults.nudge)}
          placeholder={String(defaults.nudge)}
          min={0.1}
          max={100}
          step={0.5}
          suffix="px"
          onCommit={numberCommit("editing", "nudge")}
        />
        <NumberField
          label="Shift nudge"
          value={changed(editing.nudgeBig, defaults.nudgeBig)}
          placeholder={String(defaults.nudgeBig)}
          min={1}
          max={500}
          suffix="px"
          onCommit={numberCommit("editing", "nudgeBig")}
        />
      </Section>
      <Section title="Undo">
        <NumberField
          label="Undo steps"
          value={changed(editing.undoSteps, defaults.undoSteps)}
          placeholder={String(defaults.undoSteps)}
          min={20}
          max={1000}
          step={10}
          integer
          onCommit={numberCommit("editing", "undoSteps")}
        />
        <Hint>Kept for you and for each agent. More steps use more memory.</Hint>
      </Section>
      <Section title="Animating">
        <ToggleField
          label="Preview levels"
          value={editing.previewLevel}
          onCommit={(on) => changeSettings({ editing: { previewLevel: on === true } })}
        />
        <Hint>
          Play the slide on the canvas while you drag the motion level, at each level you pass.
        </Hint>
      </Section>
      <Section title="Issues">
        <ToggleField
          label="Check slides"
          value={editing.lint}
          onCommit={(on) => changeSettings({ editing: { lint: on === true } })}
        />
        <Hint>
          The Issues tab and its badges. Agents always get every issue, whatever you show here.
        </Hint>
        {editing.lint && (
          <div className="lint-rules">
            {(Object.keys(LINT_RULES) as LintRule[]).map((rule) => (
              <ToggleField
                key={rule}
                label={RULE_NAMES[rule]}
                value={!muted.has(rule)}
                onCommit={(on) => setRule(rule, on === true)}
              />
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

function FilesTab() {
  const { files } = useSettings();
  const report = useSettingsReport();
  return (
    <>
      <Section title="Decks">
        <TextField
          label="Decks folder"
          value={files.decksFolder ?? undefined}
          placeholder="Default (~/Veloce)"
          onCommit={(value) =>
            changeSettings({
              files: { decksFolder: typeof value === "string" && value.trim() ? value : null },
            })
          }
        />
        {report && (
          <Hint>
            Now using {report.running.decksFolder}. A change applies when Veloce restarts.
          </Hint>
        )}
      </Section>
      <Section title="Saving">
        <NumberField
          label="Autosave after"
          // Shown in seconds, stored in milliseconds.
          value={
            changed(files.autosaveMs, DEFAULT_SETTINGS.files.autosaveMs) && files.autosaveMs / 1000
          }
          placeholder={String(DEFAULT_SETTINGS.files.autosaveMs / 1000)}
          min={0.2}
          max={60}
          step={0.1}
          suffix="s"
          onCommit={numberCommit("files", "autosaveMs", 1000)}
        />
        <Hint>The pause after a change before it's saved. Every change is kept either way.</Hint>
      </Section>
    </>
  );
}

function KeymapTab() {
  const [query, setQuery] = useState("");
  return (
    <div className="keymap">
      <div className="search-field">
        <Search size={14} aria-hidden />
        <input
          type="search"
          className="search-field-input"
          aria-label="Search shortcuts"
          placeholder="Search shortcuts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <ShortcutList query={query} />
      <Hint>Changing shortcuts comes after version 1.0.</Hint>
    </div>
  );
}

function AiTab() {
  const { ai } = useSettings();
  const report = useSettingsReport();
  const port = report?.running.port ?? ai.port;
  // The page's own host when the server serves it; the server's default address otherwise
  // (the Vite dev server).
  const host = location.port === String(port) ? location.host : `127.0.0.1:${port}`;
  const command = `claude mcp add --transport http veloce http://${host}/mcp`;
  return (
    <>
      <Section title="Agents">
        <ToggleField
          label="Follow AI"
          value={ai.followAI}
          onCommit={(on) => changeSettings({ ai: { followAI: on === true } })}
        />
        <Hint>Start with Follow AI on: the editor jumps to the slide an agent is working on.</Hint>
      </Section>
      <Section title="Connect an agent">
        <Hint>Run this once in a terminal to connect Claude Code (Veloce must be running):</Hint>
        <CopyCommand command={command} />
        <NumberField
          label="Port"
          value={changed(ai.port, DEFAULT_SETTINGS.ai.port)}
          placeholder={String(DEFAULT_SETTINGS.ai.port)}
          min={1024}
          max={65535}
          integer
          onCommit={numberCommit("ai", "port")}
        />
        {report && (
          <Hint>
            Now using port {report.running.port}. A change applies when Veloce restarts; connect
            agents again with the new address.
          </Hint>
        )}
      </Section>
    </>
  );
}

/** A shell command and a button that copies it. */
function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="copy-command">
      <code>{command}</code>
      <button
        type="button"
        className="icon-button"
        aria-label={copied ? "Copied" : "Copy command"}
        data-tip={copied ? "Copied" : "Copy"}
        onClick={() => {
          void navigator.clipboard.writeText(command).then(() => setCopied(true));
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}
