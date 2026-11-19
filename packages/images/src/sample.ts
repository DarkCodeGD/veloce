/**
 * A small stand-in for a big image, to search for its quality fast: full-resolution tiles
 * from where compression shows most, stitched into one image. Encoding it takes a tenth of
 * the time of the whole image, and since the tiles are at full resolution, artifacts look
 * exactly as they will in the real file (a scaled-down preview would blur them away).
 *
 * The tiles: the most detailed areas (edges, text, texture: where blocking and ringing show)
 * and the smoothest one that isn't flat (skies, gradients: where banding shows).
 */
import type { Pixels } from "./codecs.ts";

/** Tile edge in pixels: a multiple of 16, so JPEG's blocks line up with the tiles. */
export const TILE = 256;
const DETAILED = 5;

/** Mean absolute brightness difference between neighbours: how busy a tile is. */
function detail(p: Pixels, x0: number, y0: number, size: number): number {
  const { data, width } = p;
  const y = (i: number) =>
    0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
  let sum = 0;
  let n = 0;
  // Every other pixel is plenty to rank tiles.
  for (let row = y0; row < y0 + size - 2; row += 2) {
    for (let col = x0; col < x0 + size - 2; col += 2) {
      const i = (row * width + col) * 4;
      const here = y(i);
      sum += Math.abs(here - y(i + 8)) + Math.abs(here - y(i + width * 8));
      n++;
    }
  }
  return n ? sum / n : 0;
}

function copyTile(from: Pixels, x0: number, y0: number, to: Pixels, tx: number, ty: number) {
  for (let row = 0; row < TILE; row++) {
    const src = ((y0 + row) * from.width + x0) * 4;
    const dst = ((ty + row) * to.width + tx) * 4;
    to.data.set(from.data.subarray(src, src + TILE * 4), dst);
  }
}

/**
 * The tiles as one image (3 × 2 tiles), or the image itself if it's already small. Tiles
 * are taken on a grid, so they never overlap.
 */
export function sampleTiles(p: Pixels): Pixels {
  const cols = Math.floor(p.width / TILE);
  const rows = Math.floor(p.height / TILE);
  if (cols * rows <= DETAILED + 1) return p;
  const tiles: Array<{ x: number; y: number; detail: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * TILE;
      const y = r * TILE;
      tiles.push({ x, y, detail: detail(p, x, y, TILE) });
    }
  }
  tiles.sort((a, b) => b.detail - a.detail);
  const chosen = tiles.slice(0, DETAILED);
  // The smoothest tile with some gradient in it (perfectly flat ones can't band).
  const smooth = [...tiles].reverse().find((t) => t.detail > 0.15 && !chosen.includes(t));
  chosen.push(smooth ?? (tiles[DETAILED] as (typeof tiles)[number]));
  const out: Pixels = {
    data: new Uint8ClampedArray(TILE * 3 * TILE * 2 * 4),
    width: TILE * 3,
    height: TILE * 2,
  };
  chosen.forEach((t, i) => {
    copyTile(p, t.x, t.y, out, (i % 3) * TILE, Math.floor(i / 3) * TILE);
  });
  return out;
}
