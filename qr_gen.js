// Polyfill Array.prototype.toSorted for Node.js v18 compatibility
if (!Array.prototype.toSorted) {
  Array.prototype.toSorted = function(compareFn) {
    return this.slice().sort(compareFn);
  };
}

const { renderThaiQRPayment } = require('thai-qr-payment');
const svg2img = require('svg2img');
const fs = require('fs');
const path = require('path');

const qrDir = path.join(__dirname, 'qr');

/**
 * Generates a PromptPay QR code image inside the 'qr' directory and returns its filename.
 * Also cleans up any temporary QR code images older than 1 hour.
 * 
 * @param {number} amount - The transaction amount.
 * @param {string} promptPayNumber - The PromptPay phone number or ID.
 * @returns {Promise<string>} The generated QR code filename.
 */
async function generateQrCode(amount, promptPayNumber = '0850705894') {
  // Ensure the qr directory exists
  if (!fs.existsSync(qrDir)) {
    fs.mkdirSync(qrDir, { recursive: true });
  }

  // Cleanup old QR images (older than 1 hour)
  try {
    const files = fs.readdirSync(qrDir);
    const now = Date.now();
    for (const file of files) {
      if (file.startsWith('qr_') && file.endsWith('.png')) {
        const filePath = path.join(qrDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > 3600 * 1000) {
          fs.unlinkSync(filePath);
          console.log(`[QR-Cleanup] Deleted old QR image: ${file}`);
        }
      }
    }
  } catch (cleanupErr) {
    console.error('[QR-Cleanup] Error cleaning up old QR images:', cleanupErr.message);
  }

  // Generate PromptPay SVG using thai-qr-payment
  const svgString = renderThaiQRPayment({
    recipient: promptPayNumber,
    amount: amount
  });

  const filename = `qr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.png`;
  const filePath = path.join(qrDir, filename);

  // Convert the SVG to PNG locally using svg2img
  return new Promise((resolve, reject) => {
    svg2img(svgString, { format: 'png', width: 400, height: 400 }, function(error, buffer) {
      if (error) {
        return reject(error);
      }
      fs.writeFile(filePath, buffer, function(writeErr) {
        if (writeErr) {
          return reject(writeErr);
        }
        resolve(filename);
      });
    });
  });
}

module.exports = {
  generateQrCode
};
