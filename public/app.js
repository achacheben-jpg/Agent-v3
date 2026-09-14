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
  messagesEl.appendChild(el);
  scrollBottom();
  return el;
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
  if (!text || state.sending) return;
  state.sending = true; $("#btn-send").disabled = true;
  addMessage("user", text);
  $("#input").value = ""; autosize();
  setStatus("Je réfléchis…");

  let assistantEl = null; let buffer = "";
  try {
    const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: state.conversationId, text }) });
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
  for (const m of c.display) addMessage(m.role, m.text, { error: m.error });
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
  $("#view-chat").hidden = name !== "chat"; $("#view-overview").hidden = name !== "overview";
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  if (name === "overview") loadOverview();
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
