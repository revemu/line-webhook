const express = require('express');
const crypto = require('crypto');
const { Client, middleware } = require('@line/bot-sdk');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const axios = require('axios');
const db = require('./query');
const flex = require('./flex');
const cmd = require('./cmd');

const execPromise = util.promisify(exec);

require('dotenv').config({ quiet: true });

const app = express();

// LINE Bot configuration
const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};



function formatDate(curDate) {
    const d = ('0' + curDate.getDate()).slice(-2);
    const m = ('0' + (curDate.getMonth() + 1)).slice(-2);
    const y = curDate.getFullYear();
    const h = ('0' + curDate.getHours()).slice(-2);
    const min = ('0' + curDate.getMinutes()).slice(-2);
    const s = ('0' + curDate.getSeconds()).slice(-2);
    return (`${y}-${m}-${d} ${h}:${min}:${s}`)
}


// Create LINE SDK client
const client = new Client(config);

// Use LINE SDK middleware for webhook handling
app.use('/webhook', middleware(config));


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



// Function to read QR code from image buffer using zbarimg CLI
async function readQRCode(imageBuffer) {
    let tempFilePath = null;
    try {
        // Create temporary directory
        const tempDir = "./temp/"
        //await fs.mkdir(tempDir, { recursive: true });

        // Create temporary file with unique name
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substr(2, 9);
        tempFilePath = path.join(tempDir, `qr_${timestamp}_${randomStr}.jpg`);

        // Write buffer to temporary file
        await fs.writeFile(tempFilePath, imageBuffer);

        // Execute zbarimg command
        const { stdout, stderr } = await execPromise(`zbarimg "${tempFilePath}"`);

        // Clean up temporary file
        await fs.unlink(tempFilePath);

        if (stdout && stdout.trim()) {
            // Parse zbarimg output
            const lines = stdout.trim().split('\n');
            const codes = lines.map(line => {
                // zbarimg output format: "CODE-TYPE:data"
                const colonIndex = line.indexOf(':');
                if (colonIndex > 0) {
                    const type = line.substring(0, colonIndex);
                    const data = line.substring(colonIndex + 1);
                    return { type, data };
                }
                return { type: 'UNKNOWN', data: line };
            }).filter(code => code.data); // Filter out empty results

            return codes.length > 0 ? codes : null;
        }

        return null;
    } catch (error) {
        // Clean up temporary file in case of error
        if (tempFilePath) {
            try {
                await fs.unlink(tempFilePath);
            } catch (unlinkError) {
                console.error('Error cleaning up temp file:', unlinkError);
            }
        }

        // Check if error is due to no codes found (zbarimg exits with code 4)
        if (error.code === 4) {
            //console.log('No barcodes/QR codes found in image');
            return null;
        }

        console.error('Error reading QR/barcode with zbarimg:', error.message);
        return null;
    }
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

// Function to reply to LINE user using SDK
async function replyMessage(replyToken, messages) {
    try {
        await client.replyMessage(replyToken, messages);
    } catch (error) {
        console.error('Error replying message:', error);
        throw error;
    }
}

// Webhook endpoint - LINE SDK middleware handles signature validation
/*app.post('/webhook', (req, res) => {
    const events = req.body.events;

    // Process each event
    Promise.all(events.map(handleEvent))
        .then(() => res.status(200).send('OK'))
        .catch((error) => {
            console.error('Error processing events:', error);
            res.status(500).send('Internal Server Error');
        });
});*/

app.post('/webhook', async (req, res) => {
    try {
        const events = req.body.events;
        res.status(200).send('OK');
        for (const event of events) {
            handleEvent(event);
        }
    } catch (error) {
        console.error('Error processing events:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Handle incoming events
async function handleEvent(event) {
    //console.log('Received event:', event.type);
    try {
        if (event.type === 'message') {
            await handleMessage(event);
        } else if (event.type === 'memberJoined') {
            await handleJoinedMember(event);
        } else {
            console.log('Received event:', event.type);
            console.log(event);
        }
    } catch (error) {
        console.error('Error processing events', error);
        //console.log(event) ;
    }

}

async function handleJoinedMember(event) {
    try {
        console.log(event);
        const { replyToken, source } = event;
        for (let member of event.joined.members) {
            if (member.type === "user") {
                console.log(`Member ${member.userId} joined group`);
                const res = await client.getGroupMemberProfile(source.groupId, member.userId);
                if (res.displayName != '') {
                    const line_name = `@${res.displayName}`;
                    console.log(`add new member ${member.userId}: ${line_name}`);
                    await db.newMember(member.userId, line_name);
                    const replyMessages = [
                        {
                            "type": "textV2",
                            "text": "ยินดีต้อนรับ {user1}!\n\nพิมพ์ +1 เพื่อลงชื่อ",
                            "substitution": {
                                "user1": {
                                    "type": "mention",
                                    "mentionee": {
                                        "type": "user",
                                        "userId": member.userId
                                    }
                                }
                            }
                        }]
                    await replyMessage(replyToken, replyMessages);
                }
            }
        }
    } catch (error) {
        console.error('Error add joined member:', error);
    }
}

async function manageMember(source, member, line_name) {
    //const res = await client.getGroupMemberProfile(source.groupId, source.userId) ;
    //client.getGroupMemberProfile()
    //const res = await client.getProfile(source.userId) ;
    //client.getGroupMemberProfile() ;
    /*let displayName ;
    if (res) {
        console.log(res) ;
        displayName = '@' + res.displayName ;
    }*/
    line_name = `@${line_name}`;
    if (member.length > 0) {
        //console.log(member) ;
        if (line_name == member[0].name) {
            //console.log(`existing member ${source.userId}: ${member[0].name}`);
        } else {
            console.log(`update existing member name ${source.userId}: ${member[0].name} => ${line_name}`);
            await db.updateMember(member[0].id, line_name, 0);
        }
    } else {
        console.log(`add new member ${source.userId}: ${line_name}`);
        await db.newMember(source.userId, line_name);
    }

}

// Handle incoming messages
async function handleMessage(event) {
    const { source, message } = event;
    const { userId, groupId } = source;

    // Parallel fetch member and group profile if applicable
    const [member, groupProfile] = await Promise.all([
        db.queryMemberbyLineID(userId),
        groupId ? client.getGroupMemberProfile(groupId, userId).catch(() => null) : null
    ]);

    if (groupId && groupProfile && groupProfile.displayName) {
        await manageMember(source, member, groupProfile.displayName);
    }

    if (member.length === 0) return;

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
    const { replyToken, message } = event;
    try {
        console.log(`${member.name}: sent image! need processing...`);
        const startTime = Date.now();
        const imageBuffer = await getImageAxios(message.id);
        const codes = await readQRCode(imageBuffer);
        
        console.log(`Time processed image elapsed: ${Date.now() - startTime} ms`);

        if (codes) {
            const qrCode = codes[0].data;
            console.log('QR code detected:', qrCode);
            if (qrCode.includes("60000010103")) {
                const header = `🙏 ${member.name} ได้รับสลิปโอนแล้ว\n\n`;
                const week = await db.queryWeekDate();
                let payweek = true;
                if (week.length > 0) {
                    const now = new Date();
                    if (now.getTime() < week[0].date.getTime()) {
                        payweek = false;
                    }
                    console.log(`week ${week[0].date} now ${now}`);
                }

                let replyMessages;
                if (!payweek) {
                    replyMessages = [{
                        type: 'text',
                        quoteToken: message.quoteToken,
                        text: header
                    }];
                } else {
                    await db.updateMemberWeek(member.id, 1, 0);
                    const [msg, sub, count] = await db.getMemberWeek2(0);
                    console.log(`user count: ${count}`);
                    if (count === 0 || count > 20) {
                        replyMessages = [{
                            type: 'text',
                            quoteToken: message.quoteToken,
                            text: header + msg
                        }];
                    } else {
                        replyMessages = {
                            type: 'textV2',
                            quoteToken: message.quoteToken,
                            text: header + msg,
                            substitution: sub
                        };
                    }
                }
                await replyMessage(replyToken, replyMessages);
            }
        }
    } catch (error) {
        console.error('Error processing image!,', error);
        const date = new Date();
        if (date.getDay() === 6 && date.getHours() > 19) {
            await replyMessage(replyToken, [{
                type: 'text',
                text: 'ไม่สามารถโหลดรูปภาพจาก Line ได้\nถ้าเป็นการส่ง Slip หลีกเลี่ยงการส่งในช่วงเวลา 19.00-22.30'
            }]);
        }
    }
}

async function handleTextMessage(event, member) {
    const { replyToken, message, source } = event;
    console.log(`${member.name}: ${message.text}`);
    const text = message.text.trim();
    const op = text.substring(0, 1);
    const index = (op === "/") ? 1 : 0;

    if (['/', 'x', '+', '-'].includes(op)) {
        const cmd_str = text.substring(index);
        const replyMessages = await cmd.process_cmd(cmd_str, member, message.quoteToken);
        await replyMessage(replyToken, replyMessages);
    } else {
        const h = new Date().getHours();
        if (h > 12 && h < 22 && source.groupId) {
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