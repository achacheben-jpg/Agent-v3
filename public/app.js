// Logique de l'application (côté téléphone).
const $ = (s) => document.querySelector(s);
const state = { conversationId: null, sending: false };

// ----- Utilitaires -----
async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  if (r.status === 401) { showLogin(); throw new Error("Non connecté"); }
  return r.json();
}
function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
// Mise en forme légère du texte de l'assistant (gras, listes, liens).
function render(md) {
  let h = escapeHtml(md);
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
  h = h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  const lines = h.split("\n"); const out = []; let list = null;
  for (const line of lines) {
    const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) { const type = /^\s*\d/.test(line) ? "ol" : "ul"; if (!list || list.type !== type) { if (list) out.push(`</${list.type}>`); list = { type }; out.push(`<${type}>`); } out.push(`<li>${m[1]}</li>`); }
    else { if (list) { out.push(`</${list.type}>`); list = null; } if (line.trim()) out.push(`<p>${line.replace(/^#+\s*/, "")}</p>`); }
  }
  if (list) out.push(`</${list.type}>`);
  return out.join("");
}
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso.length <= 10 ? iso + "T00:00" : iso);
  if (isNaN(d)) return iso;
  const opts = iso.length <= 10 ? { weekday: "short", day: "numeric", month: "short" } : { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
  return d.toLocaleString("fr-FR", opts);
}

// ----- Écrans -----
function showLogin() { $("#login").hidden = false; $("#app").hidden = true; }
function showApp() { $("#login").hidden = true; $("#app").hidden = false; }

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: $("#password").value }) });
  if (r.ok) { $("#login-error").hidden = true; showApp(); init(); }
  else { $("#login-error").textContent = "Mot de passe incorrect."; $("#login-error").hidden = false; }
});

// ----- Messages -----
const messagesEl = $("#messages");
function addMessage(role, text, extra = {}) {
  $(".welcome")?.remove();
  const el = document.createElement("div");
  el.className = `msg ${role}` + (extra.error ? " error" : "");
  el.innerHTML = role === "assistant" ? render(text) : escapeHtml(text);
  if (role === "user" && extra.attachments?.length) el.innerHTML += `<span class="att-note">📎 ${escapeHtml(extra.attachments.join(", "))}</span>`;
  messagesEl.appendChild(el);
  for (const f of extra.files || []) addFileCard(f);
  scrollBottom();
  return el;
}
function addFileCard(f) {
  const a = document.createElement("a");
  a.className = "file-card"; a.href = f.url; a.target = "_blank"; a.rel = "noopener";
  const labels = { ordonnance: "Ordonnance", facture: "Note d'honoraires", conclusions: "Conclusions d'expertise", certificat: "Certificat médical", courrier: "Courrier" };
  a.innerHTML = `<span class="ico">📄</span><span><span class="name">${escapeHtml(f.filename)}</span><span class="hint">${labels[f.kind] || "Document"} · toucher pour ouvrir ou partager</span></span>`;
  messagesEl.appendChild(a);
  scrollBottom();
}
function setStatus(text) {
  let s = $(".status");
  if (!text) { s?.remove(); return; }
  if (!s) { s = document.createElement("div"); s.className = "status"; messagesEl.appendChild(s); }
  s.textContent = text; scrollBottom();
}
function scrollBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

async function send(text) {
  text = text.trim();
  if ((!text && !pending.length) || state.sending) return;
  state.sending = true; $("#btn-send").disabled = true;
  const attachments = pending.splice(0); renderStrip();
  addMessage("user", text, { attachments: attachments.map((a) => a.name) });
  $("#input").value = ""; autosize();
  setStatus("Je réfléchis…");

  let assistantEl = null; let buffer = "";
  try {
    const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: state.conversationId, text, attachments }) });
    if (r.status === 401) { showLogin(); return; }
    const reader = r.body.getReader(); const dec = new TextDecoder(); let pending = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += dec.decode(value, { stream: true });
      const parts = pending.split("\n\n"); pending = parts.pop();
      for (const part of parts) {
        const line = part.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const ev = JSON.parse(line.slice(6));
        if (ev.type === "start") { state.conversationId = ev.conversationId; }
        else if (ev.type === "text") {
          buffer += ev.delta;
          if (!assistantEl) { setStatus(""); assistantEl = addMessage("assistant", ""); }
          assistantEl.innerHTML = render(buffer); scrollBottom();
        }
        else if (ev.type === "tool") { setStatus(ev.label + "…"); }
        else if (ev.type === "file") { setStatus(""); addFileCard(ev.file); assistantEl = null; buffer = ""; }
        else if (ev.type === "error") { setStatus(""); addMessage("assistant", "Désolé, une erreur est survenue : " + ev.message, { error: true }); }
        else if (ev.type === "done") { setStatus(""); $("#conv-title").textContent = ev.title; }
      }
    }
  } catch (err) {
    setStatus(""); addMessage("assistant", "Connexion perdue. Réessayez.", { error: true });
  } finally {
    state.sending = false; $("#btn-send").disabled = false; setStatus("");
    loadConversations();
  }
}

