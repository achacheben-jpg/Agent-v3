// Serveur web : sert l'application iPhone (dossier public) et expose l'API de chat.
import express from "express";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { store } from "./src/store.js";
import Anthropic from "@anthropic-ai/sdk";
import { runTurn } from "./src/agent.js";

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
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// ----- Authentification très simple par mot de passe partagé -----
function sessionToken() {
  return crypto.createHmac("sha256", SESSION_SECRET).update(APP_PASSWORD).digest("hex");
}
function isAuthed(req) {
  if (!APP_PASSWORD) return true;
  const c = req.cookies?.session || "";
  const expected = sessionToken();
  return c.length === expected.length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(expected));
}

app.post("/api/login", (req, res) => {
  const pwd = String(req.body?.password || "");
  const ok = !APP_PASSWORD || (pwd.length === APP_PASSWORD.length && crypto.timingSafeEqual(Buffer.from(pwd), Buffer.from(APP_PASSWORD)));
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
  const { conversationId, text } = req.body || {};
  const userText = String(text || "").trim();
  if (!userText) return res.status(400).json({ error: "Message vide" });

  let conv = conversationId ? store.getConversation(conversationId) : null;
  if (!conv) conv = store.createConversation();

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  send({ type: "start", conversationId: conv.id });

  conv.display.push({ role: "user", text: userText, at: new Date().toISOString() });
  if (conv.messages.length === 0) conv.title = userText.slice(0, 60);

  try {
    const { messages, text: reply } = await runTurn(conv.messages, userText, send);
    conv.messages = messages;
    conv.display.push({ role: "assistant", text: reply, at: new Date().toISOString() });
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

// ----- Fichiers de l'application -----
app.use(express.static(path.join(here, "public"), { maxAge: "1h", index: "index.html" }));
app.get("/{*any}", (req, res) => res.sendFile(path.join(here, "public", "index.html")));

app.listen(PORT, () => console.log(`Assistant prêt sur http://localhost:${PORT}`));
