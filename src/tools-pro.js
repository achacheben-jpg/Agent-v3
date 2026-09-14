// Outils « métier » du Dr Achache : documents PDF, créneaux, répertoire des experts,
// Google Agenda et Gmail (quand la connexion Google est active).
import { store, newId } from "./store.js";
import { generators, PREJUDICE_KEYS, todayFR } from "./documents.js";
import { findSlots, formatSlots } from "./slots.js";
import { rapportDocx } from "./reports.js";
import * as google from "./google.js";

const S = (desc, extra = {}) => ({ type: "string", description: desc, ...extra });
const strict = (props, desc) => ({ description: desc, strict: true, input_schema: { type: "object", additionalProperties: false, properties: props, required: Object.keys(props) } });
const TZ = () => process.env.TIMEZONE || "Europe/Paris";

export function nowLocal() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ(), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(" ", "T");
}

function registerFile(f) {
  const rec = { id: f.id, filename: f.filename, kind: f.kind, url: f.url, createdAt: new Date().toISOString() };
  store.data.files.push(rec); store.save();
  return rec;
}

// ------------------------------------------------------------ Définitions
export const proToolDefinitions = [
  { name: "generate_ordonnance", ...strict({
    nom: S("Nom de famille du patient"), prenom: S("Prénom"),
    date: S("Date JJ/MM/AAAA, chaîne vide = aujourd'hui"),
    prescription: { type: "array", items: { type: "string" }, description: "Lignes de prescription ; une chaîne vide = ligne d'espacement" },
  }, "Génère une ordonnance PDF à l'en-tête du Dr Achache, signée.") },

  { name: "generate_facture", ...strict({
    patient: S("Nom du patient concerné (pour le nom du fichier), chaîne vide sinon"),
    date: S("Date JJ/MM/AAAA, chaîne vide = aujourd'hui"),
    lignes: { type: "array", items: { type: "string" }, description: "Lignes de prestation. Tableau vide = les 3 lignes habituelles (étude du dossier, explications et discussion, déplacement) ; ajouter la ligne « Assistance à l'expertise de … au cabinet du … le … à … »" },
    montant_ht: { type: "number", description: "Montant HT en euros, 0 = tarif par défaut (600)" },
    taux_tva: { type: "number", description: "Taux de TVA, 0 = 20" },
    acquittee: { type: "boolean", description: "Mention « Facture acquittée »" },
  }, "Génère une note d'honoraires PDF (en-tête Dr Achache, TVA et TTC calculés, signature).") },

  { name: "generate_conclusions", ...strict({
    nom: S("Nom du patient"), prenom: S("Prénom"),
    expert: S("Expert avec son titre, ex. « Dr DUPONT »"),
    date_evenement: S("Date de l'accident JJ/MM/AAAA"),
    date_expertise: S("Date de l'expertise JJ/MM/AAAA, chaîne vide = ce jour"),
    consolide: { type: "boolean" },
    prejudices: { type: "object", additionalProperties: false,
      properties: Object.fromEntries(PREJUDICE_KEYS.map((k) => [k, S(`Valeur du poste ${k} (chaîne vide = poste absent)`)])),
      required: PREJUDICE_KEYS,
      description: "Uniquement les postes dictés par Ben ; laisser vides les autres. Gênes temporaires : dates « du JJ/MM/AAAA au JJ/MM/AAAA ». SE et PE en x/7. AIPP en nombre (le % est ajouté)." },
  }, "Génère le courrier « Cher Maître » de conclusions d'expertise en PDF. Jamais d'envoi par mail.") },

  { name: "generate_certificat", ...strict({
    titre: S("Titre, ex. « Certificat médical initial », « Certificat de consolidation »"),
    sous_titre: S("Contexte, ex. « en vue d'une procédure en responsabilité médicale », chaîne vide sinon"),
    date: S("Date JJ/MM/AAAA, chaîne vide = aujourd'hui"),
    blocs: { type: "array", description: "Corps du certificat, dans l'ordre", items: { type: "object", additionalProperties: false,
      properties: { type: { type: "string", enum: ["paragraph", "heading", "bullet", "spacing"] }, text: S("Texte du bloc (vide pour spacing)") }, required: ["type", "text"] } },
  }, "Génère un certificat médical PDF (CMI, constatation, ITT, consolidation, aggravation, doléances). Commencer par « Je soussigné, Dr Benjamin ACHACHE, … certifie … ».") },

  { name: "generate_courrier", ...strict({
    destinataire: S("Bloc destinataire (nom, adresse), chaîne vide sinon"),
    objet: S("Objet du courrier, chaîne vide sinon"),
    date: S("Date JJ/MM/AAAA, chaîne vide = aujourd'hui"),
    corps: S("Texte du courrier, paragraphes séparés par une ligne vide"),
    formule: S("Formule de politesse finale ; chaîne vide = formule standard"),
  }, "Génère un courrier libre PDF à l'en-tête du Dr Achache, signé.") },

  { name: "generate_rapport", ...strict({
    style: { type: "string", enum: ["evaluation", "quantum", "conseil"], description: "evaluation = évaluation Dintilhac ou discussion médico-légale (Times 12 justifié, aucun gras) ; quantum = liquidation chiffrée (Arial 11, titres en gras, tableau de synthèse) ; conseil = rapport de conseil avec en-tête complet à gauche" },
    titre: S("Titre du rapport, ex. « Évaluation médico-légale des préjudices corporels »"),
    sous_titre: S("Ex. « Dossier de Madame Marie DUPONT », chaîne vide sinon"),
    entete_lignes: { type: "array", items: { type: "string" }, description: "Lignes d'identité sous le titre (date de naissance, date de l'accident, consolidation…), tableau vide sinon" },
    sections: { type: "array", description: "Sections dans l'ordre", items: { type: "object", additionalProperties: false, properties: { titre: S("Titre de section"), paragraphes: { type: "array", items: { type: "string" }, description: "Paragraphes de texte continu" } }, required: ["titre", "paragraphes"] } },
    tableau: { type: "array", description: "Tableau de synthèse (liquidation uniquement), tableau vide sinon", items: { type: "object", additionalProperties: false, properties: { poste: S("Poste"), victime: S("Montant victime"), tiers: S("Montant tiers payeurs, vide sinon"), total: S("Total") }, required: ["poste", "victime", "tiers", "total"] } },
    nom_fichier: S("Nom du fichier sans extension, ex. « Evaluation_DUPONT_Marie », chaîne vide = d'après le titre"),
  }, "Génère un rapport Word (.docx) : évaluation Dintilhac, discussion médico-légale, liquidation chiffrée, rapport de conseil. Rédige d'abord le contenu complet, puis appelle l'outil une seule fois.") },

  { name: "find_slots", ...strict({
    duration: { type: "integer", enum: [20, 30, 45], description: "20 = consultation simple, 30 = moyenne, 45 = longue" },
    from: S("Date de début de recherche AAAA-MM-JJ, chaîne vide = maintenant"),
    weeks: { type: "integer", description: "Semaines explorées (0 = 8)" },
  }, "Propose les 3 prochains créneaux libres conformes aux règles de Ben (horaires, garde alternée, tampons et trajets d'expertise). Utilise Google Agenda s'il est connecté, sinon l'agenda local.") },

  { name: "list_experts", ...strict({ query: S("Filtre sur le nom, chaîne vide = tous") }, "Répertoire des médecins experts : adresse et temps de trajet depuis le cabinet.") },
  { name: "save_expert", ...strict({
    name: S("Nom de l'expert tel qu'il apparaît dans les titres d'agenda (ex. « LANDRIEAU »)"),
    address: S("Adresse du lieu d'expertise, chaîne vide si inconnue"),
    travelMinutes: { type: "integer", description: "Temps de trajet aller en minutes depuis le cabinet" },
    notes: S("Particularités (jours de convocation, lieu inhabituel…), chaîne vide sinon"),
  }, "Ajoute ou met à jour un expert du répertoire (utilisé pour les tampons de créneaux).") },
];

