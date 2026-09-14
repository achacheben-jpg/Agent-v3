// Notifications sur l'iPhone (Web Push) et tâches planifiées :
//  - rappel quand une tâche arrive à échéance ;
//  - préparation automatique de la journée du lendemain (si activée et Google connecté).
import fs from "node:fs";
import path from "node:path";
import webpush from "web-push";
import { store } from "./store.js";
import * as google from "./google.js";
import { dataDir, nowLocal } from "./util.js";

function vapidFile() { return path.join(dataDir(), "vapid.json"); }

let keys = null;
export function vapidKeys() {
  if (keys) return keys;
  try { keys = JSON.parse(fs.readFileSync(vapidFile(), "utf8")); }
  catch { keys = webpush.generateVAPIDKeys(); fs.mkdirSync(dataDir(), { recursive: true }); fs.writeFileSync(vapidFile(), JSON.stringify(keys), { mode: 0o600 }); }
  webpush.setVapidDetails("mailto:" + (process.env.CONTACT_EMAIL || "achacheben@gmail.com"), keys.publicKey, keys.privateKey);
  return keys;
}

function subs() { const db = store.data; if (!db.push) db.push = []; return db.push; }
export function addSubscription(sub) {
  const list = subs();
  if (!list.some((s) => s.endpoint === sub.endpoint)) { list.push({ ...sub, createdAt: new Date().toISOString() }); store.save(); }
  return list.length;
}
export function removeSubscription(endpoint) { const db = store.data; db.push = subs().filter((s) => s.endpoint !== endpoint); store.save(); }
export function subscriptionCount() { return subs().length; }

/** Envoie une notification à tous les appareils enregistrés. */
export async function notify({ title, body, url = "/" }) {
  vapidKeys();
  const list = subs(); let sent = 0;
  for (const s of [...list]) {
    try { await webpush.sendNotification(s, JSON.stringify({ title, body, url })); sent++; }
    catch (err) { if (err.statusCode === 404 || err.statusCode === 410) removeSubscription(s.endpoint); else console.error("push:", err.message); }
  }
  return sent;
}

// ------------------------------------------------------------ Planification
export function settings() { const db = store.data; if (!db.settings) db.settings = {}; return db.settings; }

async function checkReminders() {
  const db = store.data; const now = nowLocal();
  for (const t of db.tasks) {
    if (t.done || !t.due || t.notified) continue;
    const due = t.due.length === 10 ? `${t.due}T08:00` : t.due.slice(0, 16);
    if (due <= now) {
      t.notified = true; store.save();
      // Une échéance dépassée depuis plus de 24 h (ancienne tâche) n'est pas notifiée après coup.
      const ageMin = (new Date(now) - new Date(due)) / 60000;
      if (ageMin <= 24 * 60) await notify({ title: "Rappel", body: t.title + (t.notes ? " — " + t.notes : ""), url: "/" });
    }
  }
}

let lastPrepDate = "";
async function checkDailyPrep(runAgent) {
  const s = settings().dailyPrep;
  if (!s?.enabled || !google.isConnected()) return;
  const now = nowLocal(); const today = now.slice(0, 10);
  const hour = s.hour || "19:00";
  if (now.slice(11, 16) < hour || lastPrepDate === today || settings().lastPrepDate === today) return;
  lastPrepDate = today; settings().lastPrepDate = today; store.save();
  try {
    const conv = store.createConversation();
    conv.title = "Préparation journée (automatique)";
    const { messages, text } = await runAgent(conv.messages, "Prépare ma journée de demain. Termine par un résumé en 3 lignes maximum.");
    conv.messages = messages;
    conv.display.push({ role: "user", text: "Prépare ma journée de demain.", at: new Date().toISOString() });
    conv.display.push({ role: "assistant", text, at: new Date().toISOString() });
    store.updateConversation(conv);
    const summary = text.trim().split("\n").filter(Boolean).slice(-3).join(" ").slice(0, 180);
    await notify({ title: "Votre journée de demain est prête", body: summary || "Ouvrez l'assistant pour le détail.", url: `/?conv=${conv.id}` });
  } catch (err) { console.error("préparation automatique :", err.message); }
}

/** Démarre la boucle de planification (toutes les minutes). */
export function startScheduler(runAgent) {
  vapidKeys();
  const tick = async () => { try { await checkReminders(); await checkDailyPrep(runAgent); } catch (err) { console.error("planificateur :", err.message); } };
  setTimeout(tick, 5000);
  return setInterval(tick, 60 * 1000);
}
