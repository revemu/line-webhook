const express = require('express');
const crypto = require('crypto');
const { middleware } = require('@line/bot-sdk');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const axios = require('axios');
const https = require('https');
const http = require('http');
const db = require('./query');
const flex = require('./flex');
const cmd = require('./cmd');
const slipService = require('./slip');
const lineClient = require('./lineClient');
const { formatDate, getFormatDate: getFormatDateUtil } = require('./utils/date');

const execPromise = util.promisify(exec);

const fsSync = require('fs');
const { Jimp } = require('jimp');
const jsQR = require('jsqr');
const { readBarcodes, readBarcodesFromImageData, setZXingModuleOverrides } = require('zxing-wasm');

// Configure zxing-wasm to load local .wasm binary from node_modules (prevents CDN fetch failures)
try {
    const fullWasmPath = path.join(__dirname, 'node_modules', 'zxing-wasm', 'dist', 'full', 'zxing_full.wasm');
    const readerWasmPath = path.join(__dirname, 'node_modules', 'zxing-wasm', 'dist', 'reader', 'zxing_reader.wasm');
    const targetWasmPath = fsSync.existsSync(fullWasmPath) ? fullWasmPath : (fsSync.existsSync(readerWasmPath) ? readerWasmPath : null);

    if (targetWasmPath) {
        const wasmBinary = fsSync.readFileSync(targetWasmPath);
        setZXingModuleOverrides({ wasmBinary });
    }
} catch (wasmErr) {
    console.warn('⚠️ Could not load local WASM binary for zxing-wasm:', wasmErr.message);
}

require('dotenv').config({ quiet: true });

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50, keepAliveMsecs: 30000 });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50, keepAliveMsecs: 30000 });
const lineDataAxios = axios.create({ httpsAgent, httpAgent, timeout: 10000 });

const app = express();
const config = lineClient.config;

function getFormatDate(date, format = 'short') {
    return getFormatDateUtil(date, format, { buddhistEra: true, includeTime: true });
}

// Function to reply to LINE user using SDK
const replyMessage = lineClient.replyMessage;

// Middleware to dynamically capture base URL from request host (for Nginx proxy support)
app.use((req, res, next) => {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['host'] || req.get('host');
    global.baseWebhookUrl = `${proto}://${host}`;
    next();
});

// Use LINE SDK middleware for webhook handling
app.use('/webhook', middleware(config));

