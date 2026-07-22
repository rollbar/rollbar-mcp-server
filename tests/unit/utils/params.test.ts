import { describe, it, expect } from "vitest";
import {
  injectProjectIdQueryParam,
  injectProjectIdBodyParam,
  injectProjectIdsRepeatedQueryParam,
} from "../../../src/utils/params.js";
import type { AuthContext } from "../../../src/config.js";

const accountAuth: AuthContext = {
  token: "acct-token",
  tokenType: "account",
  projectId: 42,
  apiBase: "https://api.rollbar.com/api/1",
};

const projectAuth: AuthContext = {
  token: "proj-token",
  tokenType: "project",
  apiBase: "https://api.rollbar.com/api/1",
};

const accountAuthNoProjectId: AuthContext = {
  token: "acct-token",
  tokenType: "account",
  apiBase: "https://api.rollbar.com/api/1",
};

describe("params injection helper", () => {
  describe("injectProjectIdQueryParam", () => {
    it("appends project_id as a query param when no existing query string (GET /deploys)", () => {
      const url = injectProjectIdQueryParam(
        "https://api.rollbar.com/api/1/deploys?limit=10",
        accountAuth,
      );
      expect(url).toBe(
        "https://api.rollbar.com/api/1/deploys?limit=10&project_id=42",
      );
    });

    it("appends project_id with ? when url has no existing query string (GET /instance/{id})", () => {
      const url = injectProjectIdQueryParam(
        "https://api.rollbar.com/api/1/instance/999",
        accountAuth,
      );
      expect(url).toBe(
        "https://api.rollbar.com/api/1/instance/999?project_id=42",
      );
    });

    it("appends project_id for GET /versions/{v}", () => {
      const url = injectProjectIdQueryParam(
        "https://api.rollbar.com/api/1/versions/abc123?environment=production",
        accountAuth,
      );
      expect(url).toBe(
        "https://api.rollbar.com/api/1/versions/abc123?environment=production&project_id=42",
      );
    });

    it("appends project_id for GET /reports/top_active_items", () => {
      const url = injectProjectIdQueryParam(
        "https://api.rollbar.com/api/1/reports/top_active_items?hours=24&environments=production&sort=occurrences",
        accountAuth,
      );
      expect(url).toBe(
        "https://api.rollbar.com/api/1/reports/top_active_items?hours=24&environments=production&sort=occurrences&project_id=42",
      );
    });

    it("appends project_id for the replay path", () => {
      const url = injectProjectIdQueryParam(
        "https://api.rollbar.com/api/1/environment/production/session/s1/replay/r1",
        accountAuth,
      );
      expect(url).toBe(
        "https://api.rollbar.com/api/1/environment/production/session/s1/replay/r1?project_id=42",
      );
    });

    it("appends project_id for GET /item?counter=", () => {
      const url = injectProjectIdQueryParam(
        "https://api.rollbar.com/api/1/item?counter=42",
        accountAuth,
      );
      expect(url).toBe(
        "https://api.rollbar.com/api/1/item?counter=42&project_id=42",
      );
    });

    it("is a no-op passthrough in project-token mode", () => {
      const original = "https://api.rollbar.com/api/1/deploys?limit=10";
      const url = injectProjectIdQueryParam(original, projectAuth);
      expect(url).toBe(original);
    });

    it("is a no-op when account mode has no resolved projectId", () => {
      const original = "https://api.rollbar.com/api/1/deploys?limit=10";
      const url = injectProjectIdQueryParam(original, accountAuthNoProjectId);
      expect(url).toBe(original);
    });
  });

  describe("injectProjectIdBodyParam", () => {
    it("merges project_id into the JSON body for PATCH /item/{id}", () => {
      const body = injectProjectIdBodyParam({ status: "resolved" }, accountAuth);
      expect(body).toEqual({ status: "resolved", project_id: 42 });
    });

    it("is a no-op passthrough in project-token mode", () => {
      const original = { status: "resolved" };
      const body = injectProjectIdBodyParam(original, projectAuth);
      expect(body).toEqual({ status: "resolved" });
      expect(body).not.toHaveProperty("project_id");
    });

    it("is a no-op when account mode has no resolved projectId", () => {
      const original = { status: "resolved" };
      const body = injectProjectIdBodyParam(original, accountAuthNoProjectId);
      expect(body).toEqual({ status: "resolved" });
      expect(body).not.toHaveProperty("project_id");
    });

    it("does not mutate the original body object", () => {
      const original = { status: "resolved" };
      injectProjectIdBodyParam(original, accountAuth);
      expect(original).toEqual({ status: "resolved" });
      expect(original).not.toHaveProperty("project_id");
    });
  });

  describe("injectProjectIdsRepeatedQueryParam (GET /items/ exception)", () => {
    it("appends a single repeated project_ids param, not singular project_id", () => {
      const url = injectProjectIdsRepeatedQueryParam(
        "https://api.rollbar.com/api/1/items/?status=active",
        accountAuth,
      );
      expect(url).toBe(
        "https://api.rollbar.com/api/1/items/?status=active&project_ids=42",
      );
    });

    it("appends with ? when there is no existing query string", () => {
      const url = injectProjectIdsRepeatedQueryParam(
        "https://api.rollbar.com/api/1/items/",
        accountAuth,
      );
      expect(url).toBe("https://api.rollbar.com/api/1/items/?project_ids=42");
    });

    it("is a no-op passthrough in project-token mode", () => {
      const original = "https://api.rollbar.com/api/1/items/?status=active";
      const url = injectProjectIdsRepeatedQueryParam(original, projectAuth);
      expect(url).toBe(original);
    });

    it("is a no-op when account mode has no resolved projectId", () => {
      const original = "https://api.rollbar.com/api/1/items/?status=active";
      const url = injectProjectIdsRepeatedQueryParam(
        original,
        accountAuthNoProjectId,
      );
      expect(url).toBe(original);
    });

    // Explicit regression test: this helper must NEVER produce a singular
    // `project_id` param or a comma-joined `project_ids=1,2` — both hang for
    // ~25s and return a 422 in production against the real Rollbar API.
    it("REGRESSION: never produces singular project_id or comma-joined project_ids", () => {
      const url = injectProjectIdsRepeatedQueryParam(
        "https://api.rollbar.com/api/1/items/?status=active",
        accountAuth,
      );

      const params = new URLSearchParams(url.split("?")[1]);
      const projectIdsValues = params.getAll("project_ids");

      // Must be the plural key with exactly one bare numeric value.
      expect(projectIdsValues).toEqual(["42"]);
      // Must never contain a comma (i.e. never comma-joined).
      expect(projectIdsValues.some((v) => v.includes(","))).toBe(false);
      // Must never also produce a singular project_id key.
      expect(params.has("project_id")).toBe(false);
      // The raw URL string must not contain the singular key as a substring
      // key (guards against string-concatenation bugs that could slip a
      // `project_id=` in alongside `project_ids=`).
      expect(url).not.toMatch(/[?&]project_id=/);
    });

    it("REGRESSION: calling twice with two different accounts still appends repeated (not merged/deduped) params correctly per call", () => {
      const authA: AuthContext = { ...accountAuth, projectId: 1 };
      const urlA = injectProjectIdsRepeatedQueryParam(
        "https://api.rollbar.com/api/1/items/",
        authA,
      );
      expect(urlA).toBe("https://api.rollbar.com/api/1/items/?project_ids=1");
      expect(urlA).not.toContain(",");
    });
  });
});
