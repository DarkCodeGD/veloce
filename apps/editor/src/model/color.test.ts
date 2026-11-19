import { describe, expect, it } from "vitest";
import { baseToken, isColorText, keepOpacity, opacityOf, withOpacity } from "./color.js";

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
