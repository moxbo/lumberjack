/*
  Erzeugt images/icon.ico aus einer hochauflösenden PNG als Multi-Size-ICO
  (Größen: 256,128,64,48,32,16) mit sharp + png-to-ico.
  Zusätzlich (unter macOS) wird images/icon.icns erzeugt, indem eine .iconset
  aus mehreren PNG-Größen gebaut und mit `iconutil` konvertiert wird.
*/
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import cp from 'child_process';
import { fileURLToPath } from 'url';
import pngToIcoModule from 'png-to-ico';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let pngToIco = pngToIcoModule;
if (pngToIco && typeof pngToIco !== 'function' && typeof (pngToIco as any).default === 'function') {
  pngToIco = (pngToIco as any).default;
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

    // ========== ICO (Windows) ==========
    const sizesIco = [256, 128, 64, 48, 32, 16];
    const tmpDir = path.join(imagesDir, '.tmp-icons');
    fs.mkdirSync(tmpDir, { recursive: true });

    const tmpPngs: string[] = [];

    const src = fs.readFileSync(srcPng);
    for (const s of sizesIco) {
      const out = path.join(tmpDir, `icon-${s}.png`);
      await sharp(src)
        .resize({ width: s, height: s, kernel: sharp.kernel.cubic })
        .png()
        .toFile(out);
      tmpPngs.push(out);
    }

    const outIco = path.join(imagesDir, 'icon.ico');
    try {
      const buf = await (pngToIco as any)(tmpPngs);
      fs.writeFileSync(outIco, buf);
      console.log('ICO erzeugt:', outIco, `(${buf.length} bytes)`);
    } catch (e: any) {
      console.error('Fehler beim Erzeugen der ICO:', e?.message || e);
    }

    // Aufräumen tmp PNGs
    for (const f of tmpPngs) {
      try {
        fs.unlinkSync(f);
      } catch {}
    }
    try {
      fs.rmdirSync(tmpDir);
    } catch {}

    // ========== ICNS (macOS) ==========
    if (process.platform === 'darwin') {
      const iconsetDir = path.join(imagesDir, 'icon.iconset');
      // ggf. alten Ordner entfernen
      try {
        if (fs.existsSync(iconsetDir)) {
          fs.rmSync(iconsetDir, { recursive: true, force: true });
        }
      } catch {}
      fs.mkdirSync(iconsetDir, { recursive: true });

      // Von Apple empfohlene Größen; @2x sind die doppelt so großen Varianten
      const sizesIcns = [
        { name: 'icon_16x16.png', w: 16, h: 16 },
        { name: 'icon_16x16@2x.png', w: 32, h: 32 },
        { name: 'icon_32x32.png', w: 32, h: 32 },
        { name: 'icon_32x32@2x.png', w: 64, h: 64 },
        { name: 'icon_128x128.png', w: 128, h: 128 },
        { name: 'icon_128x128@2x.png', w: 256, h: 256 },
        { name: 'icon_256x256.png', w: 256, h: 256 },
        { name: 'icon_256x256@2x.png', w: 512, h: 512 },
        { name: 'icon_512x512.png', w: 512, h: 512 },
        { name: 'icon_512x512@2x.png', w: 1024, h: 1024 },
      ];

      for (const { name, w, h } of sizesIcns) {
        const out = path.join(iconsetDir, name);
        await sharp(src)
          .resize({ width: w, height: h, kernel: sharp.kernel.cubic })
          .png()
          .toFile(out);
      }

      const outIcns = path.join(imagesDir, 'icon.icns');
      try {
        await new Promise<void>((resolve, reject) => {
          const child = cp.spawn('iconutil', ['-c', 'icns', iconsetDir, '-o', outIcns]);
          let err = '';
          child.stderr.on('data', (d) => (err += d.toString()));
          child.on('error', reject);
          child.on('close', (code) => {
            if (code === 0 && fs.existsSync(outIcns)) resolve();
            else reject(new Error(err || `iconutil exit code ${code}`));
          });
        });
        console.log('ICNS erzeugt:', outIcns);
      } catch (e: any) {
        console.error(
          'Fehler beim Erzeugen der ICNS (ist Xcode Command Line Tools installiert?):',
          e?.message || e
        );
      } finally {
        // iconset entfernen
        try {
          fs.rmSync(iconsetDir, { recursive: true, force: true });
        } catch {}
      }
    } else {
      console.log('Nicht auf macOS – ICNS-Erzeugung wird übersprungen.');
    }
  } catch (err) {
    console.error('Fehler beim Erzeugen der Icons:', err);
    process.exit(1);
  }
})();
