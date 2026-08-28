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

const qrDir = path.join(__dirname, 'qr');

const fontPath = path.join(__dirname, 'fonts', 'Sarabun-Regular.ttf');
let thaiFontBase64 = '';
try {
  if (fs.existsSync(fontPath)) {
    thaiFontBase64 = fs.readFileSync(fontPath).toString('base64');
  }
} catch (e) {
  console.error('[QR-Gen] Failed to load local Thai font:', e.message);
}

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
  const qrOptions = {
    recipient: promptPayNumber,
    amount: amount,
    showCaption: true
  };
  if (amount > 0) {
    qrOptions.merchantName = `ค่าสนาม: ฿ ${amount}`;
  } else {
    qrOptions.merchantName = `ค่าสนาม`;
  }
  let svgString = renderThaiQRPayment(qrOptions);

  // Embed Thai font into SVG so Linux servers can render Thai characters without missing fonts
  if (thaiFontBase64) {
    const fontStyle = `<defs><style>
      @font-face {
        font-family: 'Sarabun';
        src: url('data:font/ttf;charset=utf-8;base64,${thaiFontBase64}') format('truetype');
        font-weight: normal;
        font-style: normal;
      }
      text, tspan {
        font-family: 'Sarabun', Tahoma, 'Segoe UI', sans-serif !important;
      }
    </style>`;
    svgString = svgString.replace('<defs>', fontStyle);
  } else {
    // Replace default Inter font-family with Thai supported fonts
    svgString = svgString.replace(
      'font-family="Inter, system-ui, sans-serif"',
      'font-family="Tahoma, Segoe UI, sans-serif"'
    );
  }

  // Increase text size to 32 and split amount string to red color
  svgString = svgString.replace(
    /<text ([^>]*)font-size="22"([^>]*)>(.*?)<\/text>/,
    (match, p1, p2, textContent) => {
      if (textContent.includes(': ')) {
        const parts = textContent.split(': ');
        const title = parts[0];
        const amt = parts.slice(1).join(': ');
        return `<text ${p1}font-size="32"${p2}><tspan fill="#00427A">${title}: </tspan><tspan fill="#E63946">${amt}</tspan></text>`;
      }
      return `<text ${p1}font-size="32"${p2}><tspan fill="#00427A">${textContent}</tspan></text>`;
    }
  );


  const filename = `qr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.png`;
  const filePath = path.join(qrDir, filename);

  // Convert the SVG to PNG locally using svg2img
  return new Promise((resolve, reject) => {
    svg2img(svgString, { format: 'png', width: 400, height: 400 }, function (error, buffer) {
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
}

module.exports = {
  generateQrCode
};
