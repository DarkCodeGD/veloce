/**
 * Bundled fonts (SIL Open Font License 1.1), registered under the exact family names the
 * themes use (core's BUNDLED_FONTS: "Inter", "Fraunces"…). Bundling means a deck looks the same
 * on every machine and in headless screenshots. Each face only downloads when a slide uses
 * its family and characters (Latin + Latin Extended here; Inter also covers Cyrillic, Greek
 * and Vietnamese).
 */
import frauncesLatinExtItalic from "@fontsource-variable/fraunces/files/fraunces-latin-ext-wght-italic.woff2?url";
import frauncesLatinExt from "@fontsource-variable/fraunces/files/fraunces-latin-ext-wght-normal.woff2?url";
import frauncesLatinItalic from "@fontsource-variable/fraunces/files/fraunces-latin-wght-italic.woff2?url";
import frauncesLatin from "@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2?url";
import interCyrillic from "@fontsource-variable/inter/files/inter-cyrillic-wght-normal.woff2?url";
import interGreek from "@fontsource-variable/inter/files/inter-greek-wght-normal.woff2?url";
import interLatinExtItalic from "@fontsource-variable/inter/files/inter-latin-ext-wght-italic.woff2?url";
import interLatinExt from "@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2?url";
import interLatinItalic from "@fontsource-variable/inter/files/inter-latin-wght-italic.woff2?url";
import interLatin from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import interVietnamese from "@fontsource-variable/inter/files/inter-vietnamese-wght-normal.woff2?url";
import monoLatinExt from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-ext-wght-normal.woff2?url";
import monoLatin from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url";
import loraLatinExtItalic from "@fontsource-variable/lora/files/lora-latin-ext-wght-italic.woff2?url";
import loraLatinExt from "@fontsource-variable/lora/files/lora-latin-ext-wght-normal.woff2?url";
import loraLatinItalic from "@fontsource-variable/lora/files/lora-latin-wght-italic.woff2?url";
import loraLatin from "@fontsource-variable/lora/files/lora-latin-wght-normal.woff2?url";
import manropeLatinExt from "@fontsource-variable/manrope/files/manrope-latin-ext-wght-normal.woff2?url";
import manropeLatin from "@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2?url";
import groteskLatinExt from "@fontsource-variable/space-grotesk/files/space-grotesk-latin-ext-wght-normal.woff2?url";
import groteskLatin from "@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2?url";

const RANGES = {
  latin:
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
  latinExt:
    "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
  cyrillic: "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116",
  greek: "U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF",
  vietnamese:
    "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB",
};

const FACES: Array<[family: string, url: string, range: string, style?: "italic"]> = [
  ["Inter", interLatin, RANGES.latin],
  ["Inter", interLatinExt, RANGES.latinExt],
  ["Inter", interCyrillic, RANGES.cyrillic],
  ["Inter", interGreek, RANGES.greek],
  ["Inter", interVietnamese, RANGES.vietnamese],
  ["Inter", interLatinItalic, RANGES.latin, "italic"],
  ["Inter", interLatinExtItalic, RANGES.latinExt, "italic"],
  ["JetBrains Mono", monoLatin, RANGES.latin],
  ["JetBrains Mono", monoLatinExt, RANGES.latinExt],
  ["Manrope", manropeLatin, RANGES.latin],
  ["Manrope", manropeLatinExt, RANGES.latinExt],
  ["Space Grotesk", groteskLatin, RANGES.latin],
  ["Space Grotesk", groteskLatinExt, RANGES.latinExt],
  ["Fraunces", frauncesLatin, RANGES.latin],
  ["Fraunces", frauncesLatinExt, RANGES.latinExt],
  ["Fraunces", frauncesLatinItalic, RANGES.latin, "italic"],
  ["Fraunces", frauncesLatinExtItalic, RANGES.latinExt, "italic"],
  ["Lora", loraLatin, RANGES.latin],
  ["Lora", loraLatinExt, RANGES.latinExt],
  ["Lora", loraLatinItalic, RANGES.latin, "italic"],
  ["Lora", loraLatinExtItalic, RANGES.latinExt, "italic"],
];

/** Fetched at startup: the default theme's fonts. The rest load when a slide uses them. */
const EAGER = new Set(["Inter", "JetBrains Mono"]);

let loading: Promise<void> | null = null;

/** Register the bundled fonts once; resolves when the Latin faces are ready to use. */
export function loadFonts(): Promise<void> {
  loading ??= (async () => {
    const faces = FACES.map(([family, url, unicodeRange, style]) => {
      const face = new FontFace(family, `url(${JSON.stringify(url)}) format("woff2")`, {
        weight: "100 900",
        style: style ?? "normal",
        unicodeRange,
        display: "block",
      });
      document.fonts.add(face);
      return { face, eager: EAGER.has(family) && unicodeRange === RANGES.latin && !style };
    });
    // The default fonts' Latin regular is on almost every slide: load it now so the first render
    // (and measurement) uses the real font. The rest load on demand, and `document.fonts.ready`
    // (which measurement and previews await) waits for them.
    await Promise.all(faces.filter((f) => f.eager).map((f) => f.face.load().catch(() => {})));
  })();
  return loading;
}
