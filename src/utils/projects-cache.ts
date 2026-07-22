import { RollbarApiResponse } from "../types/index.js";

export interface RollbarProject {
  id: number;
  name: string;
  status: string;
  account_id?: number;
  [key: string]: unknown;
}

interface CacheEntry {
  projects: RollbarProject[];
  fetchPromise?: Promise<RollbarProject[]>;
}

// Cache is keyed by `${apiBase}::${token}` so multiple account tokens (in
// theory) or api bases don't collide, and is intentionally process-lifetime:
// we never refetch on our own initiative, only on an explicit lookup miss.
const cache = new Map<string, CacheEntry>();

function cacheKey(token: string, apiBase: string): string {
  return `${apiBase}::${token}`;
}

async function fetchProjects(
  token: string,
  apiBase: string,
): Promise<RollbarProject[]> {
  const response = await fetch(`${apiBase}/projects`, {
    headers: {
      "X-Rollbar-Access-Token": token,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Rollbar projects: ${response.status} ${response.statusText}`,
    );
  }

  const body = (await response.json()) as RollbarApiResponse<RollbarProject[]>;
  if (body.err !== 0) {
    throw new Error(
      `Rollbar API returned error fetching projects: ${
        body.message || `Unknown error (code: ${body.err})`
      }`,
    );
  }

  return (body.result || []).filter((p) => p.status === "enabled");
}

async function getOrFetch(
  token: string,
  apiBase: string,
  forceRefresh: boolean,
): Promise<RollbarProject[]> {
  const key = cacheKey(token, apiBase);
  let entry = cache.get(key);

  if (forceRefresh || !entry) {
    const fetchPromise = fetchProjects(token, apiBase);
    entry = { projects: entry?.projects ?? [], fetchPromise };
    cache.set(key, entry);
    const projects = await fetchPromise;
    cache.set(key, { projects });
    return projects;
  }

  if (entry.fetchPromise) {
    return entry.fetchPromise;
  }

  return entry.projects;
}

/**
 * Returns the cached list of enabled projects for this account token,
 * fetching from GET /projects on first use. Never refetches automatically
 * on subsequent calls — only refreshOnce() (used internally by
 * resolveProjectId on a lookup miss) forces a refetch.
 */
export async function getProjects(
  token: string,
  apiBase: string,
): Promise<RollbarProject[]> {
  return getOrFetch(token, apiBase, false);
}

function matchProject(
  projects: RollbarProject[],
  identifier: string,
): RollbarProject | undefined {
  const trimmed = identifier.trim();
  if (/^\d+$/.test(trimmed)) {
    const numericId = Number(trimmed);
    const byId = projects.find((p) => p.id === numericId);
    if (byId) return byId;
  }
  const lower = trimmed.toLowerCase();
  return projects.find((p) => p.name.toLowerCase() === lower);
}

/**
 * Resolves a `project` request param (name, case-insensitive, or numeric id)
 * to a Rollbar project id using the cached project list for this account
 * token. If there's no match, the cache is refreshed once (in case a new
 * project was added since the last fetch) and the match retried before
 * throwing an error listing the available project names.
 *
 * If `project` is undefined and the account has exactly one enabled
 * project, that project is auto-selected as the default.
 */
export async function resolveProjectId(
  token: string,
  apiBase: string,
  project: string | undefined,
): Promise<number> {
  let projects = await getProjects(token, apiBase);

  if (project === undefined) {
    if (projects.length === 1) {
      return projects[0].id;
    }
    if (projects.length === 0) {
      // Give the refresh-once behavior a chance in case the cache was
      // populated before any projects existed on the account.
      projects = await getOrFetch(token, apiBase, true);
      if (projects.length === 1) {
        return projects[0].id;
      }
    }
    throw new Error(
      projects.length === 0
        ? "No enabled Rollbar projects found for this account token."
        : `Multiple projects available on this account token. Specify a project. Available: ${projects.map((p) => p.name).join(", ")}`,
    );
  }

  const match = matchProject(projects, project);
  if (match) {
    return match.id;
  }

  // Lookup miss: refresh once in case a new project was added, then retry.
  const refreshed = await getOrFetch(token, apiBase, true);
  const retryMatch = matchProject(refreshed, project);
  if (retryMatch) {
    return retryMatch.id;
  }

  throw new Error(
    `Unknown project "${project}". Available: ${refreshed.map((p) => p.name).join(", ")}`,
  );
}

/** Test-only helper to reset the process-lifetime cache between tests. */
export function __resetProjectsCacheForTests(): void {
  cache.clear();
}
