// Polyfill Array.prototype.toSorted for Node.js v18 compatibility
if (!Array.prototype.toSorted) {
  Array.prototype.toSorted = function (compareFn) {
    return this.slice().sort(compareFn);
  };
}

const { renderThaiQRPayment } = require('thai-qr-payment');
const svg2img = require('svg2img');
const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');

const qrDir = path.join(__dirname, 'qr');
//LKKaohom.ttf
//Sarabun-Regular.ttf
const fontPath = path.join(__dirname, 'fonts', 'LKKaohom.ttf');
const logoPath = path.join(__dirname, 'assets', 'logo.jpg');
const headerPathJpg = path.join(__dirname, 'assets', 'header.jpg');
const headerPathPng = path.join(__dirname, 'assets', 'header.png');

let customLogoDataUri = '';
try {
  if (fs.existsSync(logoPath)) {
    const logoBuf = fs.readFileSync(logoPath);
    customLogoDataUri = `data:image/jpeg;base64,${logoBuf.toString('base64')}`;
  }
} catch (err) {
  logger.error('[QR-Gen] Failed to load custom center logo:', err.message);
}

let customHeaderDataUri = '';
try {
  if (fs.existsSync(headerPathJpg)) {
    const headerBuf = fs.readFileSync(headerPathJpg);
    customHeaderDataUri = `data:image/jpeg;base64,${headerBuf.toString('base64')}`;
  } else if (fs.existsSync(headerPathPng)) {
    const headerBuf = fs.readFileSync(headerPathPng);
    customHeaderDataUri = `data:image/png;base64,${headerBuf.toString('base64')}`;
  }
} catch (err) {
  logger.error('[QR-Gen] Failed to load custom header:', err.message);
}

const inFlightGenerations = new Map();

/**
 * Checks whether a QR code image for the given amount and PromptPay number already exists in disk cache.
 * @param {number} amount - The transaction amount.
 * @param {string} promptPayNumber - The PromptPay phone number or ID.
 * @returns {boolean} True if cached on disk.
 */
function isQrCodeCached(amount, promptPayNumber = '0850705894') {
  const sanitizedPromptPay = String(promptPayNumber || '0850705894').replace(/[^a-zA-Z0-9_-]/g, '_');
  const numAmount = Number(amount) || 0;
  const sanitizedAmount = String(numAmount).replace(/[^a-zA-Z0-9._-]/g, '_');
  const filename = `qr_${sanitizedPromptPay}_${sanitizedAmount}.png`;
  const filePath = path.join(qrDir, filename);
  if (fs.existsSync(filePath)) {
    try {
      const stats = fs.statSync(filePath);
      return stats.size > 1000;
    } catch (_) {
      return false;
    }
  }
  return false;
}

/**
 * Generates a PromptPay QR code image inside the 'qr' directory and returns its filename.
 * If a QR code for the same amount and PromptPay number already exists on disk, uses the cached image.
 * 
 * @param {number} amount - The transaction amount.
 * @param {string} promptPayNumber - The PromptPay phone number or ID.
 * @param {Object} [options] - Options { noCache: boolean }
 * @returns {Promise<string>} The generated QR code filename.
 */
