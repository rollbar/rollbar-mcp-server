import { describe, it, expect, vi, beforeEach } from "vitest";

describe("buildProjectParam", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns an optional free-form string schema when zero projects are configured (account-token-only mode)", async () => {
    vi.doMock("../../../src/config.js", () => ({
      PROJECTS: [],
      HAS_ACCOUNT_TOKEN: true,
    }));
    const { buildProjectParam } =
      await import("../../../src/utils/project-params.js");

    const schema = buildProjectParam();

    // The whole point of this test: with no project-token entries
    // configured, a tool call that omits `project` entirely (the normal
    // single-enabled-project case) must still validate successfully. Before
    // this fix, buildProjectParam() fell through to the multi-project
    // z.enum([]) branch here, which is a required field no value can ever
    // satisfy -- silently breaking every tool in pure account-token mode.
    expect(schema.safeParse(undefined).success).toBe(true);

    // An arbitrary project name/id (resolved dynamically against the
    // account's GET /projects at call time, not a static config list) must
    // also be accepted here -- there's no fixed set of names to enum over.
    expect(schema.safeParse("AnyProjectName").success).toBe(true);
    expect(schema.safeParse("123").success).toBe(true);
  });

  it("returns an optional string schema when exactly one project is configured", async () => {
    vi.doMock("../../../src/config.js", () => ({
      PROJECTS: [{ name: "default", token: "t", apiBase: "base" }],
      HAS_ACCOUNT_TOKEN: false,
    }));
    const { buildProjectParam } =
      await import("../../../src/utils/project-params.js");

    const schema = buildProjectParam();

    expect(schema.safeParse(undefined).success).toBe(true);
    expect(schema.safeParse("default").success).toBe(true);
  });

  it("returns a required enum schema constrained to configured names when multiple projects are configured", async () => {
    vi.doMock("../../../src/config.js", () => ({
      PROJECTS: [
        { name: "backend", token: "t1", apiBase: "base" },
        { name: "frontend", token: "t2", apiBase: "base" },
      ],
      HAS_ACCOUNT_TOKEN: false,
    }));
    const { buildProjectParam } =
      await import("../../../src/utils/project-params.js");

    const schema = buildProjectParam();

    expect(schema.safeParse("backend").success).toBe(true);
    expect(schema.safeParse("frontend").success).toBe(true);
    expect(schema.safeParse("unknown-project").success).toBe(false);
    // Multi-project mode still requires an explicit project — omission is
    // rejected here (unchanged pre-existing behavior).
    expect(schema.safeParse(undefined).success).toBe(false);
  });

  it("returns a free-form string schema (not a static enum) when multiple projects AND an account token are configured", async () => {
    vi.doMock("../../../src/config.js", () => ({
      PROJECTS: [
        { name: "backend", token: "t1", apiBase: "base" },
        { name: "frontend", token: "t2", apiBase: "base" },
      ],
      HAS_ACCOUNT_TOKEN: true,
    }));
    const { buildProjectParam } =
      await import("../../../src/utils/project-params.js");

    const schema = buildProjectParam();

    // Hybrid config: explicit project tokens for "backend"/"frontend", plus
    // an account token that can also reach any other project on the
    // account. Before this fix, this schema was a static z.enum(["backend",
    // "frontend"]) that rejected any other project name at the MCP
    // input-validation layer, before resolveAuthContext()'s working
    // account-token fallback ever ran.
    expect(schema.safeParse("backend").success).toBe(true);
    expect(schema.safeParse("frontend").success).toBe(true);
    expect(schema.safeParse("SomeOtherAccountProject").success).toBe(true);
    expect(schema.safeParse("776050").success).toBe(true);
    expect(schema.safeParse(undefined).success).toBe(true);
  });
});
