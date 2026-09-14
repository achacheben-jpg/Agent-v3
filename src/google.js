// Connexion à Google (Agenda + Gmail) avec le protocole OAuth : Ben autorise
// l'application une fois depuis son iPhone, puis l'assistant peut lire l'agenda,
// chercher des mails et préparer des brouillons. Jamais d'envoi de mail.
import fs from "node:fs";
import path from "node:path";
import { TZ, dataDir, nowLocal } from "./util.js";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
];

function tokenFile() { return path.join(dataDir(), "google-token.json"); }

export function isConfigured() { return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET); }
export function isConnected() { return isConfigured() && fs.existsSync(tokenFile()); }

function readToken() { try { return JSON.parse(fs.readFileSync(tokenFile(), "utf8")); } catch { return null; } }
function writeToken(t) { fs.mkdirSync(dataDir(), { recursive: true }); fs.writeFileSync(tokenFile(), JSON.stringify(t, null, 2), { mode: 0o600 }); }
export function disconnect() { try { fs.unlinkSync(tokenFile()); } catch { /* déjà absent */ } }

export function authUrl(redirectUri, state) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: "code",
    scope: SCOPES.join(" "), access_type: "offline", prompt: "consent", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function exchangeCode(code, redirectUri) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  const t = await r.json();
  if (!r.ok || !t.refresh_token) throw new Error("Google n'a pas renvoyé d'autorisation durable : " + (t.error_description || t.error || "réessayez"));
  writeToken({ refresh_token: t.refresh_token, access_token: t.access_token, expires_at: Date.now() + (t.expires_in - 60) * 1000 });
  // Récupère l'adresse mail connectée (utile pour l'affichage).
  try {
    const me = await api("https://gmail.googleapis.com/gmail/v1/users/me/profile");
    const tok = readToken(); tok.email = me.emailAddress; writeToken(tok);
  } catch { /* facultatif */ }
}

export function connectedEmail() { return readToken()?.email || ""; }

async function accessToken() {
  const t = readToken();
  if (!t) throw new Error("Google n'est pas connecté.");
  if (t.access_token && t.expires_at > Date.now()) return t.access_token;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: t.refresh_token, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, grant_type: "refresh_token" }),
  });
  const n = await r.json();
  if (!r.ok) { if (n.error === "invalid_grant") disconnect(); throw new Error("Connexion Google expirée : reconnectez Google dans les réglages."); }
  writeToken({ ...t, access_token: n.access_token, expires_at: Date.now() + (n.expires_in - 60) * 1000 });
  return n.access_token;
}

async function api(url, opts = {}) {
  const token = await accessToken();
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) } });
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `Erreur Google (${r.status})`);
  return j;
}

// ----------------------------------------------------------------- Agenda

function localIso(dt) {
  // Google renvoie « 2026-09-15T10:00:00+02:00 » ; on garde « 2026-09-15T10:00 » en heure locale de Ben.
  if (!dt) return "";
  if (dt.length === 10) return dt;
  return nowLocal(new Date(dt));
}

// Google exige des secondes dans les dates (« 2026-09-21T10:00:00 »).
function withSeconds(dt) { return /T\d{2}:\d{2}$/.test(dt) ? dt + ":00" : dt; }

export async function listCalendars() {
  const j = await api("https://www.googleapis.com/calendar/v3/users/me/calendarList");
  return (j.items || []).map((c) => ({ id: c.id, name: c.summary, primary: Boolean(c.primary) }));
}

