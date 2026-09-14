import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agent-reports-"));
const { rapportDocx } = await import("../src/reports.js");

function isDocx(p) { return fs.readFileSync(p).subarray(0, 2).toString() === "PK"; }

test("évaluation Dintilhac en Word", async () => {
  const f = await rapportDocx({ style: "evaluation", titre: "Évaluation médico-légale des préjudices corporels", sous_titre: "Dossier de Madame Marie DUPONT",
    entete_lignes: ["Date de naissance : 12/03/1965", "Date de l'accident : 15/02/2024"],
    sections: [{ titre: "I. Préjudices avant consolidation", paragraphes: ["GTP 2 : du 15 mars 2024 au 30 avril 2024", "Durant cette période, la victime a porté une attelle."] }] });
  assert.match(f.filename, /\.docx$/); assert.ok(isDocx(f.path)); assert.equal(f.kind, "rapport");
});

test("liquidation avec tableau de synthèse", async () => {
  const f = await rapportDocx({ style: "quantum", titre: "Liquidation des préjudices", sections: [{ titre: "Déficit fonctionnel temporaire", paragraphes: ["Calcul.", "Il sera réclamé la somme de 1 000 €."] }],
    tableau: [{ poste: "DFT", victime: "1 000 €", tiers: "", total: "1 000 €" }], nom_fichier: "Liquidation_DUPONT_Marie" });
  assert.equal(f.filename, "Liquidation_DUPONT_Marie.docx"); assert.ok(isDocx(f.path));
});

test("rapport de conseil avec en-tête à gauche", async () => {
  const f = await rapportDocx({ style: "conseil", titre: "Rapport de conseil — Marie DUPONT", sections: [{ titre: "Discussion", paragraphes: ["Texte."] }] });
  assert.ok(isDocx(f.path));
});
