import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agent-test-"));
process.env.ANTHROPIC_API_KEY = "test";
const { runTurn, _setClient } = await import("../src/agent.js");

// Faux client : 1er appel → demande l'outil create_task ; 2e appel → texte final.
function fakeStream(message, textDeltas = []) {
  const handlers = {};
  return {
    on(ev, fn) { handlers[ev] = fn; return this; },
    async finalMessage() { for (const d of textDeltas) handlers.text?.(d); return message; },
  };
}
const calls = [];
_setClient({ beta: { messages: { stream(params) {
  calls.push({ ...params, messages: [...params.messages] });
  if (calls.length === 1) {
    return fakeStream({ stop_reason: "tool_use", content: [
      { type: "text", text: "Je l'ajoute." },
      { type: "tool_use", id: "tu1", name: "create_task", input: { title: "Acheter du pain", due: "2026-09-15", priority: "normale", domain: "perso", notes: "" } },
    ] }, ["Je l'ajoute."]);
  }
  return fakeStream({ stop_reason: "end_turn", content: [{ type: "text", text: "C'est noté pour demain." }] }, ["C'est noté pour demain."]);
} } } });

test("boucle outil → résultat → réponse finale", async () => {
  const events = [];
  const { messages, text } = await runTurn([], "Rappelle-moi d'acheter du pain demain", (e) => events.push(e));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].model, "claude-opus-5");
  assert.equal(calls[0].fallbacks, "default");
  assert.ok(calls[0].tools.some((t) => t.name === "web_search"));
  // Le résultat de l'outil est renvoyé dans un seul message utilisateur.
  const toolResultMsg = calls[1].messages.at(-1);
  assert.equal(toolResultMsg.role, "user");
  assert.equal(toolResultMsg.content[0].type, "tool_result");
  assert.match(toolResultMsg.content[0].content, /Acheter du pain/);
  assert.ok(events.some((e) => e.type === "tool" && e.label === "Ajout d'une tâche"));
  assert.match(text, /C'est noté pour demain/);
  assert.equal(messages.length, 4);
});

test("refus géré proprement", async () => {
  calls.length = 0;
  _setClient({ beta: { messages: { stream() { return fakeStream({ stop_reason: "refusal", content: [] }); } } } });
  const { text } = await runTurn([], "test", () => {});
  assert.match(text, /ne peux pas/);
});
