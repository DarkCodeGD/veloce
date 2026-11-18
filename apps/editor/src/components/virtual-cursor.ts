/**
 * The cursor shown during an infinite scrub. While the pointer is locked the real cursor is
 * hidden and frozen, so this one stands in for it: it follows the raw movement and wraps to
 * the opposite edge when it leaves the window (Blender style).
 *
 * Plain DOM, positioned with a transform: it moves on every pointer event, so it stays out
 * of React rendering. Always `dispose()` it.
 */
import { wrap } from "../model/scrub.js";

// A horizontal double arrow (like `ew-resize`), white with a dark outline so it reads on any
// background. Its hotspot is the centre.
const ARROW = `<svg width="28" height="16" viewBox="0 0 28 16" aria-hidden="true">
  <path d="M1.5 8 7.5 2v4h13V2l6 6-6 6v-4h-13v4z" fill="#fff" stroke="#0d0e12"
    stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;

export class VirtualCursor {
  readonly #el: HTMLDivElement;
  #x: number;
  #y: number;

  constructor(x: number, y: number) {
    this.#x = x;
    this.#y = y;
    this.#el = document.createElement("div");
    this.#el.className = "virtual-cursor";
    this.#el.setAttribute("aria-hidden", "true");
    this.#el.innerHTML = ARROW;
    document.body.append(this.#el);
    this.#place();
  }

  get x() {
    return this.#x;
  }

  get y() {
    return this.#y;
  }

  /** Move by a pointer delta, wrapping around the window edges. */
  move(dx: number, dy: number) {
    this.#x = wrap(this.#x + dx, window.innerWidth);
    this.#y = wrap(this.#y + dy, window.innerHeight);
    this.#place();
  }

  dispose() {
    this.#el.remove();
  }

  #place() {
    this.#el.style.transform = `translate(${this.#x}px, ${this.#y}px) translate(-50%, -50%)`;
  }
}
