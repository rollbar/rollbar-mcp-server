import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

// Keep config, project discovery, and both replay handlers real. Only the
// local config file and external API are replaced.
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
const files = vi.hoisted(() => ({ exists: vi.fn(), read: vi.fn() }));
vi.mock("node:fs", () => ({
  existsSync: files.exists,
  readFileSync: files.read,
}));

const apiBase = "https://rollbar.example/api/1";
const project = { id: 456, name: "Backend", status: "enabled" };
const projectTokens = [
  { name: "Backend", token: "project-token" },
  { name: "Frontend", token: "frontend-token" },
];
const replay = { events: [{ timestamp: 100, type: "test" }] };
const replayArgs = {
  environment: "production",
  sessionId: "session",
  replayId: "replay",
  delivery: "resource",
};
const uri = "rollbar://replay/production/session/replay";
const replayUrl = `${apiBase}/environment/production/session/session/replay/replay`;

describe("replay resource access with real authentication", () => {
  let client: Client;
  let server: McpServer;
  let fetchMock: ReturnType<typeof vi.fn>;
  let visibleProjects: (typeof project)[];

  beforeEach(() => {
    vi.resetModules();
    for (const name of [
      "ROLLBAR_ACCESS_TOKEN",
      "ROLLBAR_ACCOUNT_ACCESS_TOKEN",
      "ROLLBAR_USER_ACCESS_TOKEN",
      "ROLLBAR_CONFIG_FILE",
    ]) {
      vi.stubEnv(name, "");
    }
    vi.stubEnv("ROLLBAR_API_BASE", apiBase);
    files.exists.mockReturnValue(false);
    files.read.mockReset();
    visibleProjects = [project];
    fetchMock = vi.fn(async (url: string) => {
      if (url !== `${apiBase}/projects` && !url.startsWith(replayUrl)) {
        throw new Error(`Unexpected request: ${url}`);
      }
      return new Response(
        JSON.stringify({
          err: 0,
          result: url === `${apiBase}/projects` ? visibleProjects : replay,
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    await client?.close();
    await server?.close();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function configFile(config: Record<string, unknown>) {
    const location = "/test/rollbar.json";
    vi.stubEnv("ROLLBAR_CONFIG_FILE", location);
    files.exists.mockImplementation((name: string) => name === location);
    files.read.mockReturnValue(JSON.stringify({ ...config, apiBase }));
  }

  async function connect() {
    const { registerGetReplayTool } =
      await import("../../src/tools/get-replay.js");
    const { registerAllResources } =
      await import("../../src/resources/index.js");
    server = new McpServer({ name: "rollbar-test", version: "1.0.0" });
    registerGetReplayTool(server);
    registerAllResources(server);
    client = new Client({ name: "replay-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  }

  it.each(["environment", "shorthand", "projects", "mixed"])(
    "allows both replay entry points for one user project with ignored %s project tokens",
    async (source) => {
      if (source === "environment") {
        vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", "user-token");
        vi.stubEnv("ROLLBAR_ACCESS_TOKEN", "project-token");
      } else if (source === "shorthand") {
        configFile({ userToken: "user-token", token: "project-token" });
      } else if (source === "projects") {
        configFile({ userToken: "user-token", projects: projectTokens });
      } else {
        configFile({ projects: projectTokens });
        vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", "user-token");
      }
      await connect();

      // Read before calling the tool so this exercises an uncached resource.
      const resource = await client.readResource({ uri });
      expect(resource.contents[0]).toMatchObject({
        uri,
        text: JSON.stringify(replay),
      });
      const result = CallToolResultSchema.parse(
        await client.callTool({ name: "get-replay", arguments: replayArgs }),
      );
      expect(result.isError).toBeFalsy();
      expect(result.content).toContainEqual(
        expect.objectContaining({ type: "resource_link", uri }),
      );
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        `${apiBase}/projects`,
        `${replayUrl}?project_id=456`,
        `${replayUrl}?project_id=456`,
      ]);
      for (const [, options] of vi.mocked(fetch).mock.calls) {
        expect(options?.headers).toHaveProperty(
          "X-Rollbar-Access-Token",
          "user-token",
        );
      }
    },
  );

  it.each(["user", "account"])(
    "rejects both replay entry points when %s mode can actually reach multiple projects",
    async (mode) => {
      if (mode === "user") {
        configFile({ userToken: "user-token", projects: projectTokens });
        visibleProjects.push({ id: 789, name: "Other", status: "enabled" });
      } else {
        configFile({ accountToken: "account-token", projects: projectTokens });
      }
      await connect();

      await expect(client.readResource({ uri })).rejects.toThrow(
        "Direct replay resource access is not supported when multiple projects are configured",
      );
      const result = CallToolResultSchema.parse(
        await client.callTool({
          name: "get-replay",
          arguments: { ...replayArgs, project: "456" },
        }),
      );
      expect(result.isError).toBe(true);
      expect(result.content).toContainEqual(
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining(
            'delivery="resource" is not supported when multiple projects are configured',
          ),
        }),
      );
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        `${apiBase}/projects`,
      ]);
    },
  );
});
