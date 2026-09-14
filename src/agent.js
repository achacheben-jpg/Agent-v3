// Le cœur de l'assistant : construit la demande envoyée à Claude, exécute les
// outils demandés et renvoie la réponse au fur et à mesure (streaming).
import Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions, toolLabels, executeTool, memorySummary } from "./tools.js";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5";
const TIMEZONE = process.env.TIMEZONE || "Europe/Paris";
const USER_NAME = process.env.USER_NAME || "";
const MAX_TOOL_ROUNDS = 12;

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}
// Pour les tests : permet de remplacer le client par une simulation.
export function _setClient(c) { client = c; }

// Partie stable du prompt système (mise en cache côté API : moins cher et plus rapide).
const STABLE_SYSTEM = `Tu es l'assistant personnel de ${USER_NAME || "l'utilisateur"}. Tu l'aides à gérer toute sa vie professionnelle et personnelle : rendez-vous, tâches, rappels, notes, courriers et messages à rédiger, décisions à préparer, organisation des journées, questions pratiques du quotidien.

Tu parles toujours en français, de façon naturelle et directe, comme un assistant de confiance. L'utilisateur n'est pas informaticien : évite le jargon technique.

Tu disposes d'outils :
- tâches (list_tasks, create_task, update_task, delete_task)
- agenda (list_events, create_event, update_event, delete_event)
- notes (search_notes, save_note, delete_note)
- mémoire durable (remember, forget) : mémorise spontanément ce qui sera utile plus tard (préférences, habitudes, proches, contraintes, projets en cours). Ne mémorise pas les informations éphémères.
- recherche web (web_search) quand une information actuelle ou externe est nécessaire.

Règles :
- Quand l'utilisateur mentionne quelque chose à faire ou un rendez-vous, propose de l'enregistrer, ou enregistre-le directement si la demande est claire.
- Les dates relatives (« demain », « vendredi prochain ») se calculent à partir de la date du jour indiquée ci-dessous, fuseau ${TIMEZONE}.
- Avant de modifier ou supprimer un élément, vérifie qu'il existe (liste-le) puis agis sans redemander confirmation si la demande est explicite.
- Ne dis jamais que quelque chose est enregistré si l'outil ne l'a pas confirmé.
- Réponses courtes et concrètes sur téléphone : va à l'essentiel, utilise des listes quand il y a plusieurs éléments, pas de tableaux larges.
- Distingue le domaine « pro » et « perso » quand c'est utile.`;

function formatNow() {
  const d = new Date();
  const date = new Intl.DateTimeFormat("fr-FR", { timeZone: TIMEZONE, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("fr-FR", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit" }).format(d);
  const iso = new Intl.DateTimeFormat("sv-SE", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d).replace(" ", "T");
  return `${date}, ${time} (ISO : ${iso})`;
}

function buildSystem() {
  return [
    { type: "text", text: STABLE_SYSTEM, cache_control: { type: "ephemeral" } },
    { type: "text", text: `Nous sommes le ${formatNow()}.\n\nCe que tu sais déjà de l'utilisateur (mémoire) :\n${memorySummary()}` },
  ];
}

function buildTools() {
  return [
    ...toolDefinitions,
    { type: "web_search_20260209", name: "web_search", max_uses: 3 },
  ];
}

/**
 * Lance un tour de conversation.
 * @param {Array} history  messages précédents (format API)
 * @param {string} userText  message de l'utilisateur
 * @param {(event: object) => void} onEvent  appelé pour chaque morceau de réponse
 * @returns {Promise<{messages: Array, text: string}>} historique complet mis à jour et texte final
 */
export async function runTurn(history, userText, onEvent) {
  const messages = [...history, { role: "user", content: userText }];
  let fullText = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = getClient().beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: buildSystem(),
      tools: buildTools(),
      messages,
    });

    stream.on("text", (delta) => {
      fullText += delta;
      onEvent({ type: "text", delta });
    });

    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      const txt = "Je ne peux pas traiter cette demande.";
      fullText += txt;
      onEvent({ type: "text", delta: txt });
      messages.push({ role: "assistant", content: [{ type: "text", text: txt }] });
      break;
    }

    messages.push({ role: "assistant", content: message.content });

    if (message.stop_reason === "pause_turn") continue; // outil serveur interrompu : on relance
    if (message.stop_reason !== "tool_use") break;

    const toolUses = message.content.filter((b) => b.type === "tool_use");
    const results = [];
    for (const tu of toolUses) {
      onEvent({ type: "tool", name: tu.name, label: toolLabels[tu.name] || tu.name });
      let content;
      try {
        content = executeTool(tu.name, tu.input);
      } catch (err) {
        content = `Erreur : ${err.message}`;
      }
      results.push({ type: "tool_result", tool_use_id: tu.id, content });
    }
    // Tous les résultats dans un seul message utilisateur (obligatoire pour l'API).
    messages.push({ role: "user", content: results });
    if (fullText && !fullText.endsWith("\n")) { fullText += "\n\n"; onEvent({ type: "text", delta: "\n\n" }); }
  }

  return { messages, text: fullText };
}
