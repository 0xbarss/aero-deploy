import { describe, expect, it } from "vitest";
import { QUIET_ZONE, modulesPath, qrDrawing, qrModules } from "../../public/qr.js";

const DOWNLOAD_URL = "http://192.168.1.20:3000/api/apks/download/12";

/** True where a 7x7 finder pattern has a dark module. */
function finderModule(row: number, col: number): boolean {
  const ring = Math.max(Math.abs(row - 3), Math.abs(col - 3));
  return ring !== 2;
}

function hasFinderAt(modules: boolean[][], top: number, left: number): boolean {
  for (let row = 0; row < 7; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      if (modules[top + row]?.[left + col] !== finderModule(row, col)) {
        return false;
      }
    }
  }
  return true;
}

/** Rebuilds the module grid from the path text, so the drawing can be compared with the matrix. */
function gridFromPath(path: string, side: number): boolean[][] {
  const grid = Array.from({ length: side }, () => Array.from({ length: side }, () => false));
  for (const match of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
    const [, x, y, run, back] = match.map(Number) as [number, number, number, number, number];
    expect(back).toBe(run);
    for (let col = x; col < x + run; col += 1) {
      const row = grid[y];
      if (row === undefined) {
        throw new Error(`path row ${y} is outside the grid`);
      }
      expect(row[col]).toBe(false);
      row[col] = true;
    }
  }
  return grid;
}

describe("qrModules", () => {
  it("returns a square grid with a valid QR code side length", () => {
    const modules = qrModules(DOWNLOAD_URL);

    expect(modules.length).toBeGreaterThanOrEqual(21);
    expect((modules.length - 17) % 4).toBe(0);
    for (const row of modules) {
      expect(row).toHaveLength(modules.length);
    }
  });

  it("has finder patterns in three corners and not in the fourth", () => {
    const modules = qrModules(DOWNLOAD_URL);
    const last = modules.length - 7;

    expect(hasFinderAt(modules, 0, 0)).toBe(true);
    expect(hasFinderAt(modules, 0, last)).toBe(true);
    expect(hasFinderAt(modules, last, 0)).toBe(true);
    expect(hasFinderAt(modules, last, last)).toBe(false);
  });

  it("gives the same grid for the same text and another grid for other text", () => {
    expect(qrModules(DOWNLOAD_URL)).toEqual(qrModules(DOWNLOAD_URL));
    expect(qrModules(DOWNLOAD_URL)).not.toEqual(qrModules(`${DOWNLOAD_URL}0`));
  });

  it("uses a larger grid for longer text", () => {
    const short = qrModules("http://a.lan/1");
    const long = qrModules(`http://a.lan/${"x".repeat(150)}`);

    expect(long.length).toBeGreaterThan(short.length);
  });

  it("throws when the text cannot fit in any QR code", () => {
    expect(() => qrModules("x".repeat(5000))).toThrow();
  });
});

describe("modulesPath", () => {
  it("draws each run of dark modules in a row as one rectangle", () => {
    expect(modulesPath([[true, true, false, true]], 0)).toBe("M0 0h2v1h-2zM3 0h1v1h-1z");
  });

  it("moves every rectangle by the offset", () => {
    expect(
      modulesPath(
        [
          [false, false],
          [false, true],
        ],
        4,
      ),
    ).toBe("M5 5h1v1h-1z");
  });

  it("is empty when no module is dark", () => {
    expect(modulesPath([[false, false]], 4)).toBe("");
  });
});

describe("qrDrawing", () => {
  it("surrounds the code with a quiet zone of four modules", () => {
    const modules = qrModules(DOWNLOAD_URL);
    const drawing = qrDrawing(DOWNLOAD_URL);

    expect(QUIET_ZONE).toBe(4);
    expect(drawing.side).toBe(modules.length + 2 * QUIET_ZONE);
  });

  it("draws exactly the dark modules of the grid", () => {
    const modules = qrModules(DOWNLOAD_URL);
    const drawing = qrDrawing(DOWNLOAD_URL);
    const drawn = gridFromPath(drawing.path, drawing.side);

    for (let row = 0; row < drawing.side; row += 1) {
      for (let col = 0; col < drawing.side; col += 1) {
        const inCode =
          row >= QUIET_ZONE &&
          col >= QUIET_ZONE &&
          row < QUIET_ZONE + modules.length &&
          col < QUIET_ZONE + modules.length;
        const expected = inCode ? modules[row - QUIET_ZONE]?.[col - QUIET_ZONE] : false;
        expect(drawn[row]?.[col], `module at row ${row}, column ${col}`).toBe(expected);
      }
    }
  });

  it("contains only numbers and path commands", () => {
    expect(qrDrawing(DOWNLOAD_URL).path).toMatch(/^[MhvzZ\d\s-]+$/);
  });
});
