// Serveur web : sert l'application iPhone (dossier public) et expose l'API de chat.
import express from "express";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { store } from "./src/store.js";
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import { runTurn, userContent } from "./src/agent.js";
import * as google from "./src/google.js";
import { filesDir, signaturePath } from "./src/documents.js";
import { seedIfEmpty } from "./src/seed.js";
import * as notify from "./src/notify.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || "";
// Secret de session : s'il n'est pas fourni, on le dérive du mot de passe pour que
// l'utilisateur reste connecté même après un redémarrage du serveur.
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.createHash("sha256").update("agent-v3|" + APP_PASSWORD).digest("hex");

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("⚠️  ANTHROPIC_API_KEY n'est pas définie : l'assistant ne pourra pas répondre.");
}
if (!APP_PASSWORD) {
  console.warn("⚠️  APP_PASSWORD n'est pas défini : l'application est accessible sans mot de passe.");
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "40mb" }));
seedIfEmpty();
app.use(cookieParser());

// ----- Authentification très simple par mot de passe partagé -----
function sessionToken() {
  return crypto.createHmac("sha256", SESSION_SECRET).update(APP_PASSWORD).digest("hex");
}
function isAuthed(req) {
  if (!APP_PASSWORD) return true;
  const c = Buffer.from(String(req.cookies?.session || ""));
  const expected = Buffer.from(sessionToken());
  return c.length === expected.length && crypto.timingSafeEqual(c, expected);
}

app.post("/api/login", (req, res) => {
  const pwd = Buffer.from(String(req.body?.password || ""));
  const expected = Buffer.from(APP_PASSWORD);
  const ok = !APP_PASSWORD || (pwd.length === expected.length && crypto.timingSafeEqual(pwd, expected));
  if (!ok) return res.status(401).json({ error: "Mot de passe incorrect" });
  res.cookie("session", sessionToken(), { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 365 * 24 * 3600 * 1000 });
  res.json({ ok: true });
});
app.post("/api/logout", (req, res) => { res.clearCookie("session"); res.json({ ok: true }); });
app.get("/api/me", (req, res) => res.json({ authed: isAuthed(req), needsPassword: Boolean(APP_PASSWORD), userName: process.env.USER_NAME || "" }));

app.use("/api", (req, res, next) => {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: "Non connecté" });
});

// ----- Conversations -----
app.get("/api/conversations", (req, res) => res.json(store.listConversations()));
app.post("/api/conversations", (req, res) => {
  const c = store.createConversation();
  res.json({ id: c.id, title: c.title, updatedAt: c.updatedAt });
});
app.get("/api/conversations/:id", (req, res) => {
  const c = store.getConversation(req.params.id);
  if (!c) return res.status(404).json({ error: "Introuvable" });
  res.json({ id: c.id, title: c.title, display: c.display });
});
app.delete("/api/conversations/:id", (req, res) => { store.deleteConversation(req.params.id); res.json({ ok: true }); });

// ----- Données (pour l'onglet « Vue d'ensemble ») -----
app.get("/api/overview", (req, res) => {
  const d = store.data;
  const today = new Date().toISOString().slice(0, 10);
  res.json({
    tasks: d.tasks.filter((t) => !t.done).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999")),
    events: d.events.filter((e) => (e.end || e.start) >= today).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 30),
    notes: d.notes.slice(-20).reverse(),
    memory: d.memory,
  });
});

// ----- Chat en streaming (Server-Sent Events) -----
app.post("/api/chat", async (req, res) => {
  const { conversationId, text, attachments } = req.body || {};
  const userText = String(text || "").trim();
  const atts = Array.isArray(attachments) ? attachments.filter((a) => a && a.data && a.type).slice(0, 5) : [];
  if (!userText && !atts.length) return res.status(400).json({ error: "Message vide" });

  let conv = conversationId ? store.getConversation(conversationId) : null;
  if (!conv) conv = store.createConversation();

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  send({ type: "start", conversationId: conv.id });

  conv.display.push({ role: "user", text: userText, attachments: atts.map((a) => a.name || a.type), at: new Date().toISOString() });
  if (conv.messages.length === 0) conv.title = (userText || atts[0]?.name || "Pièce jointe").slice(0, 60);

  try {
    const { messages, text: reply, files } = await runTurn(conv.messages, userContent(userText, atts), send);
    conv.messages = messages;
    conv.display.push({ role: "assistant", text: reply, files: files.map((f) => ({ filename: f.filename, url: f.url, kind: f.kind })), at: new Date().toISOString() });
    store.updateConversation(conv);
    send({ type: "done", title: conv.title });
  } catch (err) {
    console.error(err);
    // On garde le message utilisateur mais pas l'échange raté côté API.
    conv.display.push({ role: "assistant", text: "Désolé, une erreur est survenue : " + friendlyError(err), at: new Date().toISOString(), error: true });
    store.updateConversation(conv);
    send({ type: "error", message: friendlyError(err) });
  }
  res.end();
});

