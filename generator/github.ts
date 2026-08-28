/**
 * Fetch a GitHub user's public contribution calendar and bucket it into
 * contribution cells (same shape as snk's gitlab-user-contribution output).
 *
 * GitHub has no lightweight public JSON endpoint for the contribution
 * calendar, so the HTML contribution page is parsed instead. It exposes
 * 0-4 data-level per day, which is all the snake renderer needs; no token
 * is required.
 */

export type Cell = {
  x: number;
  y: number;
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
};

const CONTRIBUTIONS_URL = (userName: string) =>
  `https://github.com/users/${encodeURIComponent(userName)}/contributions`;

const DAY_CELL_RE =
  /<td[^>]*?\bdata-date="(\d{4}-\d{2}-\d{2})"[^>]*?\bdata-level="(\d+)"/g;

export const getGithubUserContribution = async (
  userName: string,
): Promise<Cell[]> => {
  const res = await fetch(CONTRIBUTIONS_URL(userName), {
    headers: { Accept: "text/html" },
  });
  if (!res.ok)
    throw new Error(`github contributions page: ${res.status} ${res.statusText}`);

  const html = await res.text();
  const days: { date: string; level: number }[] = [];
  const re = new RegExp(DAY_CELL_RE);
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    days.push({ date: match[1], level: Number(match[2]) });
  }
  if (days.length === 0)
    throw new Error("no contribution calendar data found");

  // GitHub renders the grid starting on the Sunday of the first week; use
  // that first day cell as the (x=0, y=0) anchor and derive every other
  // cell position from its UTC date so the grid lines up with the renderer.
  const anchor = new Date(`${days[0].date}T00:00:00Z`);
  const cells: Cell[] = days.map(({ date, level }) => {
    const day = new Date(`${date}T00:00:00Z`);
    const diffDays = Math.round((day.getTime() - anchor.getTime()) / 86400000);
    const x = Math.floor(diffDays / 7);
    const y = day.getUTCDay();
    return {
      x,
      y,
      date,
      count: level,
      level: level as Cell["level"],
    };
  });

  return cells;
};
