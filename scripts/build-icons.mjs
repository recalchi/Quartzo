// Gera todos os ícones (PWA, Electron, Android) a partir de assets/logo.svg
import sharp from 'sharp';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const svg = await readFile(path.join(root, 'assets/logo.svg'));
const BG = '#1b1428';

async function icon(size, out, { pad = 0.12, bg = null, round = false } = {}) {
  const inner = Math.round(size * (1 - pad * 2));
  const logo = await sharp(svg, { density: 512 }).resize(inner, inner).png().toBuffer();
  let base = sharp({ create: { width: size, height: size, channels: 4, background: bg ?? { r: 0, g: 0, b: 0, alpha: 0 } } });
  const layers = [];
  if (bg && round) {
    const r = Math.round(size * 0.22);
    layers.push({ input: Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="${bg}"/></svg>`) });
    base = sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  }
  layers.push({ input: logo, gravity: 'center' });
  await mkdir(path.dirname(out), { recursive: true });
  await base.composite(layers).png().toFile(out);
}

const pub = path.join(root, 'public');
await copyFile(path.join(root, 'assets/logo.svg'), path.join(pub, 'favicon.svg')).catch(async () => {
  await mkdir(pub, { recursive: true });
  await copyFile(path.join(root, 'assets/logo.svg'), path.join(pub, 'favicon.svg'));
});
await icon(192, path.join(pub, 'icons/icon-192.png'), { bg: BG, round: true });
await icon(512, path.join(pub, 'icons/icon-512.png'), { bg: BG, round: true });
await icon(512, path.join(pub, 'icons/icon-512-maskable.png'), { bg: BG, pad: 0.22 });
await icon(180, path.join(pub, 'icons/apple-touch-icon.png'), { bg: BG, pad: 0.14 });
await icon(1024, path.join(root, 'assets/logo-1024.png'), { bg: BG, round: true });
await icon(512, path.join(root, 'build/icon.png'), { bg: BG, round: true });

// ICO (PNG embutido, 256px) para o Electron/Windows
const png256 = await sharp(path.join(root, 'build/icon.png')).resize(256, 256).png().toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header.writeUInt8(0, 6); header.writeUInt8(0, 7); header.writeUInt8(0, 8); header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
header.writeUInt32LE(png256.length, 14); header.writeUInt32LE(22, 18);
await writeFile(path.join(root, 'build/icon.ico'), Buffer.concat([header, png256]));

// Android (mipmaps) — só se o projeto nativo já existir
const res = path.join(root, 'android/app/src/main/res');
if (existsSync(res)) {
  const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [d, s] of Object.entries(sizes)) {
    await icon(s, path.join(res, `mipmap-${d}/ic_launcher.png`), { bg: BG, pad: 0.1 });
    await icon(s, path.join(res, `mipmap-${d}/ic_launcher_round.png`), { bg: BG, pad: 0.16 });
    // foreground do ícone adaptativo (108dp, zona segura 66dp)
    await icon(Math.round(s * 2.25), path.join(res, `mipmap-${d}/ic_launcher_foreground.png`), { pad: 0.26 });
  }
  const bgXml = path.join(res, 'values/ic_launcher_background.xml');
  await writeFile(bgXml, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`);
  // splash
  for (const dir of ['drawable', 'drawable-port-xxhdpi', 'drawable-land-xxhdpi']) {
    const f = path.join(res, dir, 'splash.png');
    if (existsSync(path.dirname(f))) {
      await sharp({ create: { width: 1080, height: 1920, channels: 4, background: '#141019' } })
        .composite([{ input: await sharp(svg, { density: 512 }).resize(360, 360).png().toBuffer(), gravity: 'center' }])
        .png().toFile(f);
    }
  }
}
console.log('Ícones gerados.');
