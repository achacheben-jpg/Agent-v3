import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agent-test-"));
const { executeTool, toolDefinitions } = await import("../src/tools.js");

test("chaque outil a un schéma strict", () => {
  for (const t of toolDefinitions) {
    assert.equal(t.strict, true, t.name);
    assert.equal(t.input_schema.additionalProperties, false, t.name);
    assert.deepEqual(Object.keys(t.input_schema.properties).sort(), [...t.input_schema.required].sort(), t.name);
  }
});

test("cycle de vie d'une tâche", () => {
  const out = executeTool("create_task", { title: "Appeler le plombier", due: "2026-09-15", priority: "haute", domain: "perso", notes: "" });
  const id = out.match(/\(([a-z0-9]+)\)/)[1];
  assert.match(executeTool("list_tasks", { status: "open", domain: "all", due_before: "" }), /Appeler le plombier/);
  assert.match(executeTool("update_task", { id, title: "", due: "", priority: "", notes: "", done: "true" }), /\[x\]/);
  assert.equal(executeTool("list_tasks", { status: "open", domain: "all", due_before: "" }), "Aucune tâche.");
  assert.match(executeTool("delete_task", { id }), /supprimée/);
});

test("événement avec fin automatique et filtre de dates", () => {
  executeTool("create_event", { title: "Dentiste", start: "2026-09-20T10:00", end: "", location: "", domain: "perso", notes: "" });
  assert.match(executeTool("list_events", { from: "2026-09-20", to: "2026-09-21" }), /11:00 : Dentiste/);
  assert.equal(executeTool("list_events", { from: "2026-10-01", to: "2026-10-31" }), "Aucun événement sur cette période.");
});

test("mémoire", () => {
  const out = executeTool("remember", { fact: "Préfère les rendez-vous le matin" });
  const id = out.match(/\(([a-z0-9]+)\)/)[1];
  assert.match(executeTool("forget", { id }), /Oublié/);
});
