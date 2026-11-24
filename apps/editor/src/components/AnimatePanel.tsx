/**
 * The Animate panel (D106 depths 1 and 2, D118): the right panel of the Animate workspace.
 *
 * - **Motion**: the deck's motion level, and Play, which plays the slide on the canvas with
 *   the clicks taken for you.
 * - **Steps**: the slide's animations as they'll play (as the slide appears, then click by
 *   click). A row selects its animation and its layer.
 * - **Animation**: the selected animation, tuned with a few plain controls (effect, start,
 *   speed, delay, repeat) and its effect's own settings, generated from the effect's schema
 *   like the inspector's props (golden rule 5). Move earlier / later, preview, remove.
 * - **Add effect**: the effects that suit the selected layers. Resting the pointer on one
 *   previews it on the canvas; a click adds it.
 *
 * Every change is one transaction, the same ops an agent sends (golden rule 1); previews are
 * never ops (D106 §2).
 */
import {
  type Animation,
  type Deck,
  MOTION_LEVEL_SCALES,
  MOTION_LEVELS,
  type MotionLevel,
  type Node,
  resolveTime,
  type Slide,
  slideMotionLevel,
  slideMotionTokens,
  type Time,
  type Trigger,
} from "@veloce/core";
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  Clock,
  LogIn,
  LogOut,
  MousePointerClick,
  Play,
  Sparkles,
  Spline,
  Square,
  Trash,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { run } from "../actions.js";
import { playOnCanvas, stopOnCanvas, useCanvasPlayback } from "../canvas-playback.js";
import { registry } from "../editor-context.js";
import {
  addEffect,
  changeEffect,
  type EffectSummary,
  effectGallery,
  effectSuits,
  galleryPreview,
  moveAnimation,
  removeAnimations,
  SPEEDS,
  type StepRow,
  setEffectParam,
  setMotionLevel,
  setTrigger,
  soloAnimations,
  speedLabel,
  stepsList,
  updateAnimation,
} from "../model/animate.js";
import { propFields } from "../model/schema-fields.js";
import type { SlideIndex } from "../model/slide-index.js";
import { Group, NumberField, Section, SelectField, ToggleField } from "./fields.js";

interface Props {
  deck: Deck;
  slide: Slide;
  index: SlideIndex;
  selection: string[];
  onSelect(ids: string[]): void;
}

const describeEffect = (name: string) => registry.describeEffect(name);
const EFFECTS: readonly EffectSummary[] = registry.describeEffects();

/** How long a pointer rests on an effect before it previews: passing over doesn't. */
const PREVIEW_DELAY_MS = 150;

const TRIGGERS: ReadonlyArray<{ value: Trigger; label: string }> = [
  { value: "onClick", label: "On click" },
  { value: "withPrevious", label: "With previous" },
  { value: "afterPrevious", label: "After previous" },
];

const REPEATS = [
  { value: "2", label: "2 times" },
  { value: "3", label: "3 times" },
  { value: "5", label: "5 times" },
  { value: "forever", label: "Until the slide changes" },
];

export function AnimatePanel({ deck, slide, index, selection, onSelect }: Props) {
  const playing = useCanvasPlayback();
  const steps = useMemo(() => stepsList(slide, index, describeEffect), [slide, index]);
  const animations = slide.animations ?? [];

  // The animation being tuned: picked in the list, or the first of the layer selected on
  // the canvas. It follows the selection, so clicking a layer shows its animation.
  const [tunedId, setTunedId] = useState<string | null>(null);
  const tuned = animations.find((a) => a.id === tunedId) ?? null;
  useEffect(() => {
    if (tuned && selection.includes(tuned.target)) return;
    const first = animations.find((a) => selection.includes(a.target));
    setTunedId(first?.id ?? null);
  }, [selection, tuned, animations]);

  const pick = (row: StepRow) => {
    setTunedId(row.animation.id);
    if (index.nodes.has(row.animation.target)) onSelect([row.animation.target]);
  };

  const layers = selection.flatMap((id) => {
    const node = index.nodes.get(id)?.node;
    return node && id !== index.rootId ? [node] : [];
  });

  return (
    <section className="inspector animate-panel" aria-label="Animate">
      <MotionSection deck={deck} slide={slide} playing={playing} />
      <Section title="Steps">
        {steps.length === 0 ? (
          <p className="inspector-hint">
            Nothing moves on this slide yet. Select a layer, then pick an effect below.
          </p>
        ) : (
          <StepsList
            steps={steps}
            tunedId={tuned?.id ?? null}
            onPick={pick}
            onRemove={(id) => void run(removeAnimations([id]))}
          />
        )}
      </Section>
      {tuned && <TuneSection deck={deck} slide={slide} index={index} animation={tuned} />}
      <GallerySection
        deck={deck}
        slide={slide}
        layers={layers}
        after={tuned?.id}
        onAdded={(id) => setTunedId(id)}
      />
    </section>
  );
}

