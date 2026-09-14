// Génération des documents PDF à l'en-tête du Dr Achache
// (ordonnance, note d'honoraires, certificat, conclusions d'expertise, courrier).
// Mise en page reprise des skills « ordonnance » et « facture » : Times, noir, en-tête à gauche.
import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { DOCTOR, BILLING } from "./profile.js";
import { newId } from "./store.js";

const mm = 72 / 25.4;
const A4 = [595.28, 841.89];
const LEFT = 25 * mm;
const RIGHT = A4[0] - 25 * mm;
const TEXT_WIDTH = RIGHT - LEFT;

function dataDir() { return process.env.DATA_DIR || path.resolve("data"); }
export function filesDir() { const d = path.join(dataDir(), "files"); fs.mkdirSync(d, { recursive: true }); return d; }
export function signaturePath() { return path.join(dataDir(), "signature.png"); }
export function hasSignature() { return fs.existsSync(signaturePath()); }

export function todayFR() {
  const d = new Date();
  return new Intl.DateTimeFormat("fr-FR", { timeZone: process.env.TIMEZONE || "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

// ----- Briques communes -----
function header(doc) {
  let y = 20 * mm;
  doc.font("Times-Bold").fontSize(14).fillColor("black").text(DOCTOR.name, LEFT, y); y += 6 * mm;
  doc.font("Times-Roman").fontSize(10);
  for (const q of DOCTOR.qualifications) { doc.text(q, LEFT, y); y += 4.5 * mm; }
  y += 2 * mm;
  doc.fillColor("#333333");
  for (const l of [...DOCTOR.address, ...DOCTOR.contact, `N° AM : ${DOCTOR.am}`, `RPPS : ${DOCTOR.rpps}`]) { doc.text(l, LEFT, y); y += 4.5 * mm; }
  doc.fillColor("black");
  return y;
}

function title(doc, y, text, sub) {
  y += 12 * mm;
  doc.font("Times-Bold").fontSize(18).text(text, LEFT, y, { width: TEXT_WIDTH, align: "center" });
  y += 8 * mm;
  doc.moveTo(A4[0] / 2 - 30 * mm, y).lineTo(A4[0] / 2 + 30 * mm, y).lineWidth(1).stroke("black");
  if (sub) { y += 8 * mm; doc.font("Times-BoldItalic").fontSize(13).text(sub, LEFT, y, { width: TEXT_WIDTH, align: "center" }); }
  return y;
}

function paragraph(doc, y, text, opts = {}) {
  doc.font(opts.font || "Times-Roman").fontSize(opts.size || 12).fillColor("black");
  const h = doc.heightOfString(text, { width: TEXT_WIDTH, align: opts.align || "justify", lineGap: 3 });
  if (y + h > A4[1] - 30 * mm) { doc.addPage(); y = 25 * mm; }
  doc.text(text, opts.x || LEFT, y, { width: opts.width || TEXT_WIDTH, align: opts.align || "justify", lineGap: 3 });
  return y + h;
}

function signature(doc, y, minY) {
  const xr = RIGHT - 5 * mm;
  y = Math.max(y + 20 * mm, minY || 0);
  // Le bloc signature (nom + image) mesure ~36 mm : on change de page seulement s'il ne tient pas.
  if (y > A4[1] - 40 * mm) { doc.addPage(); y = 40 * mm; }
  doc.font("Times-BoldItalic").fontSize(14).fillColor("black").text(DOCTOR.signatureName, LEFT, y, { width: xr - LEFT, align: "right" });
  y += 6 * mm;
  if (hasSignature()) {
    try { doc.image(signaturePath(), xr - 45 * mm, y, { fit: [45 * mm, 30 * mm] }); } catch { /* image illisible : on l'ignore */ }
  }
}

function finish(doc, filename, meta) {
  return new Promise((resolve, reject) => {
    const id = newId();
    const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const filePath = path.join(filesDir(), `${id}_${safe}`);
    const out = fs.createWriteStream(filePath);
    doc.pipe(out);
    doc.end();
    out.on("finish", () => resolve({ id, filename: safe, path: filePath, url: `/api/files/${id}_${safe}`, ...meta }));
    out.on("error", reject);
  });
}

function newDoc(titleMeta) {
  const doc = new PDFDocument({ size: "A4", margins: { top: 0, left: 0, right: 0, bottom: 0 }, info: { Title: titleMeta, Author: DOCTOR.name } });
  return doc;
}

function stamp(str) { return (str || todayFR()).replace(/\//g, ""); }

// ----- Ordonnance -----
export async function ordonnance({ nom, prenom, date, prescription }) {
  const doc = newDoc("Ordonnance médicale");
  let y = header(doc);
  y = title(doc, y, "ORDONNANCE");
  y += 15 * mm;
  doc.font("Times-Bold").fontSize(12).text(`Patient(e) : ${prenom} ${String(nom).toUpperCase()}`, LEFT, y); y += 7 * mm;
  const d = date || todayFR();
  doc.font("Times-Roman").fontSize(12).text(`Le ${d}`, LEFT, y); y += 18 * mm;
  const lines = Array.isArray(prescription) ? prescription : String(prescription).split("\n");
  for (const line of lines) {
    if (!line.trim()) { y += 6 * mm; continue; }
    y = paragraph(doc, y, line.trim()) + 4 * mm;
  }
  signature(doc, y, 0);
  return finish(doc, `ordonnance_${String(nom).toUpperCase()}_${stamp(d)}.pdf`, { kind: "ordonnance" });
}

// ----- Note d'honoraires -----
function amount(v) { return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ","); }

export async function facture({ date, lieu, acquittee = true, lignes, montant_ht, taux_tva, patient }) {
  const doc = newDoc("Note d'honoraires");
  let y = header(doc);
  y = title(doc, y, "Note d'honoraires", acquittee ? "Facture acquittée" : "");
  y += 12 * mm;
  const d = date || todayFR();
  doc.font("Times-Roman").fontSize(12).text(`À ${lieu || DOCTOR.city}, le ${d}`, LEFT, y); y += 12 * mm;
  const list = (lignes && lignes.length ? lignes : BILLING.defaultLines).filter(Boolean);
  for (const l of list) y = paragraph(doc, y, l, { align: "left" }) + 3 * mm;
  const ht = Number(montant_ht ?? BILLING.defaultAmountHT);
  const tva = Number(taux_tva ?? BILLING.defaultVat);
  const mtva = Math.round(ht * tva) / 100;
  const ttc = Math.round((ht + mtva) * 100) / 100;
  y += 10 * mm;
  doc.font("Times-Roman").fontSize(12).text(`Honoraires forfaitaires ${amount(ht)} euros HT`, LEFT, y); y += 7 * mm;
  doc.text(`TVA ${amount(tva)}% ${amount(mtva)} euros`, LEFT, y); y += 12 * mm;
  doc.font("Times-Bold").text(`La présente facture est arrêtée à la somme de ${amount(ttc)} euros TTC.`, LEFT, y);
  signature(doc, y, 0);
  const tag = patient ? String(patient).toUpperCase().replace(/\s+/g, "_") : "honoraires";
  return finish(doc, `facture_${tag}_${stamp(d)}.pdf`, { kind: "facture", ht, tva: mtva, ttc });
}

// ----- Conclusions d'expertise -----
const LABELS_AVANT = [
  ["periode_gene_temporaire", "Période de gêne temporaire"], ["gtt", "Gêne temporaire totale"],
  ["gtp4", "Gêne temporaire partielle classe 4"], ["gtp3", "Gêne temporaire partielle classe 3"],
  ["gtp2", "Gêne temporaire partielle classe 2"], ["gtp1", "Gêne temporaire partielle classe 1"],
  ["atap", "Arrêt temporaire des activités professionnelles"], ["aide_humaine_temporaire", "Aide humaine temporaire"],
  ["aide_humaine_gtp4", "Aide humaine pendant la GTP classe 4"], ["aide_humaine_gtp3", "Aide humaine pendant la GTP classe 3"],
  ["aide_humaine_gtp2", "Aide humaine pendant la GTP classe 2"], ["aide_humaine_gtp1", "Aide humaine pendant la GTP classe 1"],
  ["souffrances_endurees", "Souffrances endurées"], ["prejudice_esthetique_temporaire", "Préjudice esthétique temporaire"],
];
const LABELS_APRES = [
  ["date_consolidation", "Date de consolidation"], ["aipp", "Atteinte à l'intégrité physique et psychique (AIPP)"],
  ["prejudice_esthetique_permanent", "Préjudice esthétique permanent"], ["prejudice_agrement", "Préjudice d'agrément"],
  ["prejudice_sexuel_etablissement", "Préjudice sexuel / d'établissement"], ["perte_gain_professionnel_futur", "Perte de gains professionnels futurs"],
  ["incidence_professionnelle", "Incidence professionnelle"], ["prejudice_scolaire", "Préjudice scolaire, universitaire ou de formation"],
  ["frais_divers", "Frais divers"], ["depenses_sante_futures", "Dépenses de santé futures"],
  ["frais_logement_adapte", "Frais de logement adapté"], ["frais_vehicule_adapte", "Frais de véhicule adapté"],
  ["aide_humaine_viagere", "Aide humaine viagère"], ["avis_sapiteur", "Avis sapiteur"],
];
export const PREJUDICE_KEYS = [...LABELS_AVANT, ...LABELS_APRES].map(([k]) => k);

export async function conclusions({ nom, prenom, expert, date_jour, date_expertise, date_evenement, consolide = true, prejudices = {} }) {
  const doc = newDoc("Conclusions d'expertise");
  let y = header(doc);
  const d = date_jour || todayFR();
  y += 10 * mm;
  doc.font("Times-Roman").fontSize(12).text(`Marseille, le ${d}`, LEFT, y, { width: TEXT_WIDTH, align: "right" }); y += 14 * mm;
  doc.text("Cher Maître,", LEFT, y); y += 10 * mm;
  const full = `${prenom} ${String(nom).toUpperCase()}`;
  const dexp = date_expertise || d;
  const when = dexp === d ? `ce jour, le ${d}` : `le ${dexp}`;
  y = paragraph(doc, y, `J'ai assisté ${when}, ${full} lors de l'expertise réalisée par le ${expert}, dans le cadre de l'accident survenu le ${date_evenement}.`) + 6 * mm;
  y = paragraph(doc, y, consolide
    ? `L'état de ${full} est consolidé. Les conclusions proposées à l'issue de l'expertise sont les suivantes :`
    : `L'état de ${full} n'est pas consolidé ; les conclusions ci-dessous sont prévisionnelles.`);
  const retained = [];
  const section = (t, labels) => {
    const items = labels.filter(([k]) => prejudices[k] && String(prejudices[k]).trim());
    if (!items.length) return;
    y += 8 * mm;
    doc.font("Times-Bold").fontSize(12).text(t, LEFT, y); y += 7 * mm;
    for (const [k, l] of items) {
      let v = String(prejudices[k]).trim();
      if (k === "aipp" && !v.endsWith("%")) v = `${v} %`;
      retained.push(`${l} : ${v}`);
      y = paragraph(doc, y, `– ${l} : ${v}`) + 2 * mm;
    }
  };
  section("Préjudices avant consolidation", LABELS_AVANT);
  section("Préjudices après consolidation", LABELS_APRES);
  y += 10 * mm;
  y = paragraph(doc, y, "Je reste à votre disposition pour tout complément d'information et vous prie de croire, Cher Maître, en l'expression de mes salutations distinguées.");
  signature(doc, y, 0);
  return finish(doc, `conclusions_${String(nom).toUpperCase()}_${stamp(d)}.pdf`, { kind: "conclusions", retained });
}

// ----- Certificat médical -----
export async function certificat({ titre, sous_titre, date, blocs }) {
  const doc = newDoc(titre || "Certificat médical");
  let y = header(doc);
  const d = date || todayFR();
  y += 8 * mm;
  doc.font("Times-Roman").fontSize(12).text(`${DOCTOR.city}, le ${d}`, LEFT, y, { width: TEXT_WIDTH, align: "right" });
  y = title(doc, y, (titre || "CERTIFICAT MÉDICAL").toUpperCase());
  if (sous_titre) { y += 7 * mm; doc.font("Times-Italic").fontSize(11).text(sous_titre, LEFT, y, { width: TEXT_WIDTH, align: "center" }); }
  y += 14 * mm;
  for (const b of blocs || []) {
    const type = b.type || "paragraph";
    if (type === "spacing") { y += 4 * mm; continue; }
    if (type === "heading") { y += 3 * mm; y = paragraph(doc, y, b.text, { font: "Times-Bold", align: "left" }) + 2 * mm; continue; }
    if (type === "bullet") { y = paragraph(doc, y, `– ${b.text}`, { x: LEFT + 6 * mm, width: TEXT_WIDTH - 6 * mm }) + 1.5 * mm; continue; }
    y = paragraph(doc, y, b.text) + 4 * mm;
  }
  y += 4 * mm;
  y = paragraph(doc, y, `Fait à ${DOCTOR.city}, le ${d}, pour servir et valoir ce que de droit.`, { align: "left" });
  signature(doc, y, 0);
  return finish(doc, `certificat_${stamp(d)}.pdf`, { kind: "certificat" });
}

// ----- Courrier libre -----
export async function courrier({ destinataire, objet, date, corps, formule }) {
  const doc = newDoc(objet || "Courrier");
  let y = header(doc);
  const d = date || todayFR();
  y += 10 * mm;
  doc.font("Times-Roman").fontSize(12).text(`${DOCTOR.city}, le ${d}`, LEFT, y, { width: TEXT_WIDTH, align: "right" }); y += 10 * mm;
  if (destinataire) { y = paragraph(doc, y, destinataire, { align: "left" }) + 8 * mm; }
  if (objet) { y = paragraph(doc, y, `Objet : ${objet}`, { font: "Times-Bold", align: "left" }) + 8 * mm; }
  for (const p of String(corps).split(/\n\s*\n/)) y = paragraph(doc, y, p.trim()) + 5 * mm;
  if (formule !== "") y = paragraph(doc, y, formule || "Je vous prie d'agréer l'expression de mes salutations distinguées.") + 2 * mm;
  signature(doc, y, 0);
  return finish(doc, `courrier_${stamp(d)}.pdf`, { kind: "courrier" });
}

export const generators = { ordonnance, facture, conclusions, certificat, courrier };
