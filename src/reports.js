// Rapports Word (.docx) : évaluation médico-légale Dintilhac, liquidation chiffrée,
// discussion, rapport de conseil. Mise en page reprise des skills de Ben.
import fs from "node:fs";
import path from "node:path";
import { Document, Packer, Paragraph, TextRun, Header, Footer, AlignmentType, PageNumber, Table, TableRow, TableCell, WidthType, BorderStyle } from "docx";
import { DOCTOR } from "./profile.js";
import { newId } from "./store.js";
import { filesDir } from "./documents.js";

const STYLES = {
  // Évaluation / discussion : Times 12 justifié, aucun gras, en-tête centré.
  evaluation: { font: "Times New Roman", size: 24, titleSize: 28, sectionSize: 26, bold: false, header: "Dr Benjamin Achache — Médecin spécialiste en réparation juridique du dommage corporel" },
  // Liquidation « Quantum » : Arial 11, titres en gras, en-tête DESU.
  quantum: { font: "Arial", size: 22, titleSize: 28, sectionSize: 24, bold: true, header: "Dr Achache Benjamin — DESU réparation juridique du dommage corporel" },
  // Rapport de conseil : en-tête complet à gauche (comme l'ordonnance), Times 12.
  conseil: { font: "Times New Roman", size: 24, titleSize: 28, sectionSize: 26, bold: true, header: null },
};

function run(text, st, opts = {}) { return new TextRun({ text, font: st.font, size: opts.size || st.size, bold: Boolean(opts.bold), italics: Boolean(opts.italics) }); }
function para(text, st, opts = {}) {
  return new Paragraph({ spacing: { before: opts.before ?? 120, after: opts.after ?? 120, line: 320 }, alignment: opts.align || AlignmentType.JUSTIFIED, children: [run(text, st, opts)] });
}

function leftHeader(st) {
  const lines = [[DOCTOR.name, { bold: true, size: 26 }], ...DOCTOR.qualifications.map((q) => [q, { size: 20 }]), ...DOCTOR.address.map((a) => [a, { size: 20 }]), ...DOCTOR.contact.map((c) => [c, { size: 20 }]), [`N° AM : ${DOCTOR.am}`, { size: 20 }], [`RPPS : ${DOCTOR.rpps}`, { size: 20 }]];
  return lines.map(([t, o]) => new Paragraph({ spacing: { before: 0, after: 0 }, alignment: AlignmentType.LEFT, children: [run(t, st, o)] }));
}

function synthesisTable(rows, st) {
  const border = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (t, bold = false, align = AlignmentType.LEFT) => new TableCell({ borders, width: { size: 25, type: WidthType.PERCENTAGE }, children: [new Paragraph({ alignment: align, spacing: { before: 60, after: 60 }, children: [run(t, st, { bold, size: 20 })] })] });
  const head = new TableRow({ children: ["Poste", "Victime", "Tiers payeurs", "Total"].map((h) => cell(h, true)) });
  const body = rows.map((r) => new TableRow({ children: [cell(r.poste), cell(r.victime || "", false, AlignmentType.RIGHT), cell(r.tiers || "", false, AlignmentType.RIGHT), cell(r.total || "", true, AlignmentType.RIGHT)] }));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [head, ...body] });
}

/**
 * @param {object} p
 * @param {"evaluation"|"quantum"|"conseil"} p.style
 * @param {string} p.titre
 * @param {string} [p.sous_titre]
 * @param {string[]} [p.entete_lignes]  lignes d'identité sous le titre (date de naissance, accident…)
 * @param {Array<{titre:string, paragraphes:string[]}>} p.sections
 * @param {Array<{poste:string, victime:string, tiers:string, total:string}>} [p.tableau]
 * @param {string} [p.nom_fichier]
 */
export async function rapportDocx({ style = "evaluation", titre, sous_titre = "", entete_lignes = [], sections = [], tableau = [], nom_fichier = "" }) {
  const st = STYLES[style] || STYLES.evaluation;
  const children = [];
  if (style === "conseil") { children.push(...leftHeader(st)); children.push(para("", st)); }
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240, after: sous_titre ? 120 : 360 }, children: [run(titre, st, { size: st.titleSize, bold: st.bold })] }));
  if (sous_titre) children.push(para(sous_titre, st, { align: AlignmentType.CENTER, after: 360 }));
  for (const l of entete_lignes) children.push(para(l, st, { before: 40, after: 40 }));
  if (entete_lignes.length) children.push(para("", st));
  sections.forEach((s, i) => {
    const t = st.bold && style === "quantum" && !/^\s*[IVX\d]+[\.\s—-]/.test(s.titre) ? `${i + 1}. ${s.titre}` : s.titre;
    children.push(new Paragraph({ spacing: { before: 360, after: 200, line: 320 }, alignment: AlignmentType.LEFT, children: [run(t, st, { size: st.sectionSize, bold: st.bold })] }));
    for (const p of s.paragraphes || []) {
      const closing = st.bold && style === "quantum" && /^(Il sera|Il convient|Il est|Ce poste|Au total|Soit)/i.test(p.trim());
      children.push(para(p, st, { bold: closing }));
    }
  });
  if (tableau.length) {
    children.push(new Paragraph({ spacing: { before: 360, after: 200 }, children: [run("Synthèse", st, { size: st.sectionSize, bold: st.bold })] }));
    children.push(synthesisTable(tableau, st));
  }

  const header = st.header ? new Header({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(st.header, st, { size: 20 })] })] }) : undefined;
  const footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run("Page ", st, { size: 20 }), new TextRun({ children: [PageNumber.CURRENT], font: st.font, size: 20 }), run(" / ", st, { size: 20 }), new TextRun({ children: [PageNumber.TOTAL_PAGES], font: st.font, size: 20 })] })] });
  const doc = new Document({
    creator: DOCTOR.name, title: titre,
    styles: { default: { document: { run: { font: st.font, size: st.size } } } },
    sections: [{ properties: { page: { margin: { top: 1417, bottom: 1417, left: 1417, right: 1417 } } }, headers: header ? { default: header } : undefined, footers: { default: footer }, children }],
  });
  const buf = await Packer.toBuffer(doc);
  const id = newId();
  const safe = (nom_fichier || `${titre}.docx`).replace(/\.docx$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "_") + ".docx";
  const filePath = path.join(filesDir(), `${id}_${safe}`);
  fs.writeFileSync(filePath, buf);
  return { id, filename: safe, path: filePath, url: `/api/files/${id}_${safe}`, kind: "rapport" };
}