// ── Motion: the level and Play ────────────────────────────────────────────────────────

function MotionSection({
  deck,
  slide,
  playing,
}: {
  deck: Deck;
  slide: Slide;
  playing: string | null;
}) {
  const level = slideMotionLevel(deck, slide);
  const hasAnimations = (slide.animations?.length ?? 0) > 0;
  return (
    <Section
      title="Motion"
      action={
        <button
          type="button"
          className="button animate-play"
          disabled={!hasAnimations && playing === null}
          onClick={() =>
            playing ? stopOnCanvas() : playOnCanvas({ deck, slideId: slide.id, mode: "slide" })
          }
        >
          {playing ? <Square size={12} aria-hidden /> : <Play size={12} aria-hidden />}
          {playing ? "Stop" : "Play"}
        </button>
      }
    >
      <SelectField
        label="Level"
        value={deck.motionLevel}
        defaultValue="subtle"
        options={MOTION_LEVELS.map((l) => ({ value: l, label: capitalize(l) }))}
        onCommit={(v) => void run(setMotionLevel((v as MotionLevel | null) ?? null))}
      />
      <p className="inspector-hint">
        {MOTION_LEVEL_SCALES[level].summary}
        {slide.motionLevel && ` This slide moves at ${slide.motionLevel}.`}
      </p>
    </Section>
  );
}

// ── Steps ─────────────────────────────────────────────────────────────────────────────

const KIND_ICON: Record<StepRow["kind"], ReactNode> = {
  entrance: <LogIn size={14} aria-label="Entrance" />,
  emphasis: <Sparkles size={14} aria-label="Emphasis" />,
  exit: <LogOut size={14} aria-label="Exit" />,
  custom: <Spline size={14} aria-label="Keyframes" />,
  missing: <CircleAlert size={14} aria-label="Effect not installed" />,
};

