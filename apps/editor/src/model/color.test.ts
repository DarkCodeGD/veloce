import { describe, expect, it } from "vitest";
import {
  baseToken,
  colorLabel,
  fromPicked,
  hsvToHex,
  isColorText,
  keepOpacity,
  opacityOf,
  parseTypedColor,
  pickerColor,
  toHsva,
  withOpacity,
} from "./color.js";

describe("color opacity", () => {
  it("reads the opacity of tokens and hex colors", () => {
    expect(opacityOf("$color.primary")).toBe(100);
    expect(opacityOf("$color.primary/30")).toBe(30);
    expect(opacityOf("#4f46e5")).toBe(100);
    expect(opacityOf("#4f46e580")).toBe(50);
    expect(opacityOf("transparent")).toBeNull();
    expect(opacityOf({ type: "linear-gradient", stops: [] })).toBeNull();
    expect(opacityOf(undefined)).toBeNull();
  });

  it("sets it: a token gets /NN, a hex gets its alpha byte, 100 is the plain form", () => {
    expect(withOpacity("$color.secondary", 30)).toBe("$color.secondary/30");
    expect(withOpacity("$color.secondary/30", 100)).toBe("$color.secondary");
    expect(withOpacity("$color.secondary/30", 0)).toBe("$color.secondary/0");
    expect(withOpacity("#4f46e5", 50)).toBe("#4f46e580");
    expect(withOpacity("#4f46e580", 100)).toBe("#4f46e5");
    expect(withOpacity("#fff", 25)).toBe("#ffffff40");
    expect(withOpacity("$color.primary", 140)).toBe("$color.primary"); // clamped
    expect(withOpacity("$color.primary", 33.4)).toBe("$color.primary/33"); // whole percents
    expect(withOpacity("transparent", 50)).toBe("transparent");
  });

  it("keeps the opacity when the color changes", () => {
    expect(keepOpacity("$color.primary/30", "$color.accent")).toBe("$color.accent/30");
    expect(keepOpacity("$color.primary/30", "#ff0000")).toBe("#ff00004d");
    expect(keepOpacity("#00000080", "$color.text")).toBe("$color.text/50");
    expect(keepOpacity(undefined, "$color.text")).toBe("$color.text");
    expect(keepOpacity("$color.primary", "$color.accent")).toBe("$color.accent");
  });

  it("finds the token behind a color, and accepts what the document accepts", () => {
    expect(baseToken("$color.primary/30")).toBe("$color.primary");
    expect(baseToken("#123456")).toBeUndefined();
    expect(isColorText("$color.primary/30")).toBe(true);
    expect(isColorText("#4f46e5cc")).toBe(true);
    expect(isColorText("$color.primary/300")).toBe(false);
    expect(isColorText("red")).toBe(false);
  });
});

describe("the color field's text", () => {
  const colors = { primary: "#4f46e5", "on-primary": "#ffffff" };

  it("shows a token by name and a hex without alpha (the opacity has its own box)", () => {
    expect(colorLabel("$color.on-primary/30")).toBe("on-primary");
    expect(colorLabel("#4f46e580")).toBe("#4f46e5");
    expect(colorLabel("#f008")).toBe("#f00");
    expect(colorLabel("transparent")).toBe("transparent");
    expect(colorLabel(undefined)).toBe("");
  });

  it("accepts theme names, hex without #, and full values; keeps the opacity unless given", () => {
    expect(parseTypedColor("primary", colors, "#00000080")).toBe("$color.primary/50");
    expect(parseTypedColor("primary/30", colors, undefined)).toBe("$color.primary/30");
    expect(parseTypedColor("ff3366", colors, "$color.primary/30")).toBe("#ff33664d");
    expect(parseTypedColor("#ff336680", colors, "$color.primary/30")).toBe("#ff336680");
    expect(parseTypedColor("$color.primary", colors, undefined)).toBe("$color.primary");
    expect(parseTypedColor("transparent", colors, "$color.primary/30")).toBe("transparent");
    expect(parseTypedColor("nope", colors, undefined)).toBeNull();
    expect(parseTypedColor("primary/300", colors, undefined)).toBeNull();
  });
});

describe("picker color model", () => {
  it("round-trips hex through HSV", () => {
    for (const hex of ["#4f46e5", "#ff3366", "#000000", "#ffffff", "#808080", "#0a6fa8"]) {
      expect(hsvToHex(toHsva(hex, 1))).toBe(hex);
    }
    expect(toHsva("#ff0000", 0.5)).toEqual({ h: 0, s: 1, v: 1, a: 0.5 });
    expect(toHsva("#00ff00", 1).h).toBe(120);
  });

  it("keeps the hue on grays and the saturation on black", () => {
    const blue = toHsva("#0000ff", 1);
    expect(toHsva("#808080", 1, blue).h).toBe(240);
    expect(toHsva("#000000", 1, blue)).toMatchObject({ h: 240, s: 1, v: 0 });
  });

  it("reads a color's opacity, and maps a pick back: alpha only keeps the token", () => {
    expect(pickerColor("#4f46e580", "$color.primary/30")).toEqual({ hex: "#4f46e5", alpha: 0.3 });
    expect(pickerColor(undefined, undefined)).toEqual({ hex: "#000000", alpha: 1 });
    const shown = "#4f46e5";
    expect(fromPicked("$color.primary/30", shown, { hex: "#4F46E5", alpha: 0.6 })).toBe(
      "$color.primary/60",
    );
    expect(fromPicked("$color.primary/30", shown, { hex: "#ff0000", alpha: 0.3 })).toBe(
      "#ff00004d",
    );
    expect(fromPicked("#4f46e5", shown, { hex: shown, alpha: 1 })).toBe("#4f46e5");
    expect(fromPicked(undefined, shown, { hex: shown, alpha: 0.5 })).toBe("#4f46e580");
  });
});
