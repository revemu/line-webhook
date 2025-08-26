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

const tpl_slipjson = {
                    "status": 200,
                    "data": {
                        "payload": "004600060000010103002022520250816210339240054672085102TH9104D5EB", 
                        "transRef": "2025081621033924005467208", 
                        "date": "2025-08-16T21:03:39+07:00", 
                        "countryCode": "", 
                        "amount": { 
                            "amount": 249, 
                            "local": { "amount": 0, "currency": "" } 
                        }, 
                        "fee": 0, "ref1": "", "ref2": "", "ref3": "", 
                        "sender": { 
                            "bank": { "id": "002", "name": "ธนาคารกรุงเทพ", "short": "BBL" }, 
                            "account": { "name": { "en": "PYSIT P" }, "bank": { "type": "BANKAC", "account": "086-0-xxx588" } } 
                        }, 
                        "receiver": { 
                            "bank": {}, 
                            "account": { 
                                "name": { "th": "นาย เศรษฐ ว", "en": "SAGE" }, 
                                "proxy": { "type": "MSISDN", "account": "085-xxx-5894" } 
                            } 
                        }
                    }
                };

// Create LINE SDK client
const client = new Client(config);

// Use LINE SDK middleware for webhook handling
app.use('/webhook', middleware(config));

function checkSlip(slipjson, name) {
    
    const amount = slipjson.data.amount.amount ;
    const date = new Date(slipjson.data.date) ;
    let recv ;
    let sender ;
    if ('en' in slipjson.data.receiver.account.name) {
        recv = slipjson.data.receiver.account.name.en ;
    } else {
        recv = slipjson.data.receiver.account.name.th ;
    }
    if ('en' in slipjson.data.sender.account.name) {
        sender = slipjson.data.sender.account.name.en ;
    } else {
        sender = slipjson.data.sender.account.name.th ;
    }
    let tail ;
    if (recv.includes("เศรษฐ") || recv.includes("SAGE")) {
        recv = "Kyne" ;
        tail = `💰 -🙏 ${name} ได้รับ เงินโอนจำนวน ${amount} บาท\n\n` ;
    } else {
        recv +=  " * ชื่อผู้รับไม่ตรง"
        tail = `💰 - ${name} เงินโอนจำนวน ${amount} บาท\n\n` ;
    }
    const bank = slipjson.data.sender.bank.short ;

    return `⌚ - ${formatDate(date)}\n💸 - ${bank} - ${sender} \n💵 - ${recv} \n` + tail ;


}

function formatDate(curDate) {
    const d = ('0' + curDate.getDate()).slice(-2);
    const m = ('0' + (curDate.getMonth()+1)).slice(-2);
    const y = curDate.getFullYear();
    const h = ('0' + curDate.getHours()).slice(-2);
    const min = ('0' + curDate.getMinutes()).slice(-2);
    const s = ('0' + curDate.getSeconds()).slice(-2);
    return (`${y}-${m}-${d} ${h}:${min}:${s}`)
}

async function getSlipInfo(payload) {
    try {
        const response = await axios.get(`https://developer.easyslip.com/api/v1/verify?payload=${payload}`, {
            headers: {
                'Authorization': `Bearer 196e73b3-6b1a-4a46-be07-5ef89dffa11b`  
            },
            //responseType: 'arraybuffer'
        });
        //console.log(response.data) ;
        return response.data ;
    } catch (error) {
        if (error.response.data) {
            console.error('api slip error:', error.response.data);
        }
        return { "success": false } ;
        //throw error;
    }
}