function friendlyError(err) {
  if (!process.env.ANTHROPIC_API_KEY) return "la clé API Anthropic n'est pas configurée sur le serveur.";
  if (err instanceof Anthropic.AuthenticationError) return "clé API invalide.";
  if (err instanceof Anthropic.RateLimitError) return "trop de demandes, réessayez dans un instant.";
  if (err instanceof Anthropic.APIConnectionError) return "impossible de joindre le service.";
  return err?.message || "erreur inconnue.";
}


// ----- Documents générés (PDF) -----
app.get("/api/files/:name", (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(filesDir(), name);
  if (!fs.existsSync(file)) return res.status(404).send("Document introuvable");
  res.setHeader("Content-Disposition", `inline; filename="${name.replace(/^[a-z0-9]+_/, "")}"`);
  res.sendFile(file);
});
app.get("/api/files", (req, res) => res.json([...store.data.files].reverse().slice(0, 50)));

// ----- Notifications sur le téléphone et préparation automatique -----
app.get("/api/push/key", (req, res) => res.json({ key: notify.vapidKeys().publicKey }));
app.post("/api/push/subscribe", (req, res) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint) return res.status(400).json({ error: "Abonnement invalide" });
  res.json({ ok: true, devices: notify.addSubscription(sub) });
});
app.post("/api/push/unsubscribe", (req, res) => { if (req.body?.endpoint) notify.removeSubscription(req.body.endpoint); res.json({ ok: true }); });
app.post("/api/push/test", async (req, res) => res.json({ sent: await notify.notify({ title: "Mon Assistant", body: "Les notifications fonctionnent." }) }));
app.get("/api/prefs", (req, res) => res.json({ dailyPrep: notify.settings().dailyPrep || { enabled: false, hour: "19:00" }, devices: notify.subscriptionCount() }));
app.post("/api/prefs", (req, res) => {
  const p = req.body?.dailyPrep;
  if (p) notify.settings().dailyPrep = { enabled: Boolean(p.enabled), hour: /^\d{2}:\d{2}$/.test(p.hour || "") ? p.hour : "19:00" };
  store.save();
  res.json({ ok: true });
});

// ----- Réglages : signature manuscrite, connexion Google -----
app.get("/api/settings", (req, res) => res.json({
  signature: fs.existsSync(signaturePath()),
  google: { configured: google.isConfigured(), connected: google.isConnected(), email: google.connectedEmail() },
  userName: process.env.USER_NAME || "",
}));
app.post("/api/signature", (req, res) => {
  const data = String(req.body?.data || "");
  const m = data.match(/^data:image\/png;base64,(.+)$/);
  if (!m) return res.status(400).json({ error: "Image PNG attendue" });
  fs.mkdirSync(path.dirname(signaturePath()), { recursive: true });
  fs.writeFileSync(signaturePath(), Buffer.from(m[1], "base64"));
  res.json({ ok: true });
});
app.delete("/api/signature", (req, res) => { try { fs.unlinkSync(signaturePath()); } catch {} res.json({ ok: true }); });
app.get("/api/signature", (req, res) => fs.existsSync(signaturePath()) ? res.sendFile(signaturePath()) : res.status(404).end());

function redirectUri(req) { return `${req.protocol}://${req.get("host")}/auth/google/callback`; }
app.get("/api/google/url", (req, res) => {
  if (!google.isConfigured()) return res.status(400).json({ error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquants sur le serveur (voir GUIDE-GOOGLE.md)." });
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie("gstate", state, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 600000 });
  res.json({ url: google.authUrl(redirectUri(req), state) });
});
app.get("/auth/google/callback", async (req, res) => {
  if (!isAuthed(req)) return res.status(401).send("Connectez-vous d'abord à l'application.");
  if (!req.query.code || req.query.state !== req.cookies?.gstate) return res.status(400).send("Demande invalide, recommencez depuis les réglages.");
  try { await google.exchangeCode(String(req.query.code), redirectUri(req)); res.redirect("/?google=ok"); }
  catch (err) { res.status(500).send("Connexion Google impossible : " + err.message); }
});
app.post("/api/google/disconnect", (req, res) => { google.disconnect(); res.json({ ok: true }); });

// ----- Fichiers de l'application -----
app.use(express.static(path.join(here, "public"), { maxAge: "1h", index: "index.html" }));
app.get("/{*any}", (req, res) => res.sendFile(path.join(here, "public", "index.html")));

app.listen(PORT, () => console.log(`Assistant prêt sur http://localhost:${PORT}`));
notify.startScheduler((history, text) => runTurn(history, text, () => {}));