$("#composer").addEventListener("submit", (e) => { e.preventDefault(); send($("#input").value); });
$("#input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send($("#input").value); } });
$("#input").addEventListener("input", autosize);
function autosize() { const t = $("#input"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 140) + "px"; }
document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => send(c.dataset.text)));

// ----- Conversations -----
async function loadConversations() {
  const list = await api("/api/conversations");
  const ul = $("#conv-list"); ul.innerHTML = "";
  if (!list.length) ul.innerHTML = '<li class="empty">Aucune conversation</li>';
  for (const c of list) {
    const li = document.createElement("li");
    li.className = c.id === state.conversationId ? "active" : "";
    li.innerHTML = `<span class="t">${escapeHtml(c.title)}</span><button class="del" aria-label="Supprimer">🗑</button>`;
    li.querySelector(".t").addEventListener("click", () => { openConversation(c.id); closeDrawer(); });
    li.querySelector(".del").addEventListener("click", async () => {
      if (!confirm("Supprimer cette conversation ?")) return;
      await api(`/api/conversations/${c.id}`, { method: "DELETE" });
      if (state.conversationId === c.id) newConversation();
      loadConversations();
    });
    ul.appendChild(li);
  }
}
async function openConversation(id) {
  const c = await api(`/api/conversations/${id}`);
  state.conversationId = c.id; $("#conv-title").textContent = c.title;
  messagesEl.innerHTML = "";
  for (const m of c.display) addMessage(m.role, m.text, { error: m.error, files: m.files, attachments: m.attachments });
  showView("chat");
  try { localStorage.setItem("lastConv", c.id); } catch {}
}
function newConversation() {
  state.conversationId = null; $("#conv-title").textContent = "Mon Assistant";
  location.reload();
}
function openDrawer() { $("#drawer").hidden = false; $("#backdrop").hidden = false; loadConversations(); }
function closeDrawer() { $("#drawer").hidden = true; $("#backdrop").hidden = true; }
$("#btn-menu").addEventListener("click", openDrawer);
$("#btn-close-drawer").addEventListener("click", closeDrawer);
$("#backdrop").addEventListener("click", closeDrawer);
$("#btn-new").addEventListener("click", () => { try { localStorage.removeItem("lastConv"); } catch {} newConversation(); });
$("#btn-logout").addEventListener("click", async () => { await fetch("/api/logout", { method: "POST" }); location.reload(); });

// ----- Onglets -----
function showView(name) {
  for (const v of ["chat", "overview", "settings"]) $(`#view-${v}`).hidden = name !== v;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  if (name === "overview") loadOverview();
  if (name === "settings") { loadSettings(); loadPrefs(); }
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));

async function loadOverview() {
  const o = await api("/api/overview");
  const fill = (sel, items, fn, empty) => { const ul = $(sel); ul.innerHTML = items.length ? items.map(fn).join("") : `<li class="empty">${empty}</li>`; };
  fill("#ov-events", o.events, (e) => `<li>${escapeHtml(e.title)}<span class="badge ${e.domain}">${e.domain}</span><span class="sub">${fmtDate(e.start)}${e.location ? " · " + escapeHtml(e.location) : ""}</span></li>`, "Rien de prévu.");
  fill("#ov-tasks", o.tasks, (t) => `<li>${escapeHtml(t.title)}<span class="badge ${t.domain}">${t.domain}</span>${t.priority === "haute" ? '<span class="badge haute">urgent</span>' : ""}${t.due ? `<span class="sub">Échéance : ${fmtDate(t.due)}</span>` : ""}</li>`, "Aucune tâche en cours.");
  fill("#ov-notes", o.notes, (n) => `<li>${escapeHtml(n.title)}<span class="sub">${escapeHtml(n.content.slice(0, 120))}</span></li>`, "Aucune note.");
  fill("#ov-memory", o.memory, (m) => `<li>${escapeHtml(m.fact)}</li>`, "Rien pour l'instant : dites-moi ce qui compte pour vous.");
}

