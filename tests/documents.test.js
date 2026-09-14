import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agent-docs-"));
const docs = await import("../src/documents.js");

function isPdf(p) { return fs.readFileSync(p).subarray(0, 5).toString() === "%PDF-"; }

test("ordonnance", async () => {
  const f = await docs.ordonnance({ nom: "Dupont", prenom: "Marie", date: "15/09/2026", prescription: ["Amoxicilline 1 g matin midi soir 7 jours", "", "Doliprane 1000 si douleur"] });
  assert.match(f.filename, /^ordonnance_DUPONT_15092026\.pdf$/);
  assert.ok(isPdf(f.path));
  assert.match(f.url, /^\/api\/files\//);
});

test("note d'honoraires : TVA et TTC", async () => {
  const f = await docs.facture({ patient: "GIOMMETTI", date: "06/05/2026", lignes: [], montant_ht: 600, taux_tva: 20 });
  assert.equal(f.tva, 120); assert.equal(f.ttc, 720);
  assert.ok(isPdf(f.path));
});

test("conclusions : seuls les postes renseignés", async () => {
  const f = await docs.conclusions({ nom: "AZEVEDO", prenom: "Paula", expert: "Dr LANDRIEAU", date_evenement: "01/08/2025", consolide: true,
    prejudices: { gtp2: "du 01/08/2025 au 07/08/2025", gtp1: "du 08/08/2025 au 20/01/2026", souffrances_endurees: "2/7", date_consolidation: "20/01/2026", aipp: "2" } });
  assert.equal(f.retained.length, 5);
  assert.ok(f.retained.some((r) => r.endsWith("2 %")));
  assert.ok(isPdf(f.path));
});

test("certificat et courrier", async () => {
  const c = await docs.certificat({ titre: "Certificat médical initial", sous_titre: "en vue d'une procédure", blocs: [
    { type: "paragraph", text: "Je soussigné, Dr Benjamin ACHACHE, certifie avoir examiné M. X." }, { type: "heading", text: "Les faits :" }, { type: "bullet", text: "Premier élément" } ] });
  assert.ok(isPdf(c.path));
  const l = await docs.courrier({ objet: "Test", corps: "Bonjour,\n\nCeci est un test." });
  assert.ok(isPdf(l.path));
});
