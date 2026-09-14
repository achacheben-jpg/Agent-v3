// Outils que l'assistant peut utiliser : tâches, agenda, notes, mémoire.
// Chaque outil a une définition (ce que Claude voit) et une fonction d'exécution.
import { store, newId } from "./store.js";

const DOMAINS = ["pro", "perso"];

function nowIso() { return new Date().toISOString(); }

function summarizeTask(t) {
  return `${t.done ? "[x]" : "[ ]"} (${t.id}) ${t.title}` +
    (t.due ? ` — échéance ${t.due}` : "") +
    (t.priority ? ` — priorité ${t.priority}` : "") +
    (t.domain ? ` — ${t.domain}` : "") +
    (t.notes ? ` — ${t.notes}` : "");
}

function summarizeEvent(e) {
  return `(${e.id}) ${e.start} → ${e.end || "?"} : ${e.title}` +
    (e.location ? ` @ ${e.location}` : "") +
    (e.domain ? ` — ${e.domain}` : "") +
    (e.notes ? ` — ${e.notes}` : "");
}

function summarizeNote(n) {
  return `(${n.id}) ${n.title}${n.tags?.length ? ` [${n.tags.join(", ")}]` : ""}\n${n.content}`;
}

export const baseToolDefinitions = [
  {
    name: "list_tasks",
    description: "Liste les tâches (à faire). Filtrable par statut, domaine (pro/perso) et échéance. Utiliser pour répondre à « qu'est-ce que j'ai à faire ? ».",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["open", "done", "all"], description: "open = non terminées (défaut)" },
        domain: { type: "string", enum: ["pro", "perso", "all"] },
        due_before: { type: "string", description: "Date ISO (AAAA-MM-JJ) : ne garder que les tâches dont l'échéance est avant cette date. Chaîne vide = pas de filtre." },
      },
      required: ["status", "domain", "due_before"],
    },
  },
  {
    name: "create_task",
    description: "Crée une tâche à faire. Pour un rappel (« rappelle-moi… »), donner une échéance avec l'heure (AAAA-MM-JJTHH:MM) : une notification sera envoyée sur le téléphone à ce moment-là (à 8h si seule la date est donnée).",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        due: { type: "string", description: "Échéance ISO (AAAA-MM-JJ ou AAAA-MM-JJTHH:MM). Chaîne vide si aucune." },
        priority: { type: "string", enum: ["haute", "normale", "basse"] },
        domain: { type: "string", enum: DOMAINS },
        notes: { type: "string", description: "Détails éventuels, chaîne vide sinon." },
      },
      required: ["title", "due", "priority", "domain", "notes"],
    },
  },
  {
    name: "update_task",
    description: "Modifie ou termine une tâche existante (identifiée par son id). Seuls les champs non vides sont modifiés.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        due: { type: "string" },
        priority: { type: "string", enum: ["haute", "normale", "basse", ""] },
        notes: { type: "string" },
        done: { type: "string", enum: ["true", "false", ""], description: "true pour marquer terminée, false pour rouvrir, vide pour ne pas changer" },
      },
      required: ["id", "title", "due", "priority", "notes", "done"],
    },
  },
  {
    name: "delete_task",
    description: "Supprime définitivement une tâche.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "list_events",
    description: "Liste les rendez-vous / événements de l'agenda entre deux dates.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        from: { type: "string", description: "Date/heure ISO de début (incluse)" },
        to: { type: "string", description: "Date/heure ISO de fin (incluse)" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "create_event",
    description: "Ajoute un rendez-vous ou un événement à l'agenda.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        start: { type: "string", description: "Début ISO (AAAA-MM-JJTHH:MM)" },
        end: { type: "string", description: "Fin ISO. Chaîne vide = 1 heure après le début." },
        location: { type: "string", description: "Lieu, chaîne vide sinon" },
        domain: { type: "string", enum: DOMAINS },
        notes: { type: "string", description: "Chaîne vide si rien" },
      },
      required: ["title", "start", "end", "location", "domain", "notes"],
    },
  },
  {
    name: "update_event",
    description: "Modifie un événement existant (par id). Seuls les champs non vides sont modifiés.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        location: { type: "string" },
        notes: { type: "string" },
      },
      required: ["id", "title", "start", "end", "location", "notes"],
    },
  },
  {
    name: "delete_event",
    description: "Supprime un événement de l'agenda.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "search_notes",
    description: "Recherche dans les notes (titre, contenu, étiquettes). Requête vide = toutes les notes.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "save_note",
    description: "Crée une note, ou la remplace si un id est fourni.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "Vide pour créer une nouvelle note" },
        title: { type: "string" },
        content: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["id", "title", "content", "tags"],
    },
  },
  {
    name: "delete_note",
    description: "Supprime une note.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "remember",
    description: "Mémorise durablement une information sur l'utilisateur (préférence, habitude, personne importante, contrainte). À utiliser dès que l'utilisateur dit quelque chose d'utile pour les prochaines conversations.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { fact: { type: "string", description: "Une phrase courte et factuelle" } },
      required: ["fact"],
    },
  },
  {
    name: "forget",
    description: "Supprime une information mémorisée (par id).",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
];

