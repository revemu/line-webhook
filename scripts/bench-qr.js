#!/usr/bin/env node
/**
 * QR Scanner Benchmark for Slip Verification
 * Compares zbarimg (via /dev/shm on Linux) against in-memory zxing-wasm (Direct Blob vs Jimp) and jsQR.
 *
 * Usage:
 *   node scripts/bench-qr.js                        # Auto-picks up to 5 latest slips from img/slip (or fallback test image)
 *   node scripts/bench-qr.js path/to/slip1.jpg ...  # Benchmark specific image file(s)
 *   node scripts/bench-qr.js --runs=5 --limit=10    # Customize iterations per engine and slip sample size
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const util = require('util');
const { exec, execFile } = require('child_process');
const { performance } = require('perf_hooks');
const { Jimp } = require('jimp');
const jsQR = require('jsqr');
const { readBarcodesFromImageFile, readBarcodesFromImageData, setZXingModuleOverrides } = require('zxing-wasm');
const { resolveEphemeralTempDir } = require('../utils/ramImageCache');

const execPromise = util.promisify(exec);
const execFilePromise = util.promisify(execFile);

const ROOT_DIR = path.resolve(__dirname, '..');

function parseCliArgs(argv) {
  let runs = 3;
  let limit = 5;
  const files = [];

  for (const arg of argv) {
    if (arg.startsWith('--runs=')) {
      const n = parseInt(arg.split('=')[1], 10);
      if (n > 0) runs = Math.min(n, 50);
    } else if (arg.startsWith('--limit=')) {
      const n = parseInt(arg.split('=')[1], 10);
      if (n > 0) limit = Math.min(n, 50);
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/bench-qr.js [--runs=3] [--limit=5] [file1.jpg ...]');
      process.exit(0);
    } else if (!arg.startsWith('--')) {
      files.push(path.resolve(arg));
    }
  }

  return { runs, limit, files };
}

function initZxingWasm() {
  const fullWasm = path.join(ROOT_DIR, 'node_modules', 'zxing-wasm', 'dist', 'full', 'zxing_full.wasm');
  const readerWasm = path.join(ROOT_DIR, 'node_modules', 'zxing-wasm', 'dist', 'reader', 'zxing_reader.wasm');
  const target = fs.existsSync(fullWasm) ? fullWasm : (fs.existsSync(readerWasm) ? readerWasm : null);
  if (!target) {
    throw new Error('Could not find zxing-wasm .wasm binary in node_modules');
  }
  setZXingModuleOverrides({ wasmBinary: fs.readFileSync(target) });
  return path.basename(target);
}

async function checkZbarimgAvailable() {
  try {
    await execFilePromise('zbarimg', ['--version']);
    return true;
  } catch {
    return false;
  }
}

function parseZbarStdout(stdout) {
  if (!stdout || !stdout.trim()) return null;
  const lines = stdout.trim().split('\n');
  for (const line of lines) {
    const idx = line.indexOf(':');
    const data = (idx > 0 ? line.substring(idx + 1) : line).trim();
    if (data) return data;
  }
  return null;
}

function detectMimeType(fileName, buffer) {
  if (buffer && buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (fileName && fileName.toLowerCase().endsWith('.png')) return 'image/png';
  return 'image/jpeg';
}

async function resolveSampleTargets(explicitFiles, limit) {
  if (explicitFiles.length > 0) {
    return explicitFiles.map(fp => ({
      label: path.basename(fp),
      buffer: fs.readFileSync(fp),
      mimeType: detectMimeType(fp, null),
      source: fp
    }));
  }

  const slipDir = path.join(ROOT_DIR, 'img', 'slip');
  if (fs.existsSync(slipDir)) {
    const entries = fs.readdirSync(slipDir)
      .filter(f => /\.(jpe?g|png)$/i.test(f))
      .map(f => {
        const fullPath = path.join(slipDir, f);
        return { name: f, fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, limit);

    if (entries.length > 0) {
      return entries.map(e => {
        const buf = fs.readFileSync(e.fullPath);
        return {
          label: e.name,
          buffer: buf,
          mimeType: detectMimeType(e.name, buf),
          source: e.fullPath
        };
      });
    }
  }

  // Fallback synthetic + local QR samples when img/slip has no slips
  const imgDir = path.join(ROOT_DIR, 'img');
  const qrFiles = fs.existsSync(imgDir)
    ? fs.readdirSync(imgDir).filter(f => /^qr_.*\.png$/i.test(f)).slice(0, 1)
    : [];

  if (qrFiles.length > 0) {
    const smallPath = path.join(imgDir, qrFiles[0]);
    const smallBuf = fs.readFileSync(smallPath);
    const qrImg = await Jimp.read(smallBuf);
    const canvas = new Jimp({ width: 1080, height: 1920, color: 0xffffffff });
    canvas.composite(qrImg, 400, 1300);
    const slipLikeBuf = await canvas.getBuffer('image/jpeg', { quality: 85 });

    return [
      { label: `${qrFiles[0]} (small PNG)`, buffer: smallBuf, mimeType: 'image/png', source: smallPath },
      { label: 'synthetic_slip_1080x1920.jpg', buffer: slipLikeBuf, mimeType: 'image/jpeg', source: 'memory' }
    ];
  }

  throw new Error('No slip files found in img/slip and no fallback QR image in img/. Pass an image path as argument.');
}

async function runBenchmarkCase(fn, runs) {
  const times = [];
  let hits = 0;
  let samplePayload = null;

  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    let payload = null;
    try {
      payload = await fn();
    } catch {
      payload = null;
    }
    const elapsed = performance.now() - t0;
    times.push(elapsed);
    if (payload) {
      hits++;
      if (!samplePayload) samplePayload = payload;
    }
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  return {
    avg,
    min: Math.min(...times),
    max: Math.max(...times),
    hits,
    runs,
    samplePayload
  };
}

function makeEngineRunners({ hasZbarimg, tempDir }) {
  const writeAndClean = async (buf, ext, runner) => {
    await fsp.mkdir(tempDir, { recursive: true });
    const tmpPath = path.join(tempDir, `bench_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`);
    await fsp.writeFile(tmpPath, buf);
    try {
      return await runner(tmpPath);
    } finally {
      try { await fsp.unlink(tmpPath); } catch { }
    }
  };

  const engines = [];

  if (hasZbarimg) {
    engines.push({
      name: 'zbarimg (exec/sh + temp)',
      run: (buf, mime) => writeAndClean(buf, mime === 'image/png' ? 'png' : 'jpg', async (tmp) => {
        const { stdout } = await execPromise(`zbarimg "${tmp}"`);
        return parseZbarStdout(stdout);
      })
    });
    engines.push({
      name: 'zbarimg (execFile + temp)',
      run: (buf, mime) => writeAndClean(buf, mime === 'image/png' ? 'png' : 'jpg', async (tmp) => {
        const { stdout } = await execFilePromise('zbarimg', [tmp]);
        return parseZbarStdout(stdout);
      })
    });
  }

  engines.push({
    name: 'zxing-wasm (Direct Blob)',
    run: async (buf, mime) => {
      const res = await readBarcodesFromImageFile(new Blob([buf], { type: mime }), { formats: ['QRCode'] });
      return (res && res.length > 0) ? res[0].text : null;
    }
  });

  engines.push({
    name: 'zxing-wasm (Jimp + ImageData)',
    run: async (buf) => {
      const j = await Jimp.read(buf);
      const res = await readBarcodesFromImageData(
        { data: new Uint8ClampedArray(j.bitmap.data), width: j.bitmap.width, height: j.bitmap.height },
        { formats: ['QRCode'] }
      );
      return (res && res.length > 0) ? res[0].text : null;
    }
  });

  engines.push({
    name: 'jsQR (Jimp)',
    run: async (buf) => {
      const j = await Jimp.read(buf);
      const code = jsQR(new Uint8ClampedArray(j.bitmap.data), j.bitmap.width, j.bitmap.height);
      return (code && code.data) ? code.data : null;
    }
  });

  return engines;
}

async function main() {
  const { runs, limit, files } = parseCliArgs(process.argv.slice(2));
  const wasmName = initZxingWasm();
  const hasZbarimg = await checkZbarimgAvailable();
  const tempDir = resolveEphemeralTempDir(path.join(ROOT_DIR, 'temp'));
  const samples = await resolveSampleTargets(files, limit);

  console.log('==================================================================');
  console.log('🔍 Slip QR Scanner Benchmark');
  console.log(`Platform : ${process.platform} (${process.arch}) | Node ${process.version}`);
  console.log(`WASM     : ${wasmName}`);
  console.log(`Temp Dir : ${tempDir}${process.platform === 'linux' ? ' (RAM tmpfs if /dev/shm)' : ' (disk)'}`);
  console.log(`zbarimg  : ${hasZbarimg ? 'available' : 'NOT FOUND (skipping zbarimg cases)'}`);
  console.log(`Samples  : ${samples.length} image(s) | Runs/engine: ${runs}`);
  console.log('==================================================================');

  // Warm up WASM once before timed measurements
  const warmT0 = performance.now();
  await readBarcodesFromImageFile(new Blob([samples[0].buffer], { type: samples[0].mimeType }), { formats: ['QRCode'] }).catch(() => { });
  const warmMs = performance.now() - warmT0;
  console.log(`⚡ zxing-wasm cold warmup: ${warmMs.toFixed(2)} ms\n`);

  const engines = makeEngineRunners({ hasZbarimg, tempDir });
  const totals = new Map(engines.map(e => [e.name, { sumAvg: 0, count: 0, hits: 0, runs: 0 }]));

  for (const sample of samples) {
    const sizeKb = (sample.buffer.length / 1024).toFixed(1);
    console.log(`📄 ${sample.label} (${sizeKb} KB)`);
    let referencePayload = null;

    for (const engine of engines) {
      const stats = await runBenchmarkCase(() => engine.run(sample.buffer, sample.mimeType), runs);
      if (!referencePayload && stats.samplePayload) {
        referencePayload = stats.samplePayload;
      }
      const matchNote = stats.samplePayload
        ? (stats.samplePayload === referencePayload ? 'match' : 'DIFF!')
        : 'miss';

      console.log(
        `   ${engine.name.padEnd(31, ' ')} | avg: ${stats.avg.toFixed(2).padStart(7, ' ')} ms ` +
        `(min ${stats.min.toFixed(1)} / max ${stats.max.toFixed(1)}) | ok: ${stats.hits}/${stats.runs} [${matchNote}]`
      );

      const agg = totals.get(engine.name);
      agg.sumAvg += stats.avg;
      agg.count++;
      agg.hits += stats.hits;
      agg.runs += stats.runs;
    }
    console.log('');
  }

  console.log('──────────────────────── OVERALL SUMMARY ─────────────────────────');
  const sorted = [...totals.entries()].sort((a, b) => (a[1].sumAvg / a[1].count) - (b[1].sumAvg / b[1].count));
  for (const [name, agg] of sorted) {
    const overallAvg = agg.sumAvg / agg.count;
    console.log(
      `${name.padEnd(31, ' ')} | avg: ${overallAvg.toFixed(2).padStart(7, ' ')} ms | decode rate: ${agg.hits}/${agg.runs}`
    );
  }
  console.log('──────────────────────────────────────────────────────────────────');
}

main().catch((err) => {
  console.error('❌ Benchmark error:', err.message);
  process.exit(1);
});
