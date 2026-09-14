// Le cœur de l'assistant : construit la demande envoyée à Claude, exécute les
// outils demandés et renvoie la réponse au fur et à mesure (streaming).
import Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions, toolLabels, executeTool, memorySummary } from "./toolset.js";
import { PROFILE_PROMPT } from "./profile.js";
import * as google from "./google.js";
import { hasSignature, filesDir } from "./documents.js";
import { TZ, nowLocal } from "./util.js";
import fs from "node:fs";
import path from "node:path";
import { newId } from "./store.js";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5";
const TIMEZONE = TZ();
const MAX_TOOL_ROUNDS = 16;

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}
// Pour les tests : permet de remplacer le client par une simulation.
export function _setClient(c) { client = c; }

// Partie stable du prompt système (mise en cache côté API : moins cher et plus rapide).
const STABLE_SYSTEM = `Tu es l'assistant personnel de Ben. Tu l'aides à gérer toute sa vie professionnelle et personnelle : rendez-vous, tâches, rappels, notes, documents et courriers, mails, organisation des journées, décisions à préparer, questions pratiques du quotidien. Tu parles toujours en français, de façon naturelle et directe.

${PROFILE_PROMPT}

# Tes outils
- Tâches (list_tasks, create_task, update_task, delete_task), notes (search_notes, save_note, delete_note), agenda local (list_events, create_event, update_event, delete_event) : l'agenda local sert quand Google n'est pas connecté ou pour des pense-bêtes.
- Mémoire durable (remember, forget) : mémorise spontanément ce qui sera utile plus tard (préférences, personnes, dossiers en cours, habitudes). Pas d'informations éphémères.
- Documents PDF (generate_ordonnance, generate_facture, generate_conclusions, generate_certificat, generate_courrier) : le lien renvoyé par l'outil est affiché automatiquement à Ben sous forme de carte ; ne le recopie pas, dis simplement que le document est prêt et résume-le en une phrase.
- Créneaux (find_slots) et répertoire des experts (list_experts, save_expert). Si un trajet est inconnu, demande-le à Ben ou estime-le (préciser l'adresse) puis enregistre-le avec save_expert.
- Google Agenda (gcal_*) et Gmail (gmail_*) quand la connexion Google est active. Gmail : lecture, recherche, brouillons uniquement. Jamais d'envoi, jamais de suppression. Lis les fils par petits lots.
- Recherche web (web_search) pour une information actuelle ou externe (adresse d'un expert, barème, actualité).

# Règles
- Les dates relatives (« demain », « vendredi prochain ») se calculent à partir de la date du jour indiquée ci-dessous, fuseau ${TIMEZONE}.
- Avant de modifier ou supprimer un élément, vérifie qu'il existe, puis agis sans redemander confirmation si la demande est explicite.
- Ne dis jamais qu'une chose est faite si l'outil ne l'a pas confirmé.
- Réponses courtes et concrètes, adaptées à un téléphone : l'essentiel d'abord, listes courtes, pas de tableau large, pas de rappel des règles.
- Quand une information de dossier manque, demande-la ou écris « non renseigné » ; n'invente jamais.`;

