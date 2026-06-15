/**
 * Generates the raster brand icons (favicon.ico, apple-icon, PWA icons) from the
 * SkillBundle logo. The scalable SVG favicon lives at app/icon.svg and is the
 * source of truth for the artwork; this script produces the raster fallbacks
 * that browsers, iOS, and Android still need.
 *
 * Run with: node scripts/generate-icons.js
 */
const fs = require("fs");
const path = require("path");
// sharp ships as a transitive (pnpm) dependency, so resolve it from the store.
const sharp = require("sharp@0.34.5/node_modules/sharp".replace(
  "sharp@0.34.5",
  require("path").join(
    __dirname,
    "..",
    "node_modules",
    ".pnpm",
    "sharp@0.34.5",
  ),
));

const ROOT = path.join(__dirname, "..");
const TILE_BG = "#0a0b0d";
const MARK = "#fafafa";

// The two-path logo mark in its native 69.7 x 44 viewBox.
const LOGO_PATHS = [
  "m24.5 36-2.7-2.7c-2.8-3.3-3-8.4 0.6-11.5l9.2-9.2c0.9-1 2.2-1.6 3.5-1.6 1.6 0 2.9 0.6 3.9 1.7l0.4 0.4c1.9 2.1 1.9 5.2-0.1 7.2l-5.7 5.8c-1.3 1.1-1.2 3-0.1 4.2s3 2.2 4.7 0.9l8.1-7.8c1.1-1 2.1-3.1 2-5.1 0.1-1.6-0.6-3.4-1.7-4.7-0.6-0.7-9.5-10.1-9.8-10.3-1.8-1.7-4.1-3.1-7.2-3.1-2.7 0-5.2 1-7.4 3l-18.3 18.2c-2 2.1-3.1 4.7-3 7.5 0.1 2.5 1.2 4.9 2.8 6.6l4.5 4.7c1.6 1.7 4 3.3 7 3.3h0.1c2.3 0 4.5-0.8 6.2-2.2l3-3c0.6-0.5 0.6-1.7 0-2.3z",
  "m66.4 8.1-5.1-5.1c-1.7-1.7-4-2.9-7-2.8-2.4 0-4.7 0.9-6.6 2.6l-3 3c-0.7 0.7-0.6 1.7 0 2.3l3.8 3.8c1.6 1.7 2.4 4 2.4 6.1 0 2.5-0.9 4.8-2.7 7l-8.2 8c-1 0.9-2.2 1.5-3.7 1.5s-2.8-0.6-3.9-1.6c-1.1-1.1-1.9-2.6-2.1-4.2v-0.8c0.2-1.2 0.7-2.3 1.5-3.1l5.5-5.9c1.1-1 1.1-2.8 0-3.9-1.1-1.4-3.1-1.7-4.2-0.5l-8.9 9.1c-2 2-2.5 5.5-0.2 8.5l8.9 8.8c2 1.8 4.4 3 7.1 3 2.6 0 5-0.6 7.3-2.7l18.6-18.5c1.8-2.1 3-4.6 3-7.6 0-2.7-1-5.1-2.5-7z",
];

// Logo is ~58% of the tile width, centered — inside the maskable safe zone.
const LOGO_W = 0.58 * 512; // 297
const SCALE = LOGO_W / 69.7; // 4.261
const TX = (512 - LOGO_W) / 2; // 107.5
const TY = (512 - (LOGO_W * 44) / 69.7) / 2; // 162

function tileSvg(rx) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${rx}" fill="${TILE_BG}" />
  <g transform="translate(${TX} ${TY}) scale(${SCALE})" fill="${MARK}">
    ${LOGO_PATHS.map((d) => `<path d="${d}" />`).join("\n    ")}
  </g>
</svg>`;
}

const ROUNDED = Buffer.from(tileSvg(104)); // tab favicon
const SQUARE = Buffer.from(tileSvg(0)); // apple + maskable (OS rounds it)

async function png(svg, size) {
  return sharp(svg).resize(size, size).png().toBuffer();
}

/** Pack a set of PNG buffers into a single .ico (PNG-compressed, Vista+). */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  const dirSize = 6 + images.length * 16;
  let offset = dirSize;
  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(img.size >= 256 ? 0 : img.size, 0); // width (0 = 256)
    entry.writeUInt8(img.size >= 256 ? 0 : img.size, 1); // height
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(img.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += img.data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

async function main() {
  // favicon.ico — 16/32/48 from the rounded tile
  const icoSizes = [16, 32, 48];
  const icoImages = await Promise.all(
    icoSizes.map(async (size) => ({ size, data: await png(ROUNDED, size) })),
  );
  fs.writeFileSync(path.join(ROOT, "app", "favicon.ico"), buildIco(icoImages));
  console.log("wrote app/favicon.ico");

  // apple-icon — 180x180, square (iOS applies its own mask)
  fs.writeFileSync(
    path.join(ROOT, "app", "apple-icon.png"),
    await png(SQUARE, 180),
  );
  console.log("wrote app/apple-icon.png");

  // PWA / Android icons referenced by the web manifest
  const iconsDir = path.join(ROOT, "public", "icons");
  fs.mkdirSync(iconsDir, { recursive: true });
  for (const size of [192, 512]) {
    fs.writeFileSync(
      path.join(iconsDir, `icon-${size}.png`),
      await png(SQUARE, size),
    );
    console.log(`wrote public/icons/icon-${size}.png`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