// Function to get image content from LINE using SDK
async function getImageContent(messageId, type = 0) {
    try {
        let my_client ;
        if (type == 1) {
            my_client = cur_client ;
        } else {
            my_client = client ;
        }
        const stream = await my_client.getMessageContent(messageId);
        const chunks = [];
        
        return new Promise((resolve, reject) => {
            stream.on('data', (chunk) => {
                chunks.push(chunk);
            });
            
            stream.on('end', () => {
                resolve(Buffer.concat(chunks));
            });
            
            stream.on('error', (error) => {
                reject(error);
            });
        });
    } catch (error) {
        console.error('Error getting image content:', error);
        throw error;
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
        res.status(200).send('OK') ;
        for (const event of events) {
            handleEvent(event) ;
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
        } else {
            console.log('Received event:', event.type);
            console.log(event) ;
        }
    } catch (error) {
        console.error('Error processing events');
        console.log(event) ;
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
    line_name = `@${line_name}` ;
    if (member.length > 0) {
        //console.log(member) ;
        if (line_name == member[0].name) {
            //console.log(`existing member ${source.userId}: ${member[0].name}`);
        } else {
            console.log(`update existing member name ${source.userId}: ${member[0].name} => ${displayName}`);
            //await db.updateMember(member[0].id, displayName, 0) ;
        }
    } else {
        console.log(`add new member ${source.userId}: ${line_name}`);
        await db.newMember(source.userId, line_name) ;
    }
    
}

// Handle incoming messages
async function handleMessage(event) {
    const { replyToken, message, source } = event;
    const userId = source.userId;
    //const groupId = source.groupId ;
    //console.log(source) ;
    const member = await db.queryMemberbyLineID(userId) ;
    //console.log(`Message from user ${userId}: ${message.type}`);
    if (source.groupId) {
        const res = await client.getGroupMemberProfile(source.groupId, source.userId) ;
        //console.log(res) ;
        if (res.displayName != '') {
            const line_name = res.displayName
            await manageMember(source, member, line_name) ;
        }
        
    }
    
    if (member.length == 0) {
        return ;
    }

    if (message.type === 'image') {
        try {
            //console.log('Processing image message...');
            console.log(`${member[0].name}: sent image! need processing...`);
            let startTime = new Date() ;
            // Get image content from LINE
            const imageBuffer = await getImageContent(message.id);
            //console.log('Image downloaded, size:', imageBuffer.length, 'bytes');
            //let endTime = new Date();
            //let timeElapsed = endTime - startTime; // Difference in milliseconds
            //console.log(`Time load img elapsed: ${timeElapsed} ms`);

            // Read QR/barcodes from image
            //startTime = new Date() ;
            const codes = await readQRCode(imageBuffer);
            endTime = new Date();
            timeElapsed = endTime - startTime; // Difference in milliseconds
            console.log(`Time processed image elapsed: ${timeElapsed} ms`) ;
            //console.log(codes) ;
            
            let replyMessages;
            if (codes) {
                const alphanumericRegex = /^[A-Za-z0-9]+$/;
                const qrCode = codes[0].data ;
                console.log('QR code detected:', qrCode) ;
                if (qrCode.includes("60000010103")) {
                    
                    let slipjson = await getSlipInfo(qrCode) ;
                
                    //let slipjson = tpl_slipjson ;

                    //slipjson = JSON.parse(slipjson) ;
                    console.log(slipjson) ;
                    let header = '' ;
                    if (slipjson.hasOwnProperty('status')) {
                        header = checkSlip(slipjson, member[0].name) ;
                        console.log(header) ;
                    } else {
                        header = `🙏 ${member[0].name} ได้รับสลิปโอนแล้ว\n\n`;
                        //console.log("qrCode") ;
                    }

                    await db.updateMemberWeek(member[0].id, 1, 0) ;
                    const msg = await db.getMemberWeek(0) ;
                    //console.log(msg) ;
                    //res.status(200).json({ status: 1, qr: codes[0].data });
                    
                    replyMessages = [{
                        type: 'text',
                        quoteToken: message.quoteToken,
                        text: header + msg
                    }];
                    await replyMessage(replyToken, replyMessages);
                }
                
            } 

        } catch (error) {
            console.error('Error processing image:', error);
            /*await replyMessage(replyToken, [{
                type: 'text',
                text: 'Sorry, I encountered an error while processing your image. Please try again.'
            }]);*/
        }
    } else if (message.type === 'text') {
        // Handle text messages
        console.log(`${member[0].name}: ${message.text}`);
        const text = message.text.trim() ;
        const op = text.substring(0,1) ;
        let index = 0 ;
        switch (op) {
            case "/":
                index = 1 ;
            case '+':
            case '-':
                /*if (op == "/") {
                    index = 1 ;
                }*/
                const cmd_str = text.substring(index) ;
                let replyMessages = await cmd.process_cmd(cmd_str, member[0], message.quoteToken) ;
                //replyMessage.quoteToken = await message.quoteToken ;
                //console.log(replyMessage) ;
                await replyMessage(replyToken, replyMessages);
                break ;
            default:
                break ;
        }
        //console.log(text) ;
        return ;

    } else if (message.type == 'sticker'){
        const keywords = message.keywords ;
        console.log(`${member[0].name}: sent sticker ${randomItem(keywords)}`);
    }
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
    
    await db.testConnection() ;
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