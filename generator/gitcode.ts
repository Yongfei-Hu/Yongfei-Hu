/**
 * Fetch a GitCode user's activity and bucket it into contribution cells
 * (same shape as snk's gitlab-user-contribution output).
 *
 * GitCode's OpenAPI has no contribution-calendar endpoint, so two
 * sources are combined:
 *
 *  1. GET /api/v5/users/{username}/events — real activity across all
 *     repos (pushes, MRs, comments, ...), but hard-capped by GitCode
 *     to the most recent ~200 events.
 *  2. GET /api/v5/repos/{owner}/{repo}/commits?author=...&since=... —
 *     commits authored by the user in repos they are a member of,
 *     covering the whole window.
 *
 * Both require a personal access token (https://gitcode.com/setting/token).
 */

import * as fs from "node:fs";

export type Cell = {
  x: number;
  y: number;
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
};

type EventsPage = {
  events: Record<string, unknown[]>;
  next?: string;
};

const API_BASE = "https://api.gitcode.com/api/v5";
const MAX_EVENT_PAGES = 50; // api stops after ~10 pages anyway
const MAX_REPOS = 50;
const MAX_COMMIT_PAGES_PER_REPO = 10; // 1000 authored commits/repo is plenty
const PAGE_DELAY_MS = 200; // be nice to the API

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const apiGet = async <T>(path: string, params: Record<string, string>) => {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${API_BASE}${path}?${qs}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok)
    throw new Error(
      `gitcode api ${path}: ${res.status} ${await res.text().catch(() => res.statusText)}`,
    );
  return (await res.json()) as T;
};

const bump = (counts: Record<string, number>, date: string, by = 1) => {
  counts[date] = (counts[date] ?? 0) + by;
};

/** recent cross-repo activity (pushes, MRs, comments, ...) */
const fetchEventCounts = async (
  userName: string,
  token: string,
  counts: Record<string, number>,
) => {
  let next: string | undefined;
  for (let page = 0; page < MAX_EVENT_PAGES; page++) {
    const params: Record<string, string> = { access_token: token };
    if (next) params.next = next;

    const data = await apiGet<EventsPage>(
      `/users/${encodeURIComponent(userName)}/events`,
      params,
    );
    for (const [date, events] of Object.entries(data.events ?? {}))
      bump(counts, date, events.length);

    next = data.next;
    if (!next) break;
    await sleep(PAGE_DELAY_MS);
  }
};

/** commits authored by the user in repos they are a member of */
const fetchCommitCounts = async (
  userName: string,
  token: string,
  since: Date,
  counts: Record<string, number>,
) => {
  type Repo = { full_name: string };
  const repos: Repo[] = [];
  for (let page = 1; repos.length < MAX_REPOS; page++) {
    const batch = await apiGet<Repo[]>(
      `/users/${encodeURIComponent(userName)}/repos`,
      {
        access_token: token,
        type: "all",
        per_page: "100",
        page: String(page),
      },
    );
    repos.push(...batch);
    if (batch.length < 100) break;
    await sleep(PAGE_DELAY_MS);
  }

  type Commit = { commit?: { author?: { date?: string } } };
  const sinceIso = since.toISOString();

  for (const repo of repos.slice(0, MAX_REPOS)) {
    for (let page = 1; page <= MAX_COMMIT_PAGES_PER_REPO; page++) {
      let commits: Commit[];
      try {
        commits = await apiGet<Commit[]>(
          `/repos/${repo.full_name}/commits`,
          {
            access_token: token,
            author: userName,
            since: sinceIso,
            per_page: "100",
            page: String(page),
          },
        );
      } catch (err) {
        console.warn(`skip commits of ${repo.full_name}: ${err}`);
        break;
      }
      for (const c of commits) {
        const date = c.commit?.author?.date?.slice(0, 10);
        if (date) bump(counts, date);
      }
      if (commits.length < 100) break;
      await sleep(PAGE_DELAY_MS);
    }
  }
};

export const getGitcodeUserContribution = async (
  userName: string,
  o: { token: string },
): Promise<Cell[]> => {
  // grid covers the last ~365 days, starting on a Sunday (UTC dates)
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 365);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());

  const countsByDate: Record<string, number> = {};

  // When GITCODE_CALENDAR_JSON points to a dump of the official profile
  // calendar (web-api .../contributions), trust it over the approximate
  // events/commits reconstruction.
  const calendarFile = process.env.GITCODE_CALENDAR_JSON;
  if (calendarFile && fs.existsSync(calendarFile)) {
    const data = JSON.parse(fs.readFileSync(calendarFile, "utf-8")) as Record<string, number>;
    for (const [date, count] of Object.entries(data))
      if (typeof count === "number") countsByDate[date] = count;
    console.log(`📅 using official calendar from ${calendarFile}`);
  } else {
    await fetchEventCounts(userName, o.token, countsByDate);
    await fetchCommitCounts(userName, o.token, start, countsByDate);
  }

  const max = Math.max(0, ...Object.values(countsByDate));

  const levelForCount = (count: number): Cell["level"] =>
    count <= 0 || max === 0
      ? 0
      : count >= max
        ? 4
        : (Math.ceil((count / max) * 3) as 1 | 2 | 3);

  const cells: Cell[] = [];
  const cursor = new Date(start);
  let x = 0;

  while (cursor <= today) {
    const y = cursor.getUTCDay(); // 0 = Sunday
    const date = cursor.toISOString().slice(0, 10);
    const count = countsByDate[date] ?? 0;

    cells.push({ x, y, date, count, level: levelForCount(count) });

    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (y === 6) x++;
  }

  return cells;
};
