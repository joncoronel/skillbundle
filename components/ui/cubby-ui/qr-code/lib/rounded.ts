export interface CornerRadii {
  topLeft: boolean;
  topRight: boolean;
  bottomRight: boolean;
  bottomLeft: boolean;
}

/** Reads a module, treating out-of-bounds cells as empty. */
function isFilled(modules: boolean[][], x: number, y: number): boolean {
  return (
    y >= 0 &&
    y < modules.length &&
    x >= 0 &&
    x < modules[y].length &&
    modules[y][x]
  );
}

/** Computes which corners of the module at (x, y) are convex and rounded. */
export function cornerRadii(
  modules: boolean[][],
  x: number,
  y: number,
): CornerRadii {
  const top = isFilled(modules, x, y - 1);
  const bottom = isFilled(modules, x, y + 1);
  const left = isFilled(modules, x - 1, y);
  const right = isFilled(modules, x + 1, y);
  return {
    topLeft: !top && !left,
    topRight: !top && !right,
    bottomRight: !bottom && !right,
    bottomLeft: !bottom && !left,
  };
}
