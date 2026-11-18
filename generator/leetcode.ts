/** Fetch the LeetCode CN submission calendar for the last year. */
import type { Cell } from "./github";

const CALENDAR_URL = "https://leetcode.cn/graphql/noj-go/";
const DAY_MS = 86400000;
const QUERY = `
  query userCalendar($userSlug: String!, $year: Int) {
    userCalendar(userSlug: $userSlug, year: $year) {
      submissionCalendar
    }
  }
`;

const fetchCalendar = async (
  userSlug: string,
  year: number,
): Promise<Record<string, number>> => {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(CALENDAR_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Origin: "https://leetcode.cn",
          Referer: `https://leetcode.cn/u/${encodeURIComponent(userSlug)}/`,
          "User-Agent": "Mozilla/5.0",
        },
        body: JSON.stringify({
          query: QUERY,
          variables: { userSlug, year },
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok)
        throw new Error(`leetcode calendar: ${res.status} ${res.statusText}`);

      const result = (await res.json()) as {
        data?: { userCalendar?: { submissionCalendar?: string } | null };
        errors?: { message: string }[];
      };
      if (result.errors?.length)
        throw new Error(result.errors.map((error) => error.message).join("; "));

      const calendar = result.data?.userCalendar?.submissionCalendar;
      if (typeof calendar !== "string")
        throw new Error(`no LeetCode calendar found for ${userSlug} (${year})`);

      const counts: unknown = JSON.parse(calendar);
      if (!counts || typeof counts !== "object" || Array.isArray(counts))
        throw new Error("invalid LeetCode submission calendar");

      for (const [timestamp, count] of Object.entries(counts)) {
        if (
          !/^\d+$/.test(timestamp) ||
          !Number.isFinite(new Date(Number(timestamp) * 1000).getTime()) ||
          typeof count !== "number" ||
          !Number.isSafeInteger(count) ||
          count < 0
        )
          throw new Error("invalid LeetCode submission calendar entry");
      }
      return counts as Record<string, number>;
    } catch (error) {
      if (attempt === 2) throw error;
      console.warn(`retrying LeetCode calendar (${year}): ${error}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
};

export const getLeetcodeUserContribution = async (
  userSlug: string,
): Promise<Cell[]> => {
  // Keep the date window stable in both local runs and GitHub's UTC runners.
  const today = new Date(
    `${new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())}T00:00:00Z`,
  );
  const start = new Date(today);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());

  // A rolling year crosses calendar years; query each year explicitly.
  const countsByDate: Record<string, number> = {};
  for (let year = start.getUTCFullYear(); year <= today.getUTCFullYear(); year++) {
    const calendar = await fetchCalendar(userSlug, year);
    for (const [timestamp, count] of Object.entries(calendar)) {
      const date = new Date(Number(timestamp) * 1000).toISOString().slice(0, 10);
      countsByDate[date] = (countsByDate[date] ?? 0) + count;
    }
  }

  const cells: Cell[] = [];
  for (let day = start.getTime(); day <= today.getTime(); day += DAY_MS) {
    const date = new Date(day).toISOString().slice(0, 10);
    const count = countsByDate[date] ?? 0;
    cells.push({
      x: Math.floor((day - start.getTime()) / DAY_MS / 7),
      y: new Date(day).getUTCDay(),
      date,
      count,
      level: 0,
    });
  }

  const max = Math.max(0, ...cells.map((cell) => cell.count));
  for (const cell of cells) {
    cell.level = cell.count === 0
      ? 0
      : (Math.ceil((cell.count / max) * 4) as Cell["level"]);
  }
  return cells;
};
