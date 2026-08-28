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
//LKKaohom.ttf
//Sarabun-Regular.ttf
const fontPath = path.join(__dirname, 'fonts', 'LKKaohom.ttf');
const logoPath = path.join(__dirname, 'assets', 'logo.jpg');

let customLogoDataUri = '';
try {
  if (fs.existsSync(logoPath)) {
    const logoBuf = fs.readFileSync(logoPath);
    customLogoDataUri = `data:image/jpeg;base64,${logoBuf.toString('base64')}`;
  }
} catch (err) {
  console.error('[QR-Gen] Failed to load custom center logo:', err.message);
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
    qrOptions.merchantName = `แสกนจ่ายค่าสนาม: ${amount} บาท`;
  } else {
    qrOptions.merchantName = `แสกนจ่ายค่าสนาม`;
  }
  let svgString = renderThaiQRPayment(qrOptions);

  // Remove PromptPay logo element below header
  svgString = svgString.replace(/<use[^>]*#tqp-promptpay[^>]*\/?>/g, '');

  // Shift content UP to fill the PromptPay logo position
  svgString = svgString.replace('y="250"', 'y="140"');
  svgString = svgString.replace('translate(64 264)', 'translate(64 154)');
  svgString = svgString.replace('y="458.24"', 'y="348.24"');
  svgString = svgString.replace('y="462.24"', 'y="352.24"');
  svgString = svgString.replace('y="788"', 'y="670"');

  // Compact canvas height
  svgString = svgString.replace('height="800"', 'height="710"');
  svgString = svgString.replace('viewBox="0 0 600 800"', 'viewBox="0 0 600 710"');

  // Replace center logo (#tqp-icon) with custom image if available
  if (customLogoDataUri) {
    svgString = svgString.replace(
      /<use[^>]*#tqp-icon[^>]*\/?>/g,
      `<image href="${customLogoDataUri}" xlink:href="${customLogoDataUri}" x="262.24" y="352.24" width="75.52" height="75.52" preserveAspectRatio="xMidYMid meet"/>`
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


  const filename = `qr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.png`;
  const filePath = path.join(qrDir, filename);

  const imgOptions = { format: 'png', width: 400, height: 473 };
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
  return new Promise((resolve, reject) => {
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
}

module.exports = {
  generateQrCode
};
