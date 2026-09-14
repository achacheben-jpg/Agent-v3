// Petites fonctions partagées : fuseau horaire, dossier de données, date-heure locale.
import path from "node:path";

export const TZ = () => process.env.TIMEZONE || "Europe/Paris";
export const dataDir = () => process.env.DATA_DIR || path.resolve("data");

/** Date-heure locale de Ben au format « AAAA-MM-JJTHH:MM ». */
export function nowLocal(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ(), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date).replace(" ", "T");
}