// ----- Démarrage -----
async function init() {
  loadConversations();
  if (location.search.includes("google=ok")) { history.replaceState({}, "", "/"); showView("settings"); }
  const convParam = new URLSearchParams(location.search).get("conv");
  if (convParam) { history.replaceState({}, "", "/"); try { await openConversation(convParam); return; } catch {} }
  let last = null; try { last = localStorage.getItem("lastConv"); } catch {}
  if (last) { try { await openConversation(last); } catch { try { localStorage.removeItem("lastConv"); } catch {} } }
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.navigator.standalone || matchMedia("(display-mode: standalone)").matches;
  let tipSeen = false; try { tipSeen = localStorage.getItem("tipSeen"); } catch {}
  if (isIos && !standalone && !tipSeen) $("#install-tip").hidden = false;
}
$("#btn-tip-close").addEventListener("click", () => { $("#install-tip").hidden = true; try { localStorage.setItem("tipSeen", "1"); } catch {} });

(async () => {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  const me = await fetch("/api/me").then((r) => r.json()).catch(() => ({ authed: false }));
  if (me.authed) { showApp(); init(); } else showLogin();
})();

// ----- Pièces jointes (photos, PDF) -----
const pending = [];
$("#btn-attach").addEventListener("click", () => $("#file-input").click());
$("#file-input").addEventListener("change", async (e) => {
  for (const file of e.target.files) {
    if (pending.length >= 5) break;
    try { pending.push(await prepareFile(file)); } catch (err) { alert("Fichier illisible : " + file.name); }
  }
  e.target.value = ""; renderStrip();
});
async function prepareFile(file) {
  if (file.type.startsWith("image/")) {
    // On réduit la photo (max 1800 px) pour un envoi rapide depuis le téléphone.
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL("image/jpeg", 0.85);
    return { name: file.name || "photo.jpg", type: "image/jpeg", data: dataUrl.split(",")[1], preview: dataUrl };
  }
  if (file.size > 25 * 1024 * 1024) throw new Error("trop volumineux");
  const buf = await file.arrayBuffer();
  let bin = ""; const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { name: file.name, type: file.type || "application/octet-stream", data: btoa(bin) };
}
function renderStrip() {
  const strip = $("#attach-strip");
  strip.hidden = !pending.length; strip.innerHTML = "";
  pending.forEach((a, i) => {
    const d = document.createElement("div"); d.className = "att";
    d.innerHTML = (a.preview ? `<img src="${a.preview}" alt="">` : "📄 ") + escapeHtml(a.name) + `<button class="x" aria-label="Retirer">✕</button>`;
    d.querySelector(".x").addEventListener("click", () => { pending.splice(i, 1); renderStrip(); });
    strip.appendChild(d);
  });
}

// ----- Réglages -----
async function loadSettings() {
  const s = await api("/api/settings");
  const g = $("#google-box");
  if (!s.google.configured) {
    g.innerHTML = `<p class="warn">Connexion Google pas encore préparée sur le serveur.</p><p class="sub">Il faut ajouter les deux codes Google (GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET) dans les réglages du serveur. Le guide GUIDE-GOOGLE.md explique comment les obtenir.</p>`;
  } else if (s.google.connected) {
    g.innerHTML = `<p class="ok">✔ Connecté${s.google.email ? " : " + escapeHtml(s.google.email) : ""}</p><p class="sub">L'assistant peut lire l'agenda, chercher des mails et préparer des brouillons. Il n'envoie jamais de mail.</p><div class="row"><button id="g-off" class="btn-secondary">Déconnecter</button></div>`;
    $("#g-off").addEventListener("click", async () => { await api("/api/google/disconnect", { method: "POST" }); loadSettings(); });
  } else {
    g.innerHTML = `<p>Non connecté.</p><p class="sub">Autorisez l'accès à votre agenda et à Gmail pour les créneaux, le tri des mails et la préparation de journée.</p><div class="row"><button id="g-on" class="btn-primary">Connecter Google</button></div>`;
    $("#g-on").addEventListener("click", async () => { const r = await api("/api/google/url"); if (r.url) location.href = r.url; else alert(r.error); });
  }
  $("#sig-status").textContent = s.signature ? "Signature enregistrée." : "Aucune signature enregistrée pour l'instant.";
  $("#sig-status").className = "sub " + (s.signature ? "ok" : "warn");
  $("#sig-preview").hidden = !s.signature; $("#sig-delete").hidden = !s.signature;
  if (s.signature) $("#sig-preview").src = "/api/signature?" + Date.now();
  const files = await api("/api/files");
  $("#files-list").innerHTML = files.length ? files.map((f) => `<li><a class="file-card" href="${f.url}" target="_blank" rel="noopener"><span class="ico">📄</span><span><span class="name">${escapeHtml(f.filename)}</span><span class="hint">${new Date(f.createdAt).toLocaleString("fr-FR")}</span></span></a></li>`).join("") : '<li class="empty">Aucun document pour l\'instant.</li>';
}