function formatNow() {
  const d = new Date();
  const date = new Intl.DateTimeFormat("fr-FR", { timeZone: TIMEZONE, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("fr-FR", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit" }).format(d);
  return `${date}, ${time} (ISO : ${nowLocal(d)})`;
}

function buildSystem() {
  const status = [
    google.isConnected() ? `Google connecté (${google.connectedEmail() || "compte Google"}) : agenda et Gmail disponibles.` : "Google non connecté : pas d'accès à l'agenda Google ni à Gmail (Ben peut le connecter dans les réglages de l'application).",
    hasSignature() ? "Signature manuscrite enregistrée : les PDF sont signés." : "Aucune signature manuscrite enregistrée : les PDF portent seulement le nom dactylographié (Ben peut la dessiner dans les réglages).",
  ].join("\n");
  return [
    { type: "text", text: STABLE_SYSTEM, cache_control: { type: "ephemeral" } },
    { type: "text", text: `Nous sommes le ${formatNow()}.\n${status}\n\nCe que tu sais déjà de Ben (mémoire) :\n${memorySummary()}` },
  ];
}

function buildTools() {
  return [...toolDefinitions(), { type: "web_search_20260209", name: "web_search", max_uses: 3 }];
}

// ----- Pièces jointes -----
// Les photos et PDF envoyés par Ben sont enregistrés sur le disque ; l'historique de la
// conversation ne garde qu'une référence (« _ref ») pour rester léger. Au moment d'appeler
// l'API, hydrate() remet le contenu en place.
function attachmentsDir() { const d = path.join(filesDir(), "attachments"); fs.mkdirSync(d, { recursive: true }); return d; }

/** Construit le contenu du message utilisateur (texte + pièces jointes éventuelles), forme stockée. */
export function userContent(text, attachments = []) {
  if (!attachments.length) return text;
  const blocks = [];
  for (const a of attachments) {
    const file = `${newId()}_${String(a.name || "piece").replace(/[^a-zA-Z0-9._-]+/g, "_")}`;
    fs.writeFileSync(path.join(attachmentsDir(), file), Buffer.from(a.data, "base64"));
    if (a.type.startsWith("image/")) blocks.push({ type: "image", source: { type: "base64", media_type: a.type, data: "" }, _ref: file });
    else if (a.type === "application/pdf") blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: "" }, title: a.name, _ref: file });
    else if (a.type.startsWith("text/")) blocks.push({ type: "document", source: { type: "text", media_type: "text/plain", data: "" }, title: a.name, _ref: file });
  }
  // Point de cache sur le texte : les pièces jointes qui précèdent sont mises en cache pour les tours suivants.
  blocks.push({ type: "text", text: text || "(voir pièce jointe)", cache_control: { type: "ephemeral" } });
  return blocks;
}

/** Version « prête pour l'API » de l'historique : recharge les pièces jointes depuis le disque. */
export function hydrate(messages) {
  // Au plus 3 points de cache sur les messages (le prompt système en utilise déjà un).
  let cacheable = 3;
  return [...messages].reverse().map((m) => {
    if (!Array.isArray(m.content)) return m;
    const content = m.content.map((b) => {
      if (b._ref) {
        const { _ref, ...rest } = b;
        let data = "";
        try { const buf = fs.readFileSync(path.join(attachmentsDir(), _ref)); data = rest.source.type === "text" ? buf.toString("utf8") : buf.toString("base64"); }
        catch { return { type: "text", text: `(pièce jointe ${_ref} indisponible)` }; }
        return { ...rest, source: { ...rest.source, data } };
      }
      if (b.cache_control) { if (cacheable > 0) { cacheable--; return b; } const { cache_control, ...rest } = b; return rest; }
      return b;
    });
    return { ...m, content };
  }).reverse();
}

/**
 * Lance un tour de conversation.
 * @param {Array} history  messages précédents (format API)
 * @param {string|Array} userText  message de l'utilisateur (texte ou blocs)
 * @param {(event: object) => void} onEvent  appelé pour chaque morceau de réponse
 * @returns {Promise<{messages: Array, text: string, files: Array}>}
 */
export async function runTurn(history, userText, onEvent) {
  const messages = [...history, { role: "user", content: userText }];
  let fullText = "";
  const files = [];

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
      messages: hydrate(messages),
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
      let content; let isError = false;
      try {
        content = await executeTool(tu.name, tu.input, { onFile: (f) => { files.push(f); onEvent({ type: "file", file: { filename: f.filename, url: f.url, kind: f.kind } }); } });
      } catch (err) {
        content = `Erreur : ${err.message}`; isError = true;
      }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: String(content ?? ""), ...(isError ? { is_error: true } : {}) });
    }
    // Tous les résultats dans un seul message utilisateur (obligatoire pour l'API).
    messages.push({ role: "user", content: results });
    if (fullText && !fullText.endsWith("\n")) { fullText += "\n\n"; onEvent({ type: "text", delta: "\n\n" }); }
  }

  return { messages, text: fullText, files };
}
