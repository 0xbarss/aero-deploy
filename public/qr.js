import { encode } from "./vendor/uqr.js";

/** Light modules around the code; the QR specification asks for four. */
export const QUIET_ZONE = 4;

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * The modules of a QR code for `text` (true is dark), at error correction level M.
 * Throws a RangeError when the text is too long for any QR code.
 * @param {string} text
 * @returns {boolean[][]}
 */
export function qrModules(text) {
  return encode(text, { ecc: "M", border: 0 }).data;
}

/**
 * SVG path data that draws the dark modules, one rectangle per run in a row.
 * @param {ReadonlyArray<ReadonlyArray<boolean>>} modules
 * @param {number} offset added to every x and y position
 * @returns {string}
 */
export function modulesPath(modules, offset) {
  const rectangles = [];
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

/**
 * What to draw for `text`: the side length in modules, quiet zone included, and the path.
 * @param {string} text
 * @returns {{ side: number, path: string }}
 */
export function qrDrawing(text) {
  const modules = qrModules(text);
  return { side: modules.length + 2 * QUIET_ZONE, path: modulesPath(modules, QUIET_ZONE) };
}

/**
 * An inline SVG with black modules on a white square, whatever the page colours are. Built with
 * DOM calls, so the page needs no image source in its content security policy.
 * @param {string} text
 * @param {string} label read out by screen readers
 * @returns {SVGSVGElement}
 */
export function qrElement(text, label) {
  const { side, path } = qrDrawing(text);
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", `0 0 ${side} ${side}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  svg.setAttribute("shape-rendering", "crispEdges");

  const background = document.createElementNS(SVG_NAMESPACE, "rect");
  background.setAttribute("width", String(side));
  background.setAttribute("height", String(side));
  background.setAttribute("fill", "#fff");

  const modules = document.createElementNS(SVG_NAMESPACE, "path");
  modules.setAttribute("d", path);
  modules.setAttribute("fill", "#000");

  svg.append(background, modules);
  return svg;
}
