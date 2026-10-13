// Opt-in live check: creates one persistent comment on the specified test item.
// See CONTRIBUTING.md for the required environment variables.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function required(name) {
  const value = process.env[name];
  assert(value, `Set ${name} for this opt-in live test`);
  return value;
}

function positiveId(name) {
  const value = Number(required(name));
  assert(
    Number.isSafeInteger(value) && value > 0,
    `${name} must be a positive safe integer`,
  );
  return value;
}

const configPath = required("ROLLBAR_E2E_CONFIG_FILE");
assert(
  isAbsolute(configPath),
  "ROLLBAR_E2E_CONFIG_FILE must be an absolute path",
);
const project = required("ROLLBAR_E2E_PROJECT");
const item_id = positiveId("ROLLBAR_E2E_ITEM_ID");
const expectedUserId = positiveId("ROLLBAR_E2E_USER_ID");
const text = `MCP item history integration check ${randomUUID()}`;

const client = new Client({
  name: "rollbar-history-live-test",
  version: "1.0.0",
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("../../build/index.js", import.meta.url))],
  env: { ...process.env, ROLLBAR_CONFIG_FILE: configPath },
});

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content.find((entry) => entry.type === "text")?.text;
  assert(!result.isError, `${name} failed: ${content}`);
  return JSON.parse(content);
}

try {
  await client.connect(transport);
  const target = { project, item_id };
  const history = await call("list-item-events", { ...target, limit: 20 });
  assert(Array.isArray(history.events));
  const filtered = await call("list-item-events", {
    ...target,
    type: ["item_comment", "item_status_history"],
    limit: 20,
  });
  assert(
    filtered.events.every((event) =>
      ["item_comment", "item_status_history"].includes(event.type),
    ),
  );

  // A single POST, never retried automatically, even when a later assertion fails.
  const posted = await call("post-item-comment", { ...target, comment: text });
  assert.equal(posted.user_id, expectedUserId);
  assert.equal(posted.item_id, item_id);
  assert.equal(posted.via_api, true);
  assert.equal(posted.text, text);

  const query = { ...target, type: ["item_comment"], limit: 100 };
  const first = await call("list-item-events", query);
  const lastPage = Math.max(1, Math.ceil(first.total_count / query.limit));
  let found = first.events.find((event) => event.id === posted.id);
  // Oldest-first history: check the last two pages to cover a boundary while
  // other test users post. Reads remain bounded regardless of history length.
  for (
    let page = Math.max(2, lastPage - 1);
    !found && page <= lastPage;
    page++
  ) {
    const result = await call("list-item-events", { ...query, page });
    found = result.events.find((event) => event.id === posted.id);
  }
  assert(found, `Created comment ${posted.id} was not found in item history`);
  assert.equal(found.text, text);
  assert.equal(found.user_id, expectedUserId);
  assert.equal(found.via_api, true);
  console.log(
    `Passed: comment ${posted.id} was created and read back as user ${expectedUserId}.`,
  );
} finally {
  await client.close();
  await transport.close();
}
