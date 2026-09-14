// Au premier démarrage, pré-remplit la mémoire de l'assistant et le répertoire
// des experts avec ce que l'on sait déjà de Ben, pour qu'il soit utile dès la
// première conversation. Ne touche à rien si des données existent déjà.
import { store, newId } from "./store.js";

const MEMORY = [
  "Ben = Dr Benjamin Achache, médecin conseil en réparation du dommage corporel, assistance aux victimes, cabinet 376 avenue du Prado 13008 Marseille (Résidence le Ribera, bâtiment E).",
  "Secrétariat : Delphine, secretariatdrachache@gmail.com, 06 89 51 59 03. Téléphone pro de Ben : 06 20 94 20 70.",
  "Associé : Dr Alliot (vérifier s'il a déjà répondu sur un dossier avant de solliciter Ben ; il ne convoque que le mardi).",
  "Avocat de repli : Me Senocak (senocakevrimavocat@gmail.com). Avocats tutoyés : Me Géraldine Adrai-Lachkar, Me Doukhan, Me Corinne Amar.",
  "Garde alternée : semaine du lundi 29 juin 2026 = AVEC enfants, puis une semaine sur deux. Pas de créneau tardif ni de vendredi après-midi les semaines avec enfants.",
  "Horaires de consultation : lundi-vendredi 9h-13h et 14h-18h30. Consultation simple 20 min, moyenne 30 min, longue 45 min.",
  "Tarif habituel d'une assistance à expertise : 600 € HT (TVA 20 %), note d'honoraires « Facture acquittée ».",
  "Dossiers gérés sur app.indemnisation.com (compte achacheben@gmail.com). Les rendez-vous viennent de Doctolib et sont recopiés dans Google Agenda.",
  "Ben a arrêté son activité d'échographie en 2026 (résiliation MonEcho).",
  "Le Dr Distanti expertise le mardi à l'hôpital Européen (Marseille), pas à son cabinet.",
];

const EXPERTS = [
  { name: "Distanti", address: "Hôpital Européen, 6 rue Désirée Clary, 13003 Marseille (le mardi)", travelMinutes: 20, notes: "Expertise le mardi à l'hôpital Européen" },
  { name: "Alliot", address: "376 avenue du Prado, 13008 Marseille", travelMinutes: 0, notes: "Associé, même cabinet ; ne convoque que le mardi" },
];

export function seedIfEmpty() {
  const db = store.data;
  let changed = false;
  if (!db.memory.length) {
    for (const fact of MEMORY) db.memory.push({ id: newId(), fact, createdAt: new Date().toISOString() });
    changed = true;
  }
  if (!db.experts.length) {
    for (const e of EXPERTS) db.experts.push({ id: newId(), ...e });
    changed = true;
  }
  if (changed) store.save();
}
