import { AuthContext } from "../config.js";

/**
 * Appends `project_id=<id>` as a single query param to `url`. No-op
 * (returns `url` unchanged) when using a project token or
 * `auth.projectId` is not set — project-token mode is never touched.
 *
 * Use for: GET /deploys, GET /versions/{v}, GET /reports/top_active_items,
 * GET /instance/{id}, the replay path, GET /item?counter=.
 */
export function injectProjectIdQueryParam(
  url: string,
  auth: AuthContext,
): string {
  if (auth.tokenType === "project" || auth.projectId === undefined) {
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}project_id=${encodeURIComponent(auth.projectId)}`;
}

/**
 * Merges `project_id` into a JSON request body object. No-op when
 * using a project token or `auth.projectId` is not set.
 *
 * Use for: PATCH /item/{id} (update-item).
 */
export function injectProjectIdBodyParam<T extends Record<string, unknown>>(
  body: T,
  auth: AuthContext,
): T | (T & { project_id: number }) {
  if (auth.tokenType === "project" || auth.projectId === undefined) {
    return body;
  }

  return { ...body, project_id: auth.projectId };
}

export interface ProjectIdsMetricsFilter {
  field: "project_id";
  operator: "eq";
  values: number[];
}

/**
 * Appends a `project_id eq <ids>` filter to a metrics query's `filters`
 * array. No-op (returns `filters` unchanged) when `projectIds` is undefined,
 * which leaves the API to choose: every project an account or user token can
 * read, or a project token's own project.
 *
 * An empty list still appends its empty filter, which the API refuses for an
 * account or user token, so a resolution bug fails closed instead of widening
 * the query to every project.
 *
 * Use for: POST /metrics/occurrences (get-occurrence-metrics), with the
 * `projectIds` from resolveProjectScope().
 */
export function injectProjectIdsMetricsFilter<T>(
  filters: T[],
  projectIds: number[] | undefined,
): Array<T | ProjectIdsMetricsFilter> {
  if (projectIds === undefined) {
    return filters;
  }

  return [
    ...filters,
    { field: "project_id", operator: "eq", values: [...projectIds] },
  ];
}

/**
 * Appends a REPEATED `project_ids=<id>` query param to `url`. This is the
 * one exception in the Rollbar API: GET /items/ (item search / list-items)
 * takes a `project_ids` LIST, and ONLY as repeated query params.
 *
 * A singular `project_id` param, or a comma-joined `project_ids=1,2`, both
 * hang for ~25s and then return a 422 in production — this function must
 * NEVER produce either shape. It only ever appends `project_ids=<id>` (the
 * plural key, one bare numeric value per occurrence).
 *
 * No-op when using a project token or `auth.projectId` is not set.
 *
 * Use for: GET /items/ (list-items).
 */
export function injectProjectIdsRepeatedQueryParam(
  url: string,
  auth: AuthContext,
): string {
  if (auth.tokenType === "project" || auth.projectId === undefined) {
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}project_ids=${encodeURIComponent(auth.projectId)}`;
}