// Pad de signature (dessin au doigt).
(() => {
  const pad = $("#sig-pad"); const ctx = pad.getContext("2d");
  ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#000";
  let drawing = false; let drawn = false;
  const pos = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; };
  pad.addEventListener("pointerdown", (e) => { drawing = true; drawn = true; ctx.beginPath(); ctx.moveTo(...pos(e)); pad.setPointerCapture(e.pointerId); });
  pad.addEventListener("pointermove", (e) => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); });
  const stop = () => { drawing = false; };
  pad.addEventListener("pointerup", stop); pad.addEventListener("pointercancel", stop);
  $("#sig-clear").addEventListener("click", () => { ctx.clearRect(0, 0, pad.width, pad.height); drawn = false; });
  $("#sig-save").addEventListener("click", async () => {
    if (!drawn) return alert("Dessinez d'abord votre signature.");
    const r = await api("/api/signature", { method: "POST", body: JSON.stringify({ data: pad.toDataURL("image/png") }) });
    if (r.ok) { ctx.clearRect(0, 0, pad.width, pad.height); drawn = false; loadSettings(); } else alert(r.error || "Erreur");
  });
  $("#sig-delete").addEventListener("click", async () => { if (confirm("Supprimer la signature ?")) { await api("/api/signature", { method: "DELETE" }); loadSettings(); } });
})();

// ----- Notifications (Web Push) et préférences -----
function b64ToU8(b) { const s = atob(b.replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(s, (c) => c.charCodeAt(0)); }
async function loadPrefs() {
  const p = await api("/api/prefs");
  $("#prep-enabled").checked = Boolean(p.dailyPrep?.enabled); $("#prep-hour").value = p.dailyPrep?.hour || "19:00";
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const standalone = window.navigator.standalone || matchMedia("(display-mode: standalone)").matches;
  let sub = null; try { sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription(); } catch {}
  const st = $("#push-status");
  if (!supported) { st.textContent = standalone ? "Notifications non disponibles sur cet appareil." : "Ajoutez d'abord l'application à l'écran d'accueil (Partager → Sur l'écran d'accueil)."; st.className = "sub warn"; $("#push-on").hidden = true; }
  else if (sub) { st.textContent = `Activées sur cet appareil (${p.devices} appareil${p.devices > 1 ? "s" : ""} au total).`; st.className = "sub ok"; $("#push-on").hidden = true; $("#push-test").hidden = false; }
  else { st.textContent = "Non activées sur cet appareil."; st.className = "sub warn"; $("#push-on").hidden = false; $("#push-test").hidden = true; }
}
$("#push-on").addEventListener("click", async () => {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return alert("Les notifications ont été refusées. Vous pouvez les autoriser dans Réglages iPhone → Notifications → Assistant.");
    const { key } = await api("/api/push/key");
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
    await api("/api/push/subscribe", { method: "POST", body: JSON.stringify({ subscription }) });
    loadPrefs();
  } catch (err) { alert("Activation impossible : " + err.message); }
});
$("#push-test").addEventListener("click", async () => { const r = await api("/api/push/test", { method: "POST" }); if (!r.sent) alert("Aucune notification envoyée : vérifiez l'activation."); });
const savePrefs = () => api("/api/prefs", { method: "POST", body: JSON.stringify({ dailyPrep: { enabled: $("#prep-enabled").checked, hour: $("#prep-hour").value } }) });
$("#prep-enabled").addEventListener("change", savePrefs); $("#prep-hour").addEventListener("change", savePrefs);
