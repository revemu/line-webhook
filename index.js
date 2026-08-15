const express = require('express');
const crypto = require('crypto');
const { middleware } = require('@line/bot-sdk');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const axios = require('axios');
const db = require('./query');
const flex = require('./flex');
const cmd = require('./cmd');
const slipService = require('./slip');
const lineClient = require('./lineClient');
const { formatDate, getFormatDate: getFormatDateUtil } = require('./utils/date');

const execPromise = util.promisify(exec);

const { Jimp } = require('jimp');
const jsQR = require('jsqr');

require('dotenv').config({ quiet: true });

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
        console.error('Error processing event:', error);
    }
}

// Serve static assets from project directory and 'pic' folder
app.use('/img/qr', express.static(path.join(__dirname, 'qr')));
app.use('/img', express.static(path.join(__dirname, 'img')));
app.use(express.static(__dirname));

// Serve green_dot.png static asset
app.get('/img/green_dot.png', (req, res) => {
    res.sendFile(path.join(__dirname, 'green_dot.png'));
});


// Function to get image content from LINE
async function getImageAxios(messageId) {
    let access_token = config.channelAccessToken;
    const maxRetries = 3;
    let retries = 0;
    while (retries <= maxRetries) {
        try {
            const response = await axios.get(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
                headers: {
                    'Authorization': `Bearer ${access_token}`
                },
                responseType: 'arraybuffer'
            });
            return Buffer.from(response.data);
        } catch (error) {
            retries++;
            console.error(`Error getting image content, retried: ${retries}`);
            if (retries > maxRetries)
                throw error;
            else await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}



// Function to verify bank slip via EasySlip API v2 using QR Code payload
const verifyEasySlipByPayload = slipService.verifyEasySlipByPayload;
const verifyEasySlipByImage = slipService.verifyEasySlipByImage;
// Function to read QR code from image buffer (Primary: zbarimg CLI ~132ms, Fallback: jsQR+Jimp in-memory)
async function readQRCode(imageBuffer) {
    // 1. Primary Pass: zbarimg CLI (Native C fast scanner)
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

    // 2. Secondary Fallback Pass: jsQR + Jimp in-memory
    try {
        console.log('[readQRCode] Primary zbarimg found no QR code, running secondary jsQR fallback...');
        const image = await Jimp.read(imageBuffer);
        const qrCode = jsQR(
            new Uint8ClampedArray(image.bitmap.data),
            image.bitmap.width,
            image.bitmap.height
        );
        if (qrCode && qrCode.data) {
            console.log('[readQRCode] Decoded QR code via secondary jsQR fallback!');
            return [{ type: 'QR-Code', data: qrCode.data }];
        }
    } catch (jsqrErr) {
        console.warn('[readQRCode] Secondary jsQR fallback warning:', jsqrErr.message);
    }

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
        console.log(`Time processed image download + QR scan: ${Date.now() - startTime} ms`);

        if (codes && codes.length > 0) {
            const qrCode = codes[0].data;
            console.log('QR code detected:', qrCode);

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
    console.log(`${member.name}: ${message.text}`);
    const text = message.text.trim();
    const op = text.substring(0, 1);

    if (['/', 'x', '+', '-'].includes(op) || !source.groupId) {
        const cmd_str = op === '/' ? text.substring(1) : text;
        const replyMessages = await cmd.process_cmd(cmd_str, member, message.quoteToken, source.groupId);
        if (replyMessages) {
            await replyMessage(replyToken, replyMessages);
        }
    } else {
        const h = new Date().getHours();
        const dow = new Date().getDay();
        if (dow > 0 && h > 10 && h < 22 && source.groupId) {
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
        console.warn('⚠️  Warning: zbarimg command line tool is not installed');
        console.log('Please install zbar-tools package:');
        console.log('  Ubuntu/Debian: sudo apt-get install zbar-tools');
        console.log('  CentOS/RHEL: sudo yum install zbar');
        console.log('  macOS: brew install zbar');
        console.log('  Windows: Download from http://zbar.sourceforge.net/');
    }
});

module.exports = app;