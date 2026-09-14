import { test } from "node:test";
import assert from "node:assert/strict";
import { findSlots, isWeekWithChildren, mondayOf, travelForEvent } from "../src/slots.js";

test("alternance des semaines avec / sans enfants", () => {
  assert.equal(mondayOf("2026-07-01"), "2026-06-29");
  assert.equal(isWeekWithChildren("2026-06-29"), true);
  assert.equal(isWeekWithChildren("2026-07-08"), false);
  assert.equal(isWeekWithChildren("2026-07-15"), true);
  assert.equal(isWeekWithChildren("2026-09-15"), false); // semaine du 14 septembre 2026 : 11 semaines après → impaire
});

test("premier créneau après l'heure actuelle, agenda vide", () => {
  const r = findSlots({ duration: 20, nowLocal: "2026-09-15T15:30", events: [] });
  assert.equal(r.slots.length, 3);
  assert.deepEqual(r.slots.map((s) => s.start), ["15:40", "16:00", "16:20"]);
  assert.equal(r.slots[0].date, "2026-09-15");
});

test("tampon d'expertise 1 h + trajet, durée minimale 45 min", () => {
  // Expertise 10h00-10h40 chez un expert à 40 min : zone bloquée 08h20 → 12h25.
  const events = [{ start: "2026-09-16T10:00", end: "2026-09-16T10:40", title: "DUPONT / GUIEN", colorId: "5" }];
  const experts = [{ name: "Guien", travelMinutes: 40 }];
  const r = findSlots({ duration: 20, nowLocal: "2026-09-16T08:00", events, experts, weeks: 1 });
  assert.equal(r.slots[0].date, "2026-09-16");
  assert.equal(r.slots[0].start, "12:40");
  assert.deepEqual(travelForEvent(events[0], experts), { minutes: 40, unknown: [] });
  assert.deepEqual(travelForEvent({ title: "X / INCONNU" }, experts).unknown, ["INCONNU"]);
});

test("vendredi après-midi interdit et créneaux tardifs dépriorisés en semaine avec enfants", () => {
  // Semaine du 14 septembre 2026 = sans enfants ; celle du 21 = avec enfants. On se place le vendredi 25 à 13h.
  const r = findSlots({ duration: 45, nowLocal: "2026-09-25T13:00", events: [], weeks: 2 });
  assert.notEqual(r.slots[0].date, "2026-09-25", "pas de vendredi après-midi en semaine avec enfants");
  // Lundi 28 : journée bloquée jusqu'à 17h → seuls des créneaux tardifs, semaine sans enfants (28/09 = sans) donc priorité haute.
  const busy = [{ start: "2026-09-28T09:00", end: "2026-09-28T17:00", title: "bloc" }];
  const r2 = findSlots({ duration: 45, nowLocal: "2026-09-28T08:00", events: busy, weeks: 1, count: 1 });
  assert.equal(r2.slots[0].start, "17:00");
  assert.equal(r2.slots[0].late, true);
  assert.equal(r2.slots[0].withChildren, false);
});