/** Événements entre deux dates locales (AAAA-MM-JJ), champs réduits. */
export async function listEvents({ from, to, calendarId = "primary", withDescription = false }) {
  const out = []; let pageToken = "";
  // Marge d'un jour de chaque côté (le serveur n'est pas forcément à l'heure de Paris), puis filtrage local.
  const dayBefore = new Date(from + "T00:00:00Z"); dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  const dayAfter = new Date(to + "T00:00:00Z"); dayAfter.setUTCDate(dayAfter.getUTCDate() + 2);
  do {
    const p = new URLSearchParams({
      timeMin: dayBefore.toISOString(), timeMax: dayAfter.toISOString(),
      singleEvents: "true", orderBy: "startTime", maxResults: "250", timeZone: TZ(),
      fields: "nextPageToken,items(id,summary,description,colorId,start,end,location,status)",
    });
    if (pageToken) p.set("pageToken", pageToken);
    const j = await api(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${p}`);
    for (const e of j.items || []) {
      if (e.status === "cancelled") continue;
      const allDay = Boolean(e.start?.date);
      const startLocal = localIso(e.start?.dateTime || e.start?.date);
      if (startLocal.slice(0, 10) < from || startLocal.slice(0, 10) > to) continue;
      out.push({
        id: e.id, title: e.summary || "(sans titre)", allDay, colorId: e.colorId || "",
        start: localIso(e.start?.dateTime || e.start?.date), end: localIso(e.end?.dateTime || e.end?.date),
        location: e.location || "", ...(withDescription ? { description: e.description || "" } : {}),
      });
    }
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return out;
}

export async function createEvent({ title, start, end, description = "", location = "", colorId = "", calendarId = "primary" }) {
  const body = { summary: title, description, location, start: { dateTime: withSeconds(start), timeZone: TZ() }, end: { dateTime: withSeconds(end), timeZone: TZ() } };
  if (colorId) body.colorId = String(colorId);
  const e = await api(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, { method: "POST", body: JSON.stringify(body) });
  return { id: e.id, link: e.htmlLink };
}

export async function updateEvent({ id, calendarId = "primary", ...fields }) {
  const body = {};
  if (fields.title) body.summary = fields.title;
  if (fields.description) body.description = fields.description;
  if (fields.location) body.location = fields.location;
  if (fields.start) body.start = { dateTime: withSeconds(fields.start), timeZone: TZ() };
  if (fields.end) body.end = { dateTime: withSeconds(fields.end), timeZone: TZ() };
  if (fields.colorId) body.colorId = String(fields.colorId);
  const e = await api(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
  return { id: e.id, link: e.htmlLink };
}

export async function deleteEvent({ id, calendarId = "primary" }) {
  await api(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, { method: "DELETE" });
  return true;
}

// ------------------------------------------------------------------ Gmail
function headerOf(msg, name) { return (msg.payload?.headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || ""; }

function decodeBody(payload) {
  // Renvoie le texte brut du message (partie text/plain de préférence, sinon HTML dépouillé).
  const parts = [];
  const walk = (p) => {
    if (!p) return;
    if (p.body?.data && (p.mimeType === "text/plain" || p.mimeType === "text/html")) parts.push({ mime: p.mimeType, data: Buffer.from(p.body.data, "base64url").toString("utf8") });
    for (const c of p.parts || []) walk(c);
  };
  walk(payload);
  const plain = parts.find((p) => p.mime === "text/plain");
  if (plain) return plain.data;
  const html = parts.find((p) => p.mime === "text/html");
  if (html) return html.data.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s{2,}/g, " ").trim();
  return "";
}

function attachmentsOf(payload) {
  const out = [];
  const walk = (p) => { if (!p) return; if (p.filename) out.push(p.filename); for (const c of p.parts || []) walk(c); };
  walk(payload);
  return out;
}

export async function searchThreads({ query, max = 15 }) {
  const p = new URLSearchParams({ q: query, maxResults: String(Math.min(max, 50)) });
  const j = await api(`https://gmail.googleapis.com/gmail/v1/users/me/threads?${p}`);
  // Les fils sont indépendants : on les lit en parallèle.
  const details = await Promise.all((j.threads || []).map((t) => api(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${t.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`)));
  return details.map((d, i) => {
    const msgs = d.messages || [];
    const last = msgs[msgs.length - 1];
    return {
      id: j.threads[i].id, subject: headerOf(msgs[0], "Subject"), from: headerOf(last, "From"), date: headerOf(last, "Date"),
      messages: msgs.length, unread: msgs.some((m) => (m.labelIds || []).includes("UNREAD")), snippet: last?.snippet || "",
    };
  });
}

export async function readThread({ id, maxChars = 6000 }) {
  const d = await api(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${id}?format=full`);
  const msgs = (d.messages || []).map((m) => ({
    id: m.id, from: headerOf(m, "From"), to: headerOf(m, "To"), cc: headerOf(m, "Cc"), date: headerOf(m, "Date"),
    subject: headerOf(m, "Subject"), unread: (m.labelIds || []).includes("UNREAD"),
    attachments: attachmentsOf(m.payload), body: decodeBody(m.payload).slice(0, maxChars),
    messageId: headerOf(m, "Message-ID"), references: headerOf(m, "References"),
  }));
  return { id, subject: msgs[0]?.subject || "", messages: msgs };
}

export async function markRead({ threadId }) {
  await api(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}/modify`, { method: "POST", body: JSON.stringify({ removeLabelIds: ["UNREAD"] }) });
  return true;
}

function mime({ to, cc, subject, text, inReplyTo, references }) {
  const enc = (s) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
  const lines = [`To: ${to}`];
  if (cc) lines.push(`Cc: ${cc}`);
  lines.push(`Subject: ${enc(subject || "")}`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64");
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push("", Buffer.from(text, "utf8").toString("base64"));
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

/** Crée un brouillon (jamais d'envoi). Pour une réponse, passer threadId + inReplyTo. */
export async function createDraft({ to, cc = "", subject, text, threadId = "", inReplyTo = "", references = "" }) {
  const body = { message: { raw: mime({ to, cc, subject, text, inReplyTo, references }) } };
  if (threadId) body.message.threadId = threadId;
  const d = await api("https://gmail.googleapis.com/gmail/v1/users/me/drafts", { method: "POST", body: JSON.stringify(body) });
  return { id: d.id, link: "https://mail.google.com/mail/u/0/#drafts" };
}
