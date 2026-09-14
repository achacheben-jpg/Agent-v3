// Recherche de créneaux libres selon les règles de Ben (skills rdv-simple / moyen / long).
// Fonction pure : elle reçoit la liste des événements et renvoie les créneaux proposés.
import { SCHEDULE } from "./profile.js";

const DAY_MS = 86400000;

function toMin(hhmm) { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }
function pad(n) { return String(n).padStart(2, "0"); }

/** Lundi (date locale AAAA-MM-JJ) de la semaine contenant la date donnée. */
export function mondayOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // lundi = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** true si la semaine contenant la date est une semaine AVEC enfants. */
export function isWeekWithChildren(dateStr) {
  const ref = new Date(SCHEDULE.childrenReferenceMonday + "T00:00:00Z").getTime();
  const mon = new Date(mondayOf(dateStr) + "T00:00:00Z").getTime();
  const weeks = Math.round((mon - ref) / (7 * DAY_MS));
  return ((weeks % 2) + 2) % 2 === 0;
}

/** Extrait les noms d'experts d'un titre « PATIENT / EXPERT / AVOCAT ». */
export function expertsFromTitle(title) {
  const parts = String(title || "").split("/").map((s) => s.trim()).filter(Boolean);
  return parts.slice(1);
}

/** Temps de trajet (min) pour un événement d'expertise, d'après le répertoire des experts. */
export function travelForEvent(ev, experts) {
  const names = expertsFromTitle(ev.title);
  let best = 0; let unknown = [];
  for (const n of names) {
    const key = n.toLowerCase();
    const hit = experts.find((e) => key.includes(e.name.toLowerCase()) || e.name.toLowerCase().includes(key));
    if (hit) best = Math.max(best, Number(hit.travelMinutes) || 0);
    else unknown.push(n);
  }
  return { minutes: best, unknown };
}

/**
 * Calcule les créneaux.
 * @param {object} p
 * @param {number} p.duration  durée en minutes (20, 30, 45)
 * @param {string} p.nowLocal  date-heure locale « AAAA-MM-JJTHH:MM » (fuseau de Ben)
 * @param {Array}  p.events    [{ start: "AAAA-MM-JJTHH:MM", end, title, colorId, allDay }]
 * @param {Array}  p.experts   [{ name, travelMinutes }]
 * @param {string} [p.from]    date de début de recherche (AAAA-MM-JJ), défaut aujourd'hui
 * @param {number} [p.weeks]   nombre de semaines explorées (défaut 8)
 * @param {number} [p.count]   nombre de propositions (défaut 3)
 */
export function findSlots({ duration, nowLocal, events, experts = [], from, weeks = 8, count = 3 }) {
  const today = nowLocal.slice(0, 10);
  const nowMin = toMin(nowLocal.slice(11, 16));
  let start = from && from > today ? from : today;
  const high = []; const low = []; const warnings = new Set();

  for (let i = 0; i < weeks * 7 && high.length < count; i++) {
    const d = new Date(start + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (!SCHEDULE.workDays.includes(dow)) continue;
    const withKids = isWeekWithChildren(date);

    // Intervalles occupés du jour (en minutes depuis minuit), avec tampons d'expertise.
    const busy = [];
    for (const ev of events) {
      if (!ev.start) continue;
      if (ev.allDay) continue;
      const sDate = ev.start.slice(0, 10), eDate = (ev.end || ev.start).slice(0, 10);
      if (sDate > date || eDate < date) continue;
      let s = sDate < date ? 0 : toMin(ev.start.slice(11, 16));
      let e = eDate > date ? 24 * 60 : toMin((ev.end || ev.start).slice(11, 16));
      if (String(ev.colorId) === SCHEDULE.expertiseColorId) {
        e = Math.max(e, s + SCHEDULE.expertiseMinMinutes);
        const { minutes, unknown } = travelForEvent(ev, experts);
        for (const u of unknown) warnings.add(`Trajet inconnu pour « ${u} » (${date}) : tampon calculé sans trajet.`);
        s -= SCHEDULE.expertiseBufferMinutes + minutes;
        e += SCHEDULE.expertiseBufferMinutes + minutes;
      }
      busy.push([s, e]);
    }

    for (const [wStart, wEnd] of SCHEDULE.windows) {
      const ws = toMin(wStart), we = toMin(wEnd);
      if (withKids && dow === 5 && ws >= 14 * 60) continue; // vendredi après-midi interdit
      for (let t = ws; t + duration <= we; t += duration) {
        if (date === today && t <= nowMin) continue;
        const clash = busy.some(([s, e]) => t < e && t + duration > s);
        if (clash) continue;
        const slot = {
          date, start: `${pad(Math.floor(t / 60))}:${pad(t % 60)}`,
          end: `${pad(Math.floor((t + duration) / 60))}:${pad((t + duration) % 60)}`,
          late: t >= toMin(SCHEDULE.lateThreshold), withChildren: withKids,
          link: `https://calendar.google.com/calendar/u/0/r/day/${date.slice(0, 4)}/${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`,
        };
        if (slot.late && withKids) low.push(slot); else high.push(slot);
        if (high.length >= count) break;
      }
      if (high.length >= count) break;
    }
  }
  const slots = [...high, ...low].slice(0, count);
  return { slots, warnings: [...warnings], exhaustive: high.length >= count };
}

export function formatSlots(result, duration) {
  if (!result.slots.length) return "Aucun créneau conforme trouvé sur la période explorée.";
  const days = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const months = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const lines = result.slots.map((s, i) => {
    const d = new Date(s.date + "T00:00:00Z");
    const label = `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
    const tag = s.late ? (s.withChildren ? " (tardif, semaine AVEC enfants — repli)" : " (semaine sans enfant)") : "";
    return `${i + 1}. ${label} · ${s.start.replace(":", "h")} → ${s.end.replace(":", "h")}${tag} — ${s.link}`;
  });
  let out = `${result.slots.length} créneau(x) de ${duration} min :\n` + lines.join("\n");
  if (result.warnings.length) out += "\n\nÀ vérifier : " + result.warnings.join(" ");
  return out;
}
