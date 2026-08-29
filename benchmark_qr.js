const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { Jimp } = require('jimp');
const jsQR = require('jsqr');
const { readBarcodesFromImageData } = require('zxing-wasm');
const qrGen = require('./qr_gen');

async function decodeZbarimg(tempFilePath) {
    const start = process.hrtime.bigint();
    try {
        const { stdout } = await execPromise(`zbarimg "${tempFilePath}"`);
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1e6;
        if (stdout && stdout.trim()) {
            const lines = stdout.trim().split('\n');
            const data = lines.map(line => {
                const idx = line.indexOf(':');
                return idx > 0 ? line.substring(idx + 1) : line;
            }).join(', ');
            return { success: true, durationMs, data };
        }
        return { success: false, durationMs, error: 'No code detected' };
    } catch (err) {
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1e6;
        return { success: false, durationMs, error: err.message || 'zbarimg CLI not found or failed' };
    }
}

async function decodeZXingWasm(imageData) {
    const start = process.hrtime.bigint();
    try {
        const results = await readBarcodesFromImageData(imageData, { formats: ['QRCode'] });
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1e6;
        if (results && results.length > 0) {
            return { success: true, durationMs, data: results.map(r => r.text).join(', ') };
        }
        return { success: false, durationMs, error: 'No code detected' };
    } catch (err) {
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1e6;
        return { success: false, durationMs, error: err.message };
    }
}

async function decodeJsQR(imageData) {
    const start = process.hrtime.bigint();
    try {
        const result = jsQR(imageData.data, imageData.width, imageData.height);
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1e6;
        if (result && result.data) {
            return { success: true, durationMs, data: result.data };
        }
        return { success: false, durationMs, error: 'No code detected' };
    } catch (err) {
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1e6;
        return { success: false, durationMs, error: err.message };
    }
}

async function runBenchmark() {
    console.log("=========================================");
    console.log("  QR Code Reader Engine Benchmark");
    console.log("=========================================\n");

    // Generate a sample QR code image
    console.log("Generating sample PromptPay QR code...");
    const qrFilename = await qrGen.generateQrCode(150, '0850705894');
    const qrPath = path.join(__dirname, 'qr', qrFilename);
    const imageBuffer = fs.readFileSync(qrPath);
    console.log(`Sample QR image generated at: ${qrPath} (${imageBuffer.length} bytes)\n`);

    // Prepare temp file for zbarimg
    const tempFilePath = path.join(__dirname, 'qr', `temp_bench_${Date.now()}.png`);
    fs.writeFileSync(tempFilePath, imageBuffer);

    // Prepare imageData using Jimp for in-memory decoders
    console.log("Loading image with Jimp for in-memory decoders...");
    const jimpStart = process.hrtime.bigint();
    const image = await Jimp.read(imageBuffer);
    const imageData = {
        data: new Uint8ClampedArray(image.bitmap.data),
        width: image.bitmap.width,
        height: image.bitmap.height
    };
    const jimpDuration = Number(process.hrtime.bigint() - jimpStart) / 1e6;
    console.log(`Jimp image parsing time: ${jimpDuration.toFixed(2)} ms (Resolution: ${imageData.width}x${imageData.height})\n`);

    // Warm-up WASM module
    console.log("Warming up zxing-wasm module...");
    await decodeZXingWasm(imageData);

    const ITERATIONS = 10;
    console.log(`Running benchmark over ${ITERATIONS} iterations...\n`);

    // 1. zbarimg CLI
    console.log("--- Engine 1: zbarimg (CLI) ---");
    let zbarTotal = 0;
    let zbarSuccesses = 0;
    let zbarResult = null;
    for (let i = 0; i < ITERATIONS; i++) {
        zbarResult = await decodeZbarimg(tempFilePath);
        zbarTotal += zbarResult.durationMs;
        if (zbarResult.success) zbarSuccesses++;
    }
    console.log(`Status: ${zbarSuccesses}/${ITERATIONS} succeeded`);
    console.log(`Avg Duration: ${(zbarTotal / ITERATIONS).toFixed(2)} ms`);
    if (zbarResult && zbarResult.data) console.log(`Decoded Payload: ${zbarResult.data}`);
    else if (zbarResult) console.log(`Note: ${zbarResult.error}`);
    console.log();

    // 2. zxing-wasm (WASM)
    console.log("--- Engine 2: zxing-wasm (WebAssembly) ---");
    let zxingTotal = 0;
    let zxingSuccesses = 0;
    let zxingResult = null;
    for (let i = 0; i < ITERATIONS; i++) {
        zxingResult = await decodeZXingWasm(imageData);
        zxingTotal += zxingResult.durationMs;
        if (zxingResult.success) zxingSuccesses++;
    }
    console.log(`Status: ${zxingSuccesses}/${ITERATIONS} succeeded`);
    console.log(`Avg Decode Duration (excl Jimp): ${(zxingTotal / ITERATIONS).toFixed(2)} ms`);
    console.log(`Avg Total Duration (incl Jimp): ${((zxingTotal / ITERATIONS) + jimpDuration).toFixed(2)} ms`);
    if (zxingResult && zxingResult.data) console.log(`Decoded Payload: ${zxingResult.data}`);
    console.log();

    // 3. jsQR (Pure JS)
    console.log("--- Engine 3: jsQR (Pure JS) ---");
    let jsQrTotal = 0;
    let jsQrSuccesses = 0;
    let jsQrResult = null;
    for (let i = 0; i < ITERATIONS; i++) {
        jsQrResult = await decodeJsQR(imageData);
        jsQrTotal += jsQrResult.durationMs;
        if (jsQrResult.success) jsQrSuccesses++;
    }
    console.log(`Status: ${jsQrSuccesses}/${ITERATIONS} succeeded`);
    console.log(`Avg Decode Duration (excl Jimp): ${(jsQrTotal / ITERATIONS).toFixed(2)} ms`);
    console.log(`Avg Total Duration (incl Jimp): ${((jsQrTotal / ITERATIONS) + jimpDuration).toFixed(2)} ms`);
    if (jsQrResult && jsQrResult.data) console.log(`Decoded Payload: ${jsQrResult.data}`);
    console.log();

    // Clean up temp file
    try { fs.unlinkSync(tempFilePath); } catch (e) {}

    console.log("=========================================");
    console.log("  Benchmark Completed Successfully!");
    console.log("=========================================");
}

runBenchmark().catch(err => console.error("Benchmark error:", err));