// Webhook POST endpoint
app.post('/webhook', async (req, res) => {
    try {
        const events = req.body.events;
        res.status(200).send('OK');
        if (Array.isArray(events)) {
            for (const event of events) {
                handleEvent(event);
            }
        }
    } catch (error) {
        console.error('Error processing webhook events:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Handle incoming webhook events
async function handleEvent(event) {
    try {
        if (event.type === 'message') {
            await handleMessage(event);
        } else if (event.type === 'memberJoined') {
            await handleJoinedMember(event);
        } else {
            console.log('Received unhandled event type:', event.type, event);
        }
    } catch (error) {
        console.error('Error processing event:', error.message || error);
    }
}

// Serve static assets from project directory and 'pic' folder
app.use('/img/qr', express.static(path.join(__dirname, 'qr')));
app.use('/img', express.static(path.join(__dirname, 'img')));
app.use(express.static(__dirname));

// Serve green_dot.png static asset and fallback route aliases
/*app.get(['/green_dot.png', '/img/green_dot.png', '/green_pulse_true.png', '/img/green_pulse_true.png'], (req, res) => {
    res.sendFile(path.join(__dirname, 'green_dot.png'));
});*/


// Function to get image content from LINE (Optimized: Axios with Keep-Alive Agent ~1.37ms/req)
async function getImageAxios(messageId) {
    const access_token = config.channelAccessToken;
    const maxRetries = 3;
    let retries = 0;
    while (retries <= maxRetries) {
        try {
            const response = await lineDataAxios.get(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
                headers: {
                    'Authorization': `Bearer ${access_token}`
                },
                responseType: 'arraybuffer'
            });
            return Buffer.from(response.data);
        } catch (error) {
            retries++;
            console.error(`Error getting image content (attempt ${retries}/${maxRetries}):`, error.message || error);
            if (retries > maxRetries)
                throw error;
            else await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}



// Function to verify bank slip via EasySlip API v2 using QR Code payload
const verifyEasySlipByPayload = slipService.verifyEasySlipByPayload;
const verifyEasySlipByImage = slipService.verifyEasySlipByImage;
// Function to read QR code from image buffer (Primary: zxing-wasm in-memory ~6ms, Secondary: zbarimg CLI, Tertiary: jsQR)
async function readQRCode(imageBuffer) {
    let jimpImage = null;

    // 1. Primary Pass: zxing-wasm (Fast WebAssembly scanner, in-memory)
    /*try {
        jimpImage = await Jimp.read(imageBuffer);
        const imageData = {
            data: new Uint8ClampedArray(jimpImage.bitmap.data),
            width: jimpImage.bitmap.width,
            height: jimpImage.bitmap.height
        };
        //const results = await readBarcodesFromImageData(imageData, { formats: ['QRCode'] });
        const results = await readBarcodes(imageData, { formats: ['QRCode'] });
        if (results && results.length > 0) {
            return results.map(r => ({ type: r.format || 'QR-Code', data: r.text }));
        }
    } catch (zxingErr) {
        console.warn('[readQRCode] Primary zxing-wasm decoder warning:', zxingErr.message || zxingErr);
    }*/

    // 2. Secondary Pass: zbarimg CLI (Native C scanner fallback)
    let tempFilePath = null;
    try {
        const tempDir = "./temp/";
        await fs.mkdir(tempDir, { recursive: true });

        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substr(2, 9);
        tempFilePath = path.join(tempDir, `qr_${timestamp}_${randomStr}.jpg`);
        await fs.writeFile(tempFilePath, imageBuffer);

        const { stdout } = await execPromise(`zbarimg "${tempFilePath}"`);
        await fs.unlink(tempFilePath);

        if (stdout && stdout.trim()) {
            const lines = stdout.trim().split('\n');
            const codes = lines.map(line => {
                const colonIndex = line.indexOf(':');
                if (colonIndex > 0) {
                    const type = line.substring(0, colonIndex);
                    const data = line.substring(colonIndex + 1);
                    return { type, data };
                }
                return { type: 'UNKNOWN', data: line };
            }).filter(code => code.data);

            if (codes.length > 0) {
                return codes;
            }
        }
    } catch (error) {
        if (tempFilePath) {
            try { await fs.unlink(tempFilePath); } catch (unlinkError) { }
        }
    }
    /*
    // 3. Tertiary Fallback Pass: jsQR + Jimp in-memory
    try {
        if (!jimpImage) {
            jimpImage = await Jimp.read(imageBuffer);
        }
        const qrCode = jsQR(
            new Uint8ClampedArray(jimpImage.bitmap.data),
            jimpImage.bitmap.width,
            jimpImage.bitmap.height
        );
        if (qrCode && qrCode.data) {
            return [{ type: 'QR-Code', data: qrCode.data }];
        }
    } catch (jsqrErr) {
        console.warn('[readQRCode] Tertiary jsQR fallback warning:', jsqrErr.message);
    }*/

    return null;
}

// Function to check if zbarimg is installed
async function checkZbarimgInstalled() {
    try {
        await execPromise('zbarimg --help');
        return true;
    } catch (error) {
        return false;
    }
}

async function handleJoinedMember(event) {
    try {
        console.log(event);
        const { replyToken, source } = event;
        for (let member of event.joined.members) {
            if (member.type === "user") {
                console.log(`Member ${member.userId} joined group`);
                const res = await lineClient.fetchUserProfile(member.userId, source.groupId);
                if (res && res.displayName) {
                    const line_name = `@${res.displayName}`;
                    console.log(`add new member ${member.userId}: ${line_name}`);
                    await db.newMember(member.userId, line_name);
                    const theme = await db.getTheme();
                    const week = await db.queryWeekID(0);
                    const dateStr = week.length > 0 ? week[0].date : '';
                    const welcomeTpl = await db.getTemplate('welcome', 'header');
                    const welcomeImageUrl = welcomeTpl ? welcomeTpl.url : null;
                    const welcomeBubble = flex.buildWelcomeFlex(line_name, theme, welcomeImageUrl, dateStr);
                    const replyMessages = [
                        {
                            type: 'flex',
                            altText: `ยินดีต้อนรับ ${res.displayName} สู่ทีม! 🎉`,
                            contents: welcomeBubble
                        }
                    ];
                    await replyMessage(replyToken, replyMessages);
                }
            }
        }
    } catch (error) {
        console.error('Error add joined member:', error);
    }
}

async function manageMember(source, member, line_name, pictureUrl) {
    line_name = `@${line_name}`;
    if (member.length > 0) {
        const existingPic = member[0].picture_url;
        if (line_name !== member[0].name || (pictureUrl && pictureUrl !== existingPic)) {
            console.log(`update existing member info ${source.userId}: ${member[0].name} => ${line_name}, pic update: ${pictureUrl !== existingPic}`);
            await db.updateMemberInfo(member[0].id, line_name, pictureUrl);
        }
    } else {
        console.log(`add new member ${source.userId}: ${line_name}`);
        await db.newMember(source.userId, line_name, pictureUrl);
    }

}

async function handleMessage(event) {
    const { source, message } = event;
    const { userId, groupId } = source;

    // Parallel fetch member and group/user profile
    let [member, profile] = await Promise.all([
        db.queryMemberbyLineID(userId),
        lineClient.fetchUserProfile(userId, groupId)
    ]);

    if (profile && profile.displayName) {
        await manageMember(source, member, profile.displayName, profile.pictureUrl);
        if (member.length === 0) {
            member = await db.queryMemberbyLineID(userId);
        }
    }

    if (member.length === 0) {
        console.warn(`[handleMessage] Skipping message: Unable to register member for userId: ${userId}`);
        return;
    }

    switch (message.type) {
        case 'image':
            return await handleImageMessage(event, member[0]);
        case 'text':
            return await handleTextMessage(event, member[0]);
        case 'sticker':
            return handleStickerMessage(event, member[0]);
        default:
            console.log(`Received message type: ${message.type}`);
    }
}

async function handleImageMessage(event, member) {
    const { replyToken, message, source } = event;
    try {
        console.log(`${member.name}: sent image! need processing...`);
        const startTime = Date.now();
        const imageBuffer = await getImageAxios(message.id);
        const tDownload = Date.now() - startTime;

        const tQrStart = Date.now();
        const codes = await readQRCode(imageBuffer);
        const tQr = Date.now() - tQrStart;
        //console.log(`Time processed image download + QR scan: ${Date.now() - startTime} ms`);

        if (codes && codes.length > 0) {
            const qrCode = codes[0].data;
            //console.log('QR code detected:', qrCode);

            const handledAsSlip = await slipService.processPaymentSlip({
                event,
                member,
                imageBuffer,
                qrCode,
                db,
                replyMessage,
                getFormatDate,
                timing: { tDownload, tQr }
            });

            if (handledAsSlip) {
                return; // Handled as payment slip
            }
        }

        // --- Handle other non-payment image types here ---
        console.log(`[handleImageMessage] Image is not a payment slip. Skipping or handling custom image logic...`);
    } catch (error) {
        console.error('Error processing image!,', error);
        /*const date = new Date();
        if (date.getDay() === 6 && date.getHours() > 19) {
            await replyMessage(replyToken, [{
                type: 'text',
                text: 'ไม่สามารถโหลดรูปจาก Line ได้'
            }]);
        }*/
    }
}

async function handleTextMessage(event, member) {
    const { replyToken, message, source } = event;
    const text = message.text.trim();
    const op = text.substring(0, 1);
    const isCmd = ['/', 'x', '+', '-'].includes(op) || !source.groupId;

    if (isCmd) {
        console.log(`${member.name} [CMD]: ${message.text}`);
        const cmd_str = op === '/' ? text.substring(1) : text;
        const replyMessages = await cmd.process_cmd(cmd_str, member, message.quoteToken, source.groupId);
        if (replyMessages) {
            await replyMessage(replyToken, replyMessages);
        }
    } else {
        console.log(`${member.name}: ${message.text}`);
        const h = new Date().getHours();
        const dow = new Date().getDay();
        if (dow > 0 && dow < 6 && h > 10 && h < 20 && source.groupId) {
            const [debt_str, sub, debt_count, proceed] = await db.getDebtList(0);
            if (proceed && debt_count > 0) {
                console.log(`once a day debt call!`);
                await replyMessage(replyToken, {
                    type: 'textV2',
                    text: debt_str,
                    substitution: sub
                });
            }
        }
    }
}

function handleStickerMessage(event, member) {
    const keywords = event.message.keywords;
    console.log(`${member.name}: sent sticker ${randomItem(keywords || ['unknown'])}`);
}

function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
}

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).send('Internal Server Error');
});

// Start server
app.listen(3001, async () => {
    //console.log(`LINE Webhook server running on port ${PORT}`);
    //console.log(`Webhook URL: http://localhost:${PORT}/webhook`);

    // Check if environment variables are set
    if (!config.channelSecret || !config.channelAccessToken) {
        console.warn('⚠️  Warning: LINE_CHANNEL_SECRET and LINE_CHANNEL_ACCESS_TOKEN environment variables are not set');
        console.log('Please set these environment variables before using the bot');
    } else {
        console.log('✅ LINE Bot credentials loaded successfully');
    }

    await db.testConnection();
    //const res = await db.getMemberWeek() ;

    //console.log(db_test);
    // Check if zbarimg is installed
    const zbarimgInstalled = await checkZbarimgInstalled();
    if (zbarimgInstalled) {
        console.log('✅ zbarimg command line tool is available');
    } else {
        console.warn('⚠️  zbarimg CLI not found. Using zxing-wasm (WebAssembly) & jsQR engines.');
    }
});

module.exports = app;