import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agent-att-"));
process.env.ANTHROPIC_API_KEY = "test";
const { userContent, hydrate } = await import("../src/agent.js");

test("les pièces jointes sont stockées sur disque et rechargées pour l'API", () => {
  const png = Buffer.from("fake-image").toString("base64");
  const stored = userContent("Que vois-tu ?", [{ name: "photo.png", type: "image/png", data: png }, { name: "note.txt", type: "text/plain", data: Buffer.from("bonjour").toString("base64") }]);
  assert.equal(stored.length, 3);
  assert.equal(stored[0].source.data, "", "l'historique ne contient pas le contenu");
  assert.ok(stored[0]._ref);
  assert.ok(fs.existsSync(path.join(process.env.DATA_DIR, "files", "attachments", stored[0]._ref)));
  assert.deepEqual(stored[2].cache_control, { type: "ephemeral" });

  const api = hydrate([{ role: "user", content: stored }]);
  assert.equal(api[0].content[0].source.data, png);
  assert.equal(api[0].content[0]._ref, undefined);
  assert.equal(api[0].content[1].source.data, "bonjour");
  // L'original n'est pas modifié.
  assert.equal(stored[0].source.data, "");
});

test("au plus 3 points de cache conservés, les plus récents", () => {
  const msgs = [];
  for (let i = 0; i < 5; i++) msgs.push({ role: "user", content: [{ type: "text", text: "m" + i, cache_control: { type: "ephemeral" } }] }, { role: "assistant", content: [{ type: "text", text: "r" }] });
  const api = hydrate(msgs);
  const kept = api.filter((m) => Array.isArray(m.content) && m.content[0].cache_control).map((m) => m.content[0].text);
  assert.deepEqual(kept, ["m2", "m3", "m4"]);
});
