/**
 * Arrange → Save as component… (D94): the selected layer, saved under a name to insert again
 * from the Components tab (or by agents, with `use`). Slide → Save slide as layout… (D95):
 * the whole slide, to start new slides from. Its texts are offered as params, which agents
 * fill in when they use it; each can be renamed or left out.
 *
 * Saving is an ordinary op, so it's one undo step, and the toast offers Undo too.
 */
import {
  ComponentNameSchema,
  getComponent,
  type Node,
  PARAM_NAME_PATTERN,
  type Slide,
} from "@veloce/core";
import { useId, useState } from "react";
import { run } from "../actions.js";
import { commandContext } from "../editor-commands.js";
import { type ParamProposal, proposeParams, saveComponentCommand } from "../model/components.js";
import { nodeLabel } from "../model/slide-index.js";
import { Dialog, DialogField, describedBy } from "./Dialog.js";

interface Draft extends ParamProposal {
  keep: boolean;
}

/** What the dialog saves, as it was when it opened. */
interface Source {
  node: Node;
  /** Saving a whole slide: a slide layout, with the slide's own fields. */
  slide?: Pick<Slide, "background">;
  /** Its name where it came from, when it has one. */
  name?: string | undefined;
  /** How the hint refers to it: “Feature card”, this slide. */
  label: string;
}

/** The selected layer, or (for a layout) the slide on screen. */
function source(layout: boolean): Source | null {
  const c = commandContext();
  if (!c.slideIndex) return null;
  if (layout) {
    const slide = c.slideIndex.slide;
    return {
      node: slide.root,
      slide: slide.background !== undefined ? { background: slide.background } : {},
      name: slide.name,
      label: "this slide",
    };
  }
  const id = c.selection.length === 1 ? c.selection[0] : undefined;
  if (!id || id === c.slideIndex.rootId) return null;
  const node = c.slideIndex.nodes.get(id)?.node;
  return node ? { node, name: node.name, label: `“${nodeLabel(node)}”` } : null;
}

/** Its own name when that's a valid component name, else "Component N" / "Layout N". */
function suggestedName(from: Source): string {
  const deck = commandContext().deck;
  const named = from.name?.trim();
  if (named && ComponentNameSchema.safeParse(named).success) return named;
  const count = Object.values(deck?.components ?? {}).filter((c) => !!c.slide === !!from.slide);
  return `${from.slide ? "Layout" : "Component"} ${count.length + 1}`;
}

export function SaveComponentDialog({
  onClose,
  layout = false,
}: {
  onClose(): void;
  /** Save the slide on screen as a slide layout (D95). */
  layout?: boolean;
}) {
  const [from] = useState(() => source(layout));
  if (!from) return null;
  return <SaveComponentForm from={from} onClose={onClose} />;
}

function SaveComponentForm({ from, onClose }: { from: Source; onClose(): void }) {
  const { node } = from;
  const what = from.slide ? "slide layout" : "component";
  const [name, setName] = useState(() => suggestedName(from));
  const [description, setDescription] = useState("");
  const [params, setParams] = useState<Draft[]>(() =>
    proposeParams(node).map((p) => ({ ...p, keep: true })),
  );
  const [error, setError] = useState<string>();
  const [paramError, setParamError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const descriptionId = useId();
  const paramsId = useId();

  const deck = commandContext().deck;
  const trimmed = name.trim();
  const replacing = deck !== undefined && getComponent(deck, trimmed) !== undefined;

  const save = async () => {
    if (!deck) return;
    if (!ComponentNameSchema.safeParse(trimmed).success) {
      return setError('Use words joined by single spaces, "-" or "_" (up to 60 characters).');
    }
    const kept = params.filter((p) => p.keep);
    const names = kept.map((p) => p.param.trim());
    const bad = names.find((n) => !PARAM_NAME_PATTERN.test(n));
    if (bad !== undefined) {
      return setParamError(
        `“${bad || "(empty)"}” isn't a param name: start with a letter, then letters, digits or _.`,
      );
    }
    if (new Set(names).size < names.length) return setParamError("Give each param its own name.");
    setBusy(true);
    const command = saveComponentCommand(deck, {
      name: trimmed,
      description,
      node,
      params: kept.map((p) => ({ param: p.param.trim(), target: p.target })),
      ...(from.slide && { slide: from.slide }),
    });
    const done = await run(command, {
      undoToast: `${replacing ? "Replaced" : "Saved"} ${what} "${trimmed}"`,
    });
    setBusy(false);
    if (done) onClose();
  };

  const update = (i: number, patch: Partial<Draft>) => {
    setParams((all) => all.map((p, j) => (j === i ? { ...p, ...patch } : p)));
    setParamError(undefined);
  };

  return (
    <Dialog
      title={from.slide ? "Save slide as layout" : "Save as component"}
      className="save-component-dialog"
      onClose={onClose}
      onSubmit={() => void save()}
      actions={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={busy}>
            {replacing ? "Replace" : "Save"}
          </button>
        </>
      }
    >
      <DialogField
        label="Name"
        htmlFor={nameId}
        error={error}
        hint={
          replacing
            ? `Replaces the saved “${trimmed}”. Slides and copies made from it stay as they are.`
            : from.slide
              ? "Start new slides like this one from Slide → New slide from layout. Agents use it by this name."
              : `Insert copies of ${from.label} from the Components tab. Agents use it by this name.`
        }
      >
        <input
          id={nameId}
          type="text"
          value={name}
          maxLength={60}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            setName(e.target.value);
            setError(undefined);
          }}
          {...describedBy(nameId, error, true)}
        />
      </DialogField>
      <DialogField label="Description" htmlFor={descriptionId} hint="What it's for. Optional.">
        <input
          id={descriptionId}
          type="text"
          value={description}
          maxLength={500}
          placeholder="e.g. Feature card: a title and one line"
          onChange={(e) => setDescription(e.target.value)}
          {...describedBy(descriptionId, undefined, true)}
        />
      </DialogField>
      {params.length > 0 && (
        <fieldset className="component-params" aria-describedby={paramsId}>
          <legend>Params</legend>
          <p id={paramsId} className={paramError ? "dialog-error" : "dialog-hint"}>
            {paramError ??
              (from.slide
                ? "Texts an agent fills in when it starts a slide from it. Untick the ones that stay the same."
                : "Texts an agent fills in when it inserts a copy. Untick the ones that stay the same.")}
          </p>
          {params.map((p, i) => (
            <div key={p.target} className="component-param">
              <input
                type="checkbox"
                checked={p.keep}
                aria-label={`Make “${p.label}” a param`}
                onChange={(e) => update(i, { keep: e.target.checked })}
              />
              <input
                type="text"
                className="component-param-name"
                value={p.param}
                disabled={!p.keep}
                maxLength={40}
                spellCheck={false}
                aria-label={`Param name for “${p.label}”`}
                onChange={(e) => update(i, { param: e.target.value })}
              />
              <span className="component-param-label" title={p.label}>
                {p.label}
              </span>
            </div>
          ))}
        </fieldset>
      )}
    </Dialog>
  );
}