// Étiquette lisible affichée dans l'application pendant que l'outil tourne.
export const baseToolLabels = {
  list_tasks: "Consultation des tâches",
  create_task: "Ajout d'une tâche",
  update_task: "Mise à jour d'une tâche",
  delete_task: "Suppression d'une tâche",
  list_events: "Consultation de l'agenda",
  create_event: "Ajout à l'agenda",
  update_event: "Modification de l'agenda",
  delete_event: "Suppression dans l'agenda",
  search_notes: "Recherche dans les notes",
  save_note: "Enregistrement d'une note",
  delete_note: "Suppression d'une note",
  remember: "Mémorisation",
  forget: "Oubli",
  web_search: "Recherche sur le web",
};

export function executeBaseTool(name, input) {
  const db = store.data;
  switch (name) {
    case "list_tasks": {
      let list = db.tasks;
      const status = input.status || "open";
      if (status === "open") list = list.filter((t) => !t.done);
      if (status === "done") list = list.filter((t) => t.done);
      if (input.domain && input.domain !== "all") list = list.filter((t) => t.domain === input.domain);
      if (input.due_before) list = list.filter((t) => t.due && t.due <= input.due_before);
      list = [...list].sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
      return list.length ? list.map(summarizeTask).join("\n") : "Aucune tâche.";
    }
    case "create_task": {
      const t = { id: newId(), title: input.title, due: input.due || "", priority: input.priority || "normale", domain: input.domain || "perso", notes: input.notes || "", done: false, createdAt: nowIso() };
      db.tasks.push(t); store.save();
      return "Tâche créée : " + summarizeTask(t);
    }
    case "update_task": {
      const t = db.tasks.find((x) => x.id === input.id);
      if (!t) return `Aucune tâche avec l'id ${input.id}.`;
      for (const k of ["title", "due", "priority", "notes"]) if (input[k]) t[k] = input[k];
      if (input.done === "true") t.done = true;
      if (input.done === "false") t.done = false;
      store.save();
      return "Tâche mise à jour : " + summarizeTask(t);
    }
    case "delete_task": {
      const i = db.tasks.findIndex((x) => x.id === input.id);
      if (i < 0) return `Aucune tâche avec l'id ${input.id}.`;
      const [t] = db.tasks.splice(i, 1); store.save();
      return `Tâche supprimée : ${t.title}`;
    }
    case "list_events": {
      const list = db.events
        .filter((e) => (!input.from || (e.end || e.start) >= input.from) && (!input.to || e.start <= input.to))
        .sort((a, b) => a.start.localeCompare(b.start));
      return list.length ? list.map(summarizeEvent).join("\n") : "Aucun événement sur cette période.";
    }
    case "create_event": {
      let end = input.end;
      if (!end) {
        // Fin = début + 1 h, calculée sans passer par le fuseau du serveur.
        const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(input.start);
        if (m) {
          const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 1, +m[5]));
          end = d.toISOString().slice(0, 16);
        }
      }
      const e = { id: newId(), title: input.title, start: input.start, end: end || "", location: input.location || "", domain: input.domain || "perso", notes: input.notes || "", createdAt: nowIso() };
      db.events.push(e); store.save();
      return "Événement ajouté : " + summarizeEvent(e);
    }
    case "update_event": {
      const e = db.events.find((x) => x.id === input.id);
      if (!e) return `Aucun événement avec l'id ${input.id}.`;
      for (const k of ["title", "start", "end", "location", "notes"]) if (input[k]) e[k] = input[k];
      store.save();
      return "Événement modifié : " + summarizeEvent(e);
    }
    case "delete_event": {
      const i = db.events.findIndex((x) => x.id === input.id);
      if (i < 0) return `Aucun événement avec l'id ${input.id}.`;
      const [e] = db.events.splice(i, 1); store.save();
      return `Événement supprimé : ${e.title}`;
    }
    case "search_notes": {
      const q = (input.query || "").toLowerCase().trim();
      const list = db.notes.filter((n) => !q || [n.title, n.content, ...(n.tags || [])].join(" ").toLowerCase().includes(q));
      return list.length ? list.map(summarizeNote).join("\n\n") : "Aucune note.";
    }
    case "save_note": {
      let n = input.id ? db.notes.find((x) => x.id === input.id) : null;
      if (n) {
        Object.assign(n, { title: input.title, content: input.content, tags: input.tags || [], updatedAt: nowIso() });
      } else {
        n = { id: newId(), title: input.title, content: input.content, tags: input.tags || [], createdAt: nowIso(), updatedAt: nowIso() };
        db.notes.push(n);
      }
      store.save();
      return "Note enregistrée : " + summarizeNote(n);
    }
    case "delete_note": {
      const i = db.notes.findIndex((x) => x.id === input.id);
      if (i < 0) return `Aucune note avec l'id ${input.id}.`;
      const [n] = db.notes.splice(i, 1); store.save();
      return `Note supprimée : ${n.title}`;
    }
    case "remember": {
      const m = { id: newId(), fact: input.fact, createdAt: nowIso() };
      db.memory.push(m); store.save();
      return `Mémorisé (${m.id}) : ${m.fact}`;
    }
    case "forget": {
      const i = db.memory.findIndex((x) => x.id === input.id);
      if (i < 0) return `Rien en mémoire avec l'id ${input.id}.`;
      const [m] = db.memory.splice(i, 1); store.save();
      return `Oublié : ${m.fact}`;
    }
    default:
      return `Outil inconnu : ${name}`;
  }
}

export function memorySummary() {
  const m = store.data.memory;
  if (!m.length) return "(rien pour l'instant)";
  return m.map((x) => `- (${x.id}) ${x.fact}`).join("\n");
}
