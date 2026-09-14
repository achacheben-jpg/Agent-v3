// Génère les icônes PNG de l'application sans dépendance externe
// (fond dégradé indigo avec une étoile stylisée).
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
// Étoile à 4 branches : |x|^0.5 + |y|^0.5 <= r^0.5 (forme d'astroïde).
function pixel(size, rounded) {
  const c = size / 2, R = size * 0.30;
  return (x, y) => {
    const dx = x - c + 0.5, dy = y - c + 0.5;
    // Coins arrondis (pour l'icône iOS) sinon carré plein (maskable).
    if (rounded) {
      const rad = size * 0.22, ax = Math.abs(dx) - (c - rad), ay = Math.abs(dy) - (c - rad);
      if (ax > 0 && ay > 0 && ax * ax + ay * ay > rad * rad) return [0, 0, 0, 0];
    }
    const t = (x + y) / (2 * size);
    const bg = [Math.round(79 + (30 - 79) * t), Math.round(70 + (27 - 70) * t), Math.round(229 + (75 - 229) * t)];
    const inStar = Math.sqrt(Math.abs(dx)) + Math.sqrt(Math.abs(dy)) <= Math.sqrt(R);
    return inStar ? [255, 255, 255, 255] : [...bg, 255];
  };
}
const dir = path.resolve("public/icons");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "icon-192.png"), png(192, pixel(192, false)));
fs.writeFileSync(path.join(dir, "icon-512.png"), png(512, pixel(512, false)));
fs.writeFileSync(path.join(dir, "apple-touch-icon.png"), png(180, pixel(180, false)));
console.log("Icônes générées dans public/icons/");
