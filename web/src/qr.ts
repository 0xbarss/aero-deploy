import { encode } from "./vendor/uqr.js";

/** Light modules around the code; the QR specification asks for four. */
export const QUIET_ZONE = 4;

/**
 * The modules of a QR code for `text` (true is dark), at error correction level M.
 * Throws a RangeError when the text is too long for any QR code.
 */
export function qrModules(text: string): boolean[][] {
  return encode(text, { ecc: "M", border: 0 }).data;
}

/**
 * SVG path data that draws the dark modules, one rectangle per run in a row.
 * @param modules
 * @param offset added to every x and y position
 */
export function modulesPath(
  modules: ReadonlyArray<ReadonlyArray<boolean>>,
  offset: number,
): string {
  const rectangles: string[] = [];
  modules.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) {
        x += 1;
      }
      const run = x - start;
      rectangles.push(`M${start + offset} ${y + offset}h${run}v1h-${run}z`);
    }
  });
  return rectangles.join("");
}

/** What to draw for `text`: the side length in modules, quiet zone included, and the path. */
export function qrDrawing(text: string): { side: number; path: string } {
  const modules = qrModules(text);
  return { side: modules.length + 2 * QUIET_ZONE, path: modulesPath(modules, QUIET_ZONE) };
}