export const googleToolDefinitions = [
  { name: "gcal_list_events", ...strict({
    from: S("Date de début AAAA-MM-JJ"), to: S("Date de fin AAAA-MM-JJ (incluse)"),
    calendar: S("« primary » (agenda de Ben, défaut) ou l'id/adresse d'un autre agenda, chaîne vide = primary"),
    with_description: { type: "boolean", description: "Inclure la description (fiche patient Doctolib). Coûteux : seulement si nécessaire." },
  }, "Liste les événements de Google Agenda entre deux dates (début, fin, titre, couleur, lieu).") },
  { name: "gcal_create_event", ...strict({
    title: S("Titre"), start: S("Début AAAA-MM-JJTHH:MM"), end: S("Fin AAAA-MM-JJTHH:MM"),
    description: S("Description, chaîne vide sinon"), location: S("Lieu, chaîne vide sinon"),
    colorId: S("Couleur Google (5 = expertise « Banane »), chaîne vide = défaut"),
  }, "Crée un événement dans l'agenda principal Google de Ben.") },
  { name: "gcal_update_event", ...strict({
    id: S("Id de l'événement"), title: S("Nouveau titre ou vide"), start: S("Nouveau début ou vide"), end: S("Nouvelle fin ou vide"),
    description: S("Nouvelle description ou vide"), location: S("Nouveau lieu ou vide"),
  }, "Modifie un événement Google Agenda (champs vides = inchangés).") },
  { name: "gcal_delete_event", ...strict({ id: S("Id de l'événement") }, "Supprime un événement Google Agenda. Uniquement sur demande explicite de Ben.") },
  { name: "gmail_search", ...strict({
    query: S("Requête Gmail (ex. « is:unread in:inbox », « from:me DUPONT », « newer_than:7d avocat »)"),
    max: { type: "integer", description: "Nombre max de fils (0 = 15)" },
  }, "Recherche des fils de discussion Gmail (objet, expéditeur, date, aperçu, non lu).") },
  { name: "gmail_read_thread", ...strict({ id: S("Id du fil") }, "Lit le contenu complet d'un fil Gmail (messages, pièces jointes listées par nom ; le contenu des pièces jointes n'est pas accessible).") },
  { name: "gmail_create_draft", ...strict({
    to: S("Destinataire(s)"), cc: S("Copie, chaîne vide sinon"), subject: S("Objet"),
    text: S("Corps du mail en texte, signature standard incluse si nécessaire"),
    thread_id: S("Id du fil pour une réponse dans le fil, chaîne vide sinon"),
    in_reply_to: S("Message-ID du message auquel on répond, chaîne vide sinon"),
  }, "Crée un BROUILLON Gmail (jamais d'envoi : Ben relit et envoie lui-même).") },
  { name: "gmail_mark_read", ...strict({ thread_id: S("Id du fil") }, "Marque un fil comme lu. Réservé aux catégories BASSE, SANS ACTION et PUBLICITAIRE du tri, ou sur demande de Ben.") },
];

