/**
 * Generate the GitHub contribution snake animation (light + dark SVG).
 *
 * Pipeline mirrors snk's generate-snake-animation package, with the
 * contribution source replaced by GitHub's public contribution calendar:
 *   github contributions -> cells -> grid -> solver best route -> svg
 *
 * Usage:
 *   GITHUB_USER=xxx bun generator/run.ts
 *   bun generator/run.ts [username]
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { getGithubUserContribution, type Cell } from "./github";
import { getBestRoute } from "./vendor/solver/getBestRoute";
import { getPathToPose } from "./vendor/solver/getPathToPose";
import { createSvg, type DrawOptions } from "./vendor/svg-creator/index";
import { snake4 } from "./vendor/types/__fixtures__/snake";
import {
  createEmptyGrid,
  setColor,
  setColorEmpty,
  type Color,
} from "./vendor/types/grid";

// GitCode-blue dot palettes (analogous to snk's github / gitlab presets)
const palettes = {
  "gitcode-light": {
    colorBackground: "#ffffff",
    colorDotBorder: "#1b1f230a",
    colorEmpty: "#ebedf0",
    colorDots: ["#ebedf0", "#9dc7f1", "#428fdc", "#2f68b4", "#284779"],
    colorSnake: "#f97316",
  },
  "gitcode-dark": {
    colorBackground: "#0c1116",
    colorDotBorder: "#1b1f230a",
    colorEmpty: "#161b22",
    colorDots: ["#161b22", "#0b2d4d", "#10467c", "#1a66b3", "#4da3ff"],
    colorSnake: "#f97316",
  },
};

// Show roughly half of GitHub's one-year contribution calendar.
const DISPLAY_WEEKS = 26;
const PROFILE_CANVAS_WIDTH = 880;

const takeRecentWeeks = (cells: Cell[]): Cell[] => {
  const maxX = Math.max(0, ...cells.map((cell) => cell.x));
  const firstX = Math.max(0, maxX - DISPLAY_WEEKS + 1);

  return cells
    .filter((cell) => cell.x >= firstX)
    .map((cell) => ({ ...cell, x: cell.x - firstX }));
};

const keepProfileCanvasWidth = (svg: string): string =>
  svg.replace(
    /(<svg\b[^>]*\bwidth=")\d+("[^>]*>)/,
    `$1${PROFILE_CANVAS_WIDTH}$2`,
  );

const cellsToGrid = (cells: { x: number; y: number; level: number }[]) => {
  const width = Math.max(0, ...cells.map((c) => c.x)) + 1;
  const height = Math.max(0, ...cells.map((c) => c.y)) + 1;

  const grid = createEmptyGrid(width, height);
  for (const c of cells) {
    if (c.level > 0) setColor(grid, c.x, c.y, c.level as Color);
    else setColorEmpty(grid, c.x, c.y);
  }
  return grid;
};

const toDrawOptions = (p: (typeof palettes)["gitcode-light"]): DrawOptions => ({
  colorDots: { 1: p.colorDots[1], 2: p.colorDots[2], 3: p.colorDots[3], 4: p.colorDots[4] } as DrawOptions["colorDots"],
  colorEmpty: p.colorEmpty,
  colorDotBorder: p.colorDotBorder,
  colorSnake: p.colorSnake,
  sizeCell: 16,
  sizeDot: 12,
  sizeDotBorderRadius: 2,
});

const main = async () => {
  const username = process.env.GITHUB_USER ?? process.argv[2];
  if (!username) throw new Error("GITHUB_USER env var or username arg is required");
  console.log(`🎣 fetching github contribution for ${username}`);

  const cells = takeRecentWeeks(await getGithubUserContribution(username));
  const total = cells.reduce((s, c) => s + c.count, 0);
  console.log(`📊 ${total} events in the last ${DISPLAY_WEEKS} weeks`);

  const grid = cellsToGrid(cells);
  const snake = snake4;

  console.log("📡 computing best route");
  const chain = getBestRoute(grid, snake)!;
  chain.push(...getPathToPose(chain.slice(-1)[0], snake)!);

  const outDir = path.resolve(__dirname, "../dist");
  fs.mkdirSync(outDir, { recursive: true });

  for (const [name, palette] of Object.entries(palettes)) {
    const suffix = name === "gitcode-dark" ? "-dark" : "";
    const file = path.join(outDir, `gitcode-contribution-grid-snake${suffix}.svg`);
    console.log(`🖌 creating ${file}`);
    const svg = keepProfileCanvasWidth(
      createSvg(grid, cells, chain, toDrawOptions(palette), {
        stepDurationMs: 100,
      }),
    );
    fs.writeFileSync(file, svg);
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
