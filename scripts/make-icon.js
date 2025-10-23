/*
  Erzeugt images/icon.ico aus einer hochauflösenden PNG als Multi-Size-ICO
  (Größen: 256,128,64,48,32,16) mit sharp + png-to-ico.
*/
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
let pngToIco = require('png-to-ico');
if (pngToIco && typeof pngToIco !== 'function' && typeof pngToIco.default === 'function') {
  pngToIco = pngToIco.default;
}

(async () => {
  try {
    const baseDir = path.join(__dirname, '..');
    const imagesDir = path.join(baseDir, 'images');

    const srcPng = path.join(imagesDir, 'lumberjack_v4_dark_1024.png');
    if (!fs.existsSync(srcPng)) {
      console.error('PNG-Quelle fehlt:', srcPng);
      process.exit(1);
    }

    const sizes = [256, 128, 64, 48, 32, 16];
    const tmpDir = path.join(imagesDir, '.tmp-icons');
    fs.mkdirSync(tmpDir, { recursive: true });

    const tmpPngs = [];

    const src = fs.readFileSync(srcPng);
    for (const s of sizes) {
      const out = path.join(tmpDir, `icon-${s}.png`);
      await sharp(src)
        .resize({ width: s, height: s, kernel: sharp.kernel.cubic })
        .png()
        .toFile(out);
      tmpPngs.push(out);
    }

    const outIco = path.join(imagesDir, 'icon.ico');
    const buf = await pngToIco(tmpPngs);
    fs.writeFileSync(outIco, buf);
    console.log('ICO erzeugt:', outIco, `(${buf.length} bytes)`);

    // Aufräumen
    for (const f of tmpPngs) {
      try {
        fs.unlinkSync(f);
      } catch {}
    }
    try {
      fs.rmdirSync(tmpDir);
    } catch {}
  } catch (err) {
    console.error('Fehler beim Erzeugen der ICO:', err);
    process.exit(1);
  }
})();