export const proToolLabels = {
  generate_ordonnance: "Rédaction de l'ordonnance", generate_facture: "Rédaction de la note d'honoraires",
  generate_conclusions: "Rédaction des conclusions", generate_certificat: "Rédaction du certificat", generate_courrier: "Rédaction du courrier", generate_rapport: "Rédaction du rapport Word",
  find_slots: "Recherche de créneaux", list_experts: "Consultation du répertoire des experts", save_expert: "Mise à jour du répertoire",
  gcal_list_events: "Lecture de Google Agenda", gcal_create_event: "Ajout dans Google Agenda", gcal_update_event: "Modification dans Google Agenda", gcal_delete_event: "Suppression dans Google Agenda",
  gmail_search: "Recherche dans Gmail", gmail_read_thread: "Lecture d'un mail", gmail_create_draft: "Préparation d'un brouillon", gmail_mark_read: "Marquage comme lu",
};

// ------------------------------------------------------------- Exécution
function fileMessage(f, extra = "") {
  registerFile(f);
  return `Document généré : ${f.filename}\nLien à donner à Ben : ${f.url}${extra ? "\n" + extra : ""}`;
}

export async function executeProTool(name, input, ctx = {}) {
  const db = store.data;
  switch (name) {
    case "generate_ordonnance": {
      const f = await generators.ordonnance({ nom: input.nom, prenom: input.prenom, date: input.date || "", prescription: input.prescription });
      ctx.onFile?.(f); return fileMessage(f);
    }
    case "generate_facture": {
      const f = await generators.facture({ patient: input.patient, date: input.date || "", lignes: input.lignes, montant_ht: input.montant_ht || undefined, taux_tva: input.taux_tva || undefined, acquittee: input.acquittee });
      ctx.onFile?.(f); return fileMessage(f, `HT ${f.ht} € · TVA ${f.tva} € · TTC ${f.ttc} €`);
    }
    case "generate_conclusions": {
      const prejudices = Object.fromEntries(Object.entries(input.prejudices || {}).filter(([, v]) => v && String(v).trim()));
      const f = await generators.conclusions({ nom: input.nom, prenom: input.prenom, expert: input.expert, date_evenement: input.date_evenement, date_expertise: input.date_expertise || "", consolide: input.consolide, prejudices });
      ctx.onFile?.(f); return fileMessage(f, "Postes retenus : " + (f.retained.join(" ; ") || "aucun"));
    }
    case "generate_certificat": {
      const f = await generators.certificat({ titre: input.titre, sous_titre: input.sous_titre || "", date: input.date || "", blocs: input.blocs });
      ctx.onFile?.(f); return fileMessage(f);
    }
    case "generate_courrier": {
      const f = await generators.courrier({ destinataire: input.destinataire || "", objet: input.objet || "", date: input.date || "", corps: input.corps, formule: input.formule });
      ctx.onFile?.(f); return fileMessage(f);
    }
    case "generate_rapport": {
      const f = await rapportDocx(input);
      ctx.onFile?.(f); return fileMessage(f);
    }
    case "find_slots": {
      const now = nowLocal();
      const weeks = input.weeks || 8;
      const from = input.from && input.from > now.slice(0, 10) ? input.from : now.slice(0, 10);
      const toDate = new Date(from + "T00:00:00Z"); toDate.setUTCDate(toDate.getUTCDate() + weeks * 7);
      const to = toDate.toISOString().slice(0, 10);
      let events; let source;
      if (google.isConnected()) { events = await google.listEvents({ from, to }); source = "Google Agenda"; }
      else { events = db.events.map((e) => ({ ...e, colorId: e.colorId || (/(expertise|\/)/i.test(e.title) && e.domain === "pro" ? "5" : "") })); source = "agenda local (Google non connecté)"; }
      const res = findSlots({ duration: input.duration, nowLocal: now, events, experts: db.experts, from, weeks });
      return `Source : ${source}.\n` + formatSlots(res, input.duration);
    }
    case "list_experts": {
      const q = (input.query || "").toLowerCase();
      const list = db.experts.filter((e) => !q || e.name.toLowerCase().includes(q));
      return list.length ? list.map((e) => `(${e.id}) ${e.name} — ${e.travelMinutes} min${e.address ? ` — ${e.address}` : ""}${e.notes ? ` — ${e.notes}` : ""}`).join("\n") : "Répertoire vide pour cette recherche.";
    }
    case "save_expert": {
      let e = db.experts.find((x) => x.name.toLowerCase() === input.name.toLowerCase());
      if (e) Object.assign(e, { address: input.address || e.address, travelMinutes: input.travelMinutes, notes: input.notes || e.notes });
      else { e = { id: newId(), name: input.name, address: input.address || "", travelMinutes: input.travelMinutes, notes: input.notes || "" }; db.experts.push(e); }
      store.save();
      return `Expert enregistré : ${e.name} — ${e.travelMinutes} min`;
    }
    // ----- Google -----
    case "gcal_list_events": {
      const evs = await google.listEvents({ from: input.from, to: input.to, calendarId: input.calendar || "primary", withDescription: input.with_description });
      if (!evs.length) return "Aucun événement.";
      return evs.map((e) => `(${e.id}) ${e.allDay ? e.start + " (journée)" : e.start + " → " + e.end.slice(11)} [couleur ${e.colorId || "-"}] ${e.title}${e.location ? " @ " + e.location : ""}${e.description ? "\n   " + e.description.replace(/\n/g, "\n   ") : ""}`).join("\n");
    }
    case "gcal_create_event": { const r = await google.createEvent(input); return `Événement créé (${r.id}) : ${r.link}`; }
    case "gcal_update_event": { const r = await google.updateEvent(input); return `Événement modifié (${r.id}) : ${r.link}`; }
    case "gcal_delete_event": { await google.deleteEvent(input); return "Événement supprimé."; }
    case "gmail_search": {
      const t = await google.searchThreads({ query: input.query, max: input.max || 15 });
      if (!t.length) return "Aucun mail trouvé.";
      return t.map((x) => `(${x.id}) ${x.unread ? "● " : ""}${x.date} — ${x.from} — ${x.subject} [${x.messages} msg]\n   ${x.snippet}`).join("\n");
    }
    case "gmail_read_thread": {
      const t = await google.readThread({ id: input.id });
      return `Objet : ${t.subject}\n` + t.messages.map((m) => `--- ${m.date} — De : ${m.from} — À : ${m.to}${m.cc ? " — Cc : " + m.cc : ""}${m.unread ? " (non lu)" : ""}\nMessage-ID : ${m.messageId}${m.attachments.length ? "\nPièces jointes : " + m.attachments.join(", ") : ""}\n${m.body}`).join("\n\n");
    }
    case "gmail_create_draft": {
      const r = await google.createDraft({ to: input.to, cc: input.cc, subject: input.subject, text: input.text, threadId: input.thread_id, inReplyTo: input.in_reply_to, references: input.in_reply_to });
      return `Brouillon créé (non envoyé) : ${r.link}`;
    }
    case "gmail_mark_read": { await google.markRead({ threadId: input.thread_id }); return "Fil marqué comme lu."; }
    default: return null;
  }
}
