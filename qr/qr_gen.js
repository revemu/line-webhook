const generatePayload = require('promptpay-qr');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const qrDir = path.join(__dirname);

/**
 * Generates a PromptPay QR code image and returns its filename.
 * Also cleans up any temporary QR code images older than 1 hour.
 * 
 * @param {number} amount - The transaction amount.
 * @param {string} promptPayNumber - The PromptPay phone number or ID.
 * @returns {Promise<string>} The generated QR code filename.
 */
async function generateQrCode(amount, promptPayNumber = '0850705894') {
  // Ensure the directory exists
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

  // Generate PromptPay payload and QR code image
  const payload = generatePayload(promptPayNumber, { amount });
  const filename = `qr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.png`;
  const filePath = path.join(qrDir, filename);

  await QRCode.toFile(filePath, payload, {
    color: {
      dark: '#000000',
      light: '#ffffff'
    },
    width: 400
  });

  return filename;
}

module.exports = {
  generateQrCode
};