function StepsList({
  steps,
  tunedId,
  onPick,
  onRemove,
}: {
  steps: ReturnType<typeof stepsList>;
  tunedId: string | null;
  onPick(row: StepRow): void;
  onRemove(id: string): void;
}) {
  const rows = steps.flatMap((s) => s.rows);
  const listRef = useRef<HTMLDivElement>(null);
  // ↑/↓ walk the list, Delete removes, like the Layers panel.
  const onKeyDown = (e: KeyboardEvent) => {
    const at = rows.findIndex((r) => r.animation.id === tunedId);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const next =
        rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) {
        onPick(next);
        listRef.current
          ?.querySelector<HTMLElement>(`[data-animation-id="${CSS.escape(next.animation.id)}"]`)
          ?.focus();
      }
    } else if ((e.key === "Delete" || e.key === "Backspace") && tunedId) {
      onRemove(tunedId);
    } else return;
    e.preventDefault();
    e.stopPropagation(); // not the canvas's Delete (which removes the layer)
  };
  return (
    <div className="animate-steps" ref={listRef}>
      {steps.map((step) => (
        <div key={step.step} className="animate-step">
          <h4 className="inspector-group-title">{step.title}</h4>
          <ul aria-label={step.title}>
            {step.rows.map((row) => (
              <li key={row.animation.id}>
                <button
                  type="button"
                  className={`animate-row${row.animation.id === tunedId ? " is-selected" : ""}`}
                  aria-pressed={row.animation.id === tunedId}
                  data-animation-id={row.animation.id}
                  onClick={() => onPick(row)}
                  onKeyDown={onKeyDown}
                >
                  <span className={`animate-kind is-${row.kind}`}>{KIND_ICON[row.kind]}</span>
                  <span className="animate-row-text">
                    <span className="animate-row-layer">{row.layer}</span>
                    <span className="animate-row-effect">{row.effect}</span>
                  </span>
                  {row.trigger === "afterPrevious" && (
                    <Clock size={12} className="animate-trigger" aria-label="After previous" />
                  )}
                  {row.trigger === "onClick" && (
                    <MousePointerClick
                      size={12}
                      className="animate-trigger"
                      aria-label="On click"
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ── Tune the selected animation ───────────────────────────────────────────────────────

function TuneSection({
  deck,
  slide,
  index,
  animation,
}: {
  deck: Deck;
  slide: Slide;
  index: SlideIndex;
  animation: Animation;
}) {
  const playing = useCanvasPlayback();
  const target = index.nodes.get(animation.target)?.node;
  const tokens = slideMotionTokens(deck, slide);
  const effect = animation.effect ? describeEffect(animation.effect.name) : undefined;
  const set = (patch: Record<string, unknown>, label: string) =>
    void run(updateAnimation(animation.id, patch, label));

  // The effects it can change to: those that suit its layer, and its own, whatever it is.
  const effectOptions = EFFECTS.filter(
    (e) => e.name === effect?.name || !target || effectSuits(e, [target]),
  ).map((e) => ({ value: e.name, label: `${e.title} (${e.kind})` }));

  // Its effect's own length, for "Default · 400 ms".
  const own = effectDuration(animation, target, tokens);
  const duration = animation.duration;
  const speedOptions = [
    ...SPEEDS.map((s) => ({ value: s.value, label: speedLabel(s, tokens) })),
    ...(typeof duration === "number" ? [{ value: String(duration), label: `${duration} ms` }] : []),
  ];

  const order = slide.animations ?? [];
  const at = order.findIndex((a) => a.id === animation.id);
  return (
    <Section title={effect?.title ?? animation.effect?.name ?? "Keyframes"}>
      {animation.effect && !effect && (
        <p className="inspector-hint">
          "{animation.effect.name}" comes from a plugin that isn't installed, so it doesn't move
          here. Pick another effect, or keep it for whoever has the plugin.
        </p>
      )}
      {!animation.effect && (
        <p className="inspector-hint">
          Keyframes an agent or the timeline made. Picking an effect replaces them.
        </p>
      )}
      <SelectField
        label="Effect"
        value={animation.effect?.name}
        defaultLabel={animation.effect ? undefined : "Keyframes"}
        options={
          animation.effect && !effect
            ? [{ value: animation.effect.name, label: animation.effect.name }, ...effectOptions]
            : effectOptions
        }
        onCommit={(v) => {
          const next = typeof v === "string" ? describeEffect(v) : undefined;
          if (next) void run(changeEffect(animation, next));
        }}
      />
      <SelectField
        label="Start"
        value={animation.trigger}
        defaultValue="onClick"
        options={TRIGGERS}
        onCommit={(v) => void run(setTrigger(animation, (v as Trigger | null) ?? "onClick"))}
      />
      <SelectField
        label="Speed"
        value={duration === undefined ? undefined : String(duration)}
        defaultLabel={own === null ? "Default" : `Default · ${own} ms`}
        options={speedOptions}
        onCommit={(v) =>
          set({ duration: v === null ? null : timeValue(v as string) }, "Change speed")
        }
      />
      <NumberField
        label="Delay"
        value={typeof animation.delay === "number" ? animation.delay : undefined}
        placeholder={typeof animation.delay === "string" ? animation.delay : "0"}
        min={0}
        max={60_000}
        step={50}
        integer
        suffix="ms"
        onCommit={(v) => set({ delay: v }, "Change delay")}
      />
      <SelectField
        label="Repeat"
        value={animation.repeat === undefined ? undefined : String(animation.repeat)}
        defaultLabel="Once"
        options={
          typeof animation.repeat === "number" &&
          !REPEATS.some((r) => r.value === String(animation.repeat))
            ? [...REPEATS, { value: String(animation.repeat), label: `${animation.repeat} times` }]
            : REPEATS
        }
        onCommit={(v) =>
          set(
            { repeat: v === null ? null : v === "forever" ? "forever" : Number(v) },
            "Change repeat",
          )
        }
      />
      {effect && <EffectParams animation={animation} />}
      <div className="animate-actions">
        <button
          type="button"
          className="button"
          onClick={() =>
            playing === "once"
              ? stopOnCanvas()
              : playOnCanvas({
                  deck: soloAnimations(deck, slide.id, [animation]),
                  slideId: slide.id,
                  mode: "once",
                })
          }
        >
          {playing === "once" ? <Square size={12} aria-hidden /> : <Play size={12} aria-hidden />}
          Preview
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Move earlier"
          data-tip="Move earlier"
          disabled={at <= 0}
          onClick={() => void run(moveAnimation(slide, animation.id, -1))}
        >
          <ArrowUp size={14} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Move later"
          data-tip="Move later"
          disabled={at < 0 || at >= order.length - 1}
          onClick={() => void run(moveAnimation(slide, animation.id, 1))}
        >
          <ArrowDown size={14} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Remove animation"
          data-tip="Remove animation"
          onClick={() => void run(removeAnimations([animation.id]))}
        >
          <Trash size={14} />
        </button>
      </div>
    </Section>
  );
}

/**
 * The effect's own settings (direction, distance…), from its params schema like the
 * inspector's props. Left unset, they follow the motion level (D117 §4).
 */
function EffectParams({ animation }: { animation: Animation }) {
  const name = animation.effect?.name ?? "";
  const definition = registry.getEffect(name)?.definition;
  if (!definition) return null;
  const fields = propFields({ propsSchema: definition.paramsSchema });
  if (fields.length === 0) return null;
  const params = animation.effect?.params ?? {};
  const commit = (key: string) => (value: unknown) =>
    void run(setEffectParam(animation, key, value));
  return (
    <Group title="Settings">
      {fields.map((field) => {
        const value = params[field.key];
        const common = { label: field.label, onCommit: commit(field.key) };
        switch (field.kind) {
          case "enum":
            return (
              <SelectField
                key={field.key}
                {...common}
                value={value as string | undefined}
                options={field.options}
                defaultLabel="Default"
              />
            );
          case "boolean":
            return <ToggleField key={field.key} {...common} value={value as boolean | undefined} />;
          case "number":
            return (
              <NumberField
                key={field.key}
                {...common}
                value={value as number | undefined}
                placeholder="Auto"
                min={field.min}
                max={field.max}
                integer={field.integer}
              />
            );
          default:
            return null; // other kinds of settings wait for the timeline (depth 3)
        }
      })}
    </Group>
  );
}

// ── Add effect ────────────────────────────────────────────────────────────────────────

function GallerySection({
  deck,
  slide,
  layers,
  after,
  onAdded,
}: {
  deck: Deck;
  slide: Slide;
  layers: Node[];
  after: string | undefined;
  onAdded(id: string): void;
}) {
  const groups = useMemo(() => effectGallery(EFFECTS, layers), [layers]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const ids = layers.map((n) => n.id);

  if (layers.length === 0) {
    return (
      <Section title="Add effect">
        <p className="inspector-hint">Select a layer on the slide to animate it.</p>
      </Section>
    );
  }
  const preview = (effect: EffectSummary) => {
    cancel();
    timer.current = setTimeout(
      () =>
        playOnCanvas({
          deck: soloAnimations(deck, slide.id, galleryPreview(ids, effect)),
          slideId: slide.id,
          mode: "loop",
        }),
      PREVIEW_DELAY_MS,
    );
  };
  const leave = () => {
    cancel();
    stopOnCanvas();
  };
  const add = async (effect: EffectSummary) => {
    leave();
    const added = addEffect(slide, ids, effect, after);
    if (added && (await run(added.command)) && added.ids[0]) onAdded(added.ids[0]);
  };
  return (
    <Section title="Add effect">
      {groups.map((group) => (
        <Group key={group.kind} title={group.title}>
          <div className="effect-gallery" onPointerLeave={leave}>
            {group.effects.map((effect) => (
              <button
                key={effect.name}
                type="button"
                className={`effect-tile is-${effect.kind}`}
                data-tip={effect.description}
                onPointerEnter={() => preview(effect)}
                onClick={() => void add(effect)}
              >
                {effect.title}
              </button>
            ))}
          </div>
        </Group>
      ))}
    </Section>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "$motion.fast" stays a token (it follows the level); "750" is milliseconds. */
const timeValue = (value: string): Time =>
  value.startsWith("$") ? (value as Time) : Number(value);

/** How long the animation's effect plays when it sets no duration, in ms (null: unknown). */
function effectDuration(
  animation: Animation,
  target: Node | undefined,
  tokens: ReturnType<typeof slideMotionTokens>,
): number | null {
  if (!animation.effect || !target) return null;
  const resolved = registry.resolveEffect(animation.effect, { animation, target, tokens });
  return resolveTime(resolved?.duration ?? "$motion.normal", tokens);
}
