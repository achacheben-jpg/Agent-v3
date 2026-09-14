// Stockage simple dans un fichier JSON (une seule personne utilise l'application).
// Tout est gardé dans data/db.json : conversations, tâches, agenda, notes, mémoire.
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.resolve("data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const EMPTY = {
  conversations: {}, // id -> { id, title, createdAt, updatedAt, messages: [], display: [] }
  tasks: [],         // { id, title, due, priority, domain, done, notes, createdAt }
  events: [],        // { id, title, start, end, location, domain, notes }
  notes: [],         // { id, title, content, tags, createdAt, updatedAt }
  memory: [],        // { id, fact, createdAt }
};

let db = null;

function load() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      db = { ...structuredClone(EMPTY), ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) };
    } catch {
      db = structuredClone(EMPTY);
    }
  } else {
    db = structuredClone(EMPTY);
  }
  return db;
}

let saveTimer = null;
function save() {
  // Écriture regroupée pour éviter d'écrire le fichier des dizaines de fois par seconde.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  }, 50);
}

export function saveNow() {
  clearTimeout(saveTimer);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(load(), null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export function newId() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

export const store = {
  get data() { return load(); },
  save,

  // ----- Conversations -----
  listConversations() {
    return Object.values(load().conversations)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
  },
  getConversation(id) { return load().conversations[id] || null; },
  createConversation() {
    const now = new Date().toISOString();
    const conv = { id: newId(), title: "Nouvelle conversation", createdAt: now, updatedAt: now, messages: [], display: [] };
    load().conversations[conv.id] = conv;
    save();
    return conv;
  },
  updateConversation(conv) {
    conv.updatedAt = new Date().toISOString();
    load().conversations[conv.id] = conv;
    save();
  },
  deleteConversation(id) {
    delete load().conversations[id];
    save();
  },
};
