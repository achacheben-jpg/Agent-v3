// Assemble tous les outils disponibles pour l'assistant.
import { baseToolDefinitions, baseToolLabels, executeBaseTool } from "./tools.js";
import { proToolDefinitions, googleToolDefinitions, proToolLabels, executeProTool } from "./tools-pro.js";
import * as google from "./google.js";

export const toolLabels = { ...baseToolLabels, ...proToolLabels };

export function toolDefinitions() {
  const list = [...baseToolDefinitions, ...proToolDefinitions];
  if (google.isConnected()) list.push(...googleToolDefinitions);
  return list;
}

export async function executeTool(name, input, ctx) {
  const pro = await executeProTool(name, input, ctx);
  if (pro !== null) return pro;
  return executeBaseTool(name, input);
}

export { memorySummary } from "./tools.js";
