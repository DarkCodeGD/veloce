import { describe, expect, it, vi } from "vitest";
import { modalStore, trackModal } from "./popup-host.js";

const fake = (name: string) => ({ name }) as unknown as HTMLDialogElement;

describe("open modal dialogs (D108)", () => {
  it("knows the topmost one as dialogs open and close, in any order", () => {
    const changed = vi.fn();
    const unsubscribe = modalStore.subscribe(changed);
    expect(modalStore.top()).toBeNull();
    const a = fake("a");
    const b = fake("b");
    const closeA = trackModal(a);
    const closeB = trackModal(b);
    expect(modalStore.top()).toBe(b); // the last opened is on top
    closeA(); // one underneath closes first
    expect(modalStore.top()).toBe(b);
    closeB();
    expect(modalStore.top()).toBeNull();
    expect(changed).toHaveBeenCalledTimes(4);
    unsubscribe();
  });
});