async function generateQrCode(amount, promptPayNumber = '0850705894', options = {}) {
  // Ensure the qr directory exists
  if (!fs.existsSync(qrDir)) {
    fs.mkdirSync(qrDir, { recursive: true });
  }

  const sanitizedPromptPay = String(promptPayNumber || '0850705894').replace(/[^a-zA-Z0-9_-]/g, '_');
  const numAmount = Number(amount) || 0;
  const sanitizedAmount = String(numAmount).replace(/[^a-zA-Z0-9._-]/g, '_');
  const filename = `qr_${sanitizedPromptPay}_${sanitizedAmount}.png`;
  const filePath = path.join(qrDir, filename);

  // 1. Check disk cache: if QR for this amount and promptPayNumber already exists, return cached image immediately
  if (!options.noCache && fs.existsSync(filePath)) {
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > 1000) {
        logger.info(`[QR-Gen] Used cached QR image for amount ${numAmount} (${promptPayNumber}): ${filename}`);
        return filename;
      }
    } catch (_) {}
  }

  // 2. In-flight request deduplication (prevent concurrent requests for same amount from rendering SVG twice)
  let genPromise = inFlightGenerations.get(filename);
  if (genPromise) {
    return genPromise;
  }

  // 3. Cleanup legacy timestamped QR images (older than 1 hour)
  try {
    const files = fs.readdirSync(qrDir);
    const now = Date.now();
    for (const file of files) {
      if (file.startsWith('qr_') && file.endsWith('.png') && /^qr_\d{10,}_[a-z0-9]+\.png$/i.test(file)) {
        const legacyPath = path.join(qrDir, file);
        const stats = fs.statSync(legacyPath);
        if (now - stats.mtimeMs > 3600 * 1000) {
          fs.unlinkSync(legacyPath);
          logger.info(`[QR-Cleanup] Deleted legacy temp QR image: ${file}`);
        }
      }
    }
  } catch (cleanupErr) {
    logger.error('[QR-Cleanup] Error cleaning up old legacy QR images:', cleanupErr.message);
  }

  genPromise = (async () => {
    try {
      const qrOptions = {
        recipient: promptPayNumber,
        amount: numAmount,
        showCaption: true
      };
      if (numAmount > 0) {
        qrOptions.merchantName = `แสกนจ่ายค่าสนาม: ${numAmount} บาท`;
      } else {
        qrOptions.merchantName = `แสกนจ่ายค่าสนาม`;
      }
      let svgString = renderThaiQRPayment(qrOptions);

      // Remove PromptPay logo element below header
      svgString = svgString.replace(/<use[^>]*#tqp-promptpay[^>]*\/?>/g, '');

      // Replace default header background path & logo with custom header image if available
      if (customHeaderDataUri) {
        // 600px width banner with 83px height matching exact 628:87 aspect ratio of custom header
        svgString = svgString.replace(
          /<path d="M0 110 V20 a20 20 0 0 1 20 -20 H580 a20 20 0 0 1 20 20 V110 Z"[^>]*\/>/g,
          `<image href="${customHeaderDataUri}" xlink:href="${customHeaderDataUri}" x="0" y="0" width="600" height="83" preserveAspectRatio="none" clip-path="url(#tqp-custom-header-clip)"/>`
        );
        const headerClipPathDef = '<clipPath id="tqp-custom-header-clip"><path d="M0 83 V20 a20 20 0 0 1 20 -20 H580 a20 20 0 0 1 20 20 V83 Z"/></clipPath>';
        svgString = svgString.replace('<defs>', '<defs>' + headerClipPathDef);
        svgString = svgString.replace(/<use[^>]*#tqp-header[^>]*\/?>/g, '');

        // Shift content UP by 27px for reduced header height (110 -> 83)
        svgString = svgString.replace('y="250"', 'y="113"');
        svgString = svgString.replace('translate(64 264)', 'translate(64 127)');
        svgString = svgString.replace('y="458.24"', 'y="321.24"');
        svgString = svgString.replace('y="462.24"', 'y="325.24"');
        svgString = svgString.replace('y="788"', 'y="643"');

        // Compact total canvas height (683)
        svgString = svgString.replace('height="800"', 'height="683"');
        svgString = svgString.replace('viewBox="0 0 600 800"', 'viewBox="0 0 600 683"');
      } else {
        // Shift content UP to fill the PromptPay logo position (standard 110px header)
        svgString = svgString.replace('y="250"', 'y="140"');
        svgString = svgString.replace('translate(64 264)', 'translate(64 154)');
        svgString = svgString.replace('y="458.24"', 'y="348.24"');
        svgString = svgString.replace('y="462.24"', 'y="352.24"');
        svgString = svgString.replace('y="788"', 'y="670"');

        // Compact canvas height
        svgString = svgString.replace('height="800"', 'height="710"');
        svgString = svgString.replace('viewBox="0 0 600 800"', 'viewBox="0 0 600 710"');
      }

      // Replace center logo (#tqp-icon) with custom image if available
      if (customLogoDataUri) {
        const logoY = customHeaderDataUri ? 335 : 362;
        svgString = svgString.replace(
          /<use[^>]*#tqp-icon[^>]*\/?>/g,
          `<image href="${customLogoDataUri}" xlink:href="${customLogoDataUri}" x="272" y="${logoY}" width="56" height="56" preserveAspectRatio="xMidYMid meet"/>`
        );
      }

      // Set font family to Sarabun for Thai rendering support
      svgString = svgString.replace(
        'font-family="Inter, system-ui, sans-serif"',
        'font-family="Sarabun, Tahoma, Segoe UI, sans-serif"'
      );

      // Increase text size to 32, set font-weight to bold, and split amount string to red color
      svgString = svgString.replace(
        /<text ([^>]*)font-size="22"([^>]*)>(.*?)<\/text>/,
        (match, p1, p2, textContent) => {
          let attrs = (p1 + p2).replace(/font-weight="[^"]*"/, 'font-weight="bold"');
          if (textContent.includes(': ')) {
            const parts = textContent.split(': ');
            const title = parts[0];
            const amt = parts.slice(1).join(': ');
            return `<text ${attrs} font-size="32"><tspan fill="#00427A" font-weight="bold">${title}: </tspan><tspan fill="#E63946" font-weight="bold">${amt}</tspan></text>`;
          }
          return `<text ${attrs} font-size="32"><tspan fill="#00427A" font-weight="bold">${textContent}</tspan></text>`;
        }
      );

      const outputHeight = customHeaderDataUri ? 455 : 473;
      const imgOptions = { format: 'png', width: 400, height: outputHeight };
      if (fs.existsSync(fontPath)) {
        imgOptions.resvg = {
          font: {
            fontFiles: [fontPath],
            loadSystemFonts: true,
            defaultFontFamily: 'Sarabun',
            sansSerifFamily: 'Sarabun'
          }
        };
      }

      // Convert the SVG to PNG locally using svg2img
      await new Promise((resolve, reject) => {
        svg2img(svgString, imgOptions, function (error, buffer) {
          if (error) {
            return reject(error);
          }
          fs.writeFile(filePath, buffer, function (writeErr) {
            if (writeErr) {
              return reject(writeErr);
            }
            resolve(filename);
          });
        });
      });

      logger.info(`[QR-Gen] Generated fresh QR image for amount ${numAmount} (${promptPayNumber}): ${filename}`);
      return filename;
    } finally {
      inFlightGenerations.delete(filename);
    }
  })();

  inFlightGenerations.set(filename, genPromise);
  return genPromise;
}

const { getBaseUrl } = require('./utils/url');

function getQrImageUrl(filename, customBaseUrl = null) {
  let base = customBaseUrl || getBaseUrl();
  if (base.startsWith('http://')) base = base.replace('http://', 'https://');
  return `${base}/img/qr/${filename}`;
}

module.exports = {
  generateQrCode,
  isQrCodeCached,
  getQrImageUrl
};


