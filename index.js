const express = require('express');
const crypto = require('crypto');
const { Client, middleware } = require('@line/bot-sdk');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const axios = require('axios');
const db = require('./query');

const execPromise = util.promisify(exec);

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// LINE Bot configuration
const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const cur_config = {
    channelAccessToken: process.env.CUR_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.CUR_CHANNEL_SECRET,
};


// Create LINE SDK client
const client = new Client(config);
const cur_client = new Client(cur_config);

// Use LINE SDK middleware for webhook handling
app.use('/webhook', middleware(config));

async function getSlipInfo(payload) {
    try {
        const response = await axios.get(`https://developer.easyslip.com/api/v1/verify?payload=${payload}`, {
            headers: {
                'Authorization': `Bearer 196e73b3-6b1a-4a46-be07-5ef89dffa11b`  
            },
            //responseType: 'arraybuffer'
        });
        console.log(response.data) ;
        return response.data ;
    } catch (error) {
        console.error('Error getting image content:', error);
        throw error;
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
            console.log('No barcodes/QR codes found in image');
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
app.post('/webhook', (req, res) => {
    const events = req.body.events;

    // Process each event
    Promise.all(events.map(handleEvent))
        .then(() => res.status(200).send('OK'))
        .catch((error) => {
            console.error('Error processing events:', error);
            res.status(500).send('Internal Server Error');
        });
});

// Handle incoming events
async function handleEvent(event) {
    console.log('Received event:', event.type);

    if (event.type === 'message') {
        await handleMessage(event);
    }
}

 

// Handle incoming messages
async function handleMessage(event) {
    const { replyToken, message, source } = event;
    const userId = source.userId;

    console.log(`Message from user ${userId}: ${message.type}`);

    if (message.type === 'image') {
        try {
            console.log('Processing image message...');
            
            // Get image content from LINE
            const imageBuffer = await getImageContent(message.id);
            console.log('Image downloaded, size:', imageBuffer.length, 'bytes');

            // Read QR/barcodes from image
            const codes = await readQRCode(imageBuffer);

            let replyMessages;
            if (codes && codes.length > 0) {
                console.log('Codes detected:', codes);
                
                // Format response for multiple codes
                let responseText = '';
                if (codes.length === 1) {
                    responseText = `${codes[0].type} detected!\n\nContent: ${codes[0].data}`;
                } else {
                    responseText = `${codes.length} codes detected!\n\n`;
                    codes.forEach((code, index) => {
                        responseText += `${index + 1}. ${code.type}: ${code.data}\n`;
                    });
                }
                
                replyMessages = [{
                    type: 'text',
                    text: responseText
                }];
            } else {
                console.log('No QR codes or barcodes found in image');
                replyMessages = [{
                    type: 'text',
                    text: 'No QR codes or barcodes found in the image. Please make sure the code is clear and visible.'
                }];
            }

            // Reply with result
            await replyMessage(replyToken, replyMessages);

        } catch (error) {
            console.error('Error processing image:', error);
            await replyMessage(replyToken, [{
                type: 'text',
                text: 'Sorry, I encountered an error while processing your image. Please try again.'
            }]);
        }
    } else if (message.type === 'text') {
        // Handle text messages
        const text = message.text.toLowerCase();
        
        } else if (text.includes('hello') || text.includes('hi')) {
            await replyMessage(replyToken, [{
                type: 'text',
                text: 'Hello! Send me an image with a QR code or barcode and I\'ll read it for you! 📷📱'
            }]);
        } else if (text.includes('help')) {
            await replyMessage(replyToken, [{
                type: 'text',
                text: 'I can help you read QR codes and barcodes from images!\n\nJust send me a photo containing a QR code or barcode and I\'ll decode it for you. I support various formats including QR codes, UPC, EAN, Code128, and more!'
            }]);
        }
    }

app.get('/hook', async (req, res) => {
    //const body = req.body ;
    console.log(req.query.msgid) ;

    if (req.query.msgid) {
        console.log('Processing image message...');
            
            // Get image content from LINE
        let startTime = new Date() ;
        
        const imageBuffer = await getImageContent(req.query.msgid, 1);
        //console.log('Image downloaded, size:', imageBuffer.length, 'bytes');
        let endTime = new Date();
        let timeElapsed = endTime - startTime; // Difference in milliseconds
        console.log(`Time load img elapsed: ${timeElapsed} ms`);
        // Read QR code from image
        startTime = new Date() ;
        const codes = await readQRCode(imageBuffer);
            
        if (codes && codes.length === 1) {
            console.log('QR code detected:', codes[0].data);
            // Perform operations or execute code here

            let endTime = new Date();
            let timeElapsed = endTime - startTime; // Difference in milliseconds

            console.log(`Time read qr elapsed: ${timeElapsed} ms`);
            //let slipjson = '{"status":200,"data":{"payload":"004600060000010103002022520250816210339240054672085102TH9104D5EB","transRef":"2025081621033924005467208","date":"2025-08-16T21:03:39+07:00","countryCode":"","amount":{"amount":249,"local":{"amount":0,"currency":""}},"fee":0,"ref1":"","ref2":"","ref3":"","sender":{"bank":{"id":"002","name":"ธนาคารกรุงเทพ","short":"BBL"},"account":{"name":{"en":"PYSIT P"},"bank":{"type":"BANKAC","account":"086-0-xxx588"}}},"receiver":{"bank":{},"account":{"name":{"th":"นาย เศรษฐ ว","en":"SAGE"},"proxy":{"type":"MSISDN","account":"085-xxx-5894"}}}}}' ;
            //res.status(200).json({ status: 1, qr: codes[0].data });
            let slipjson = await getSlipInfo(codes[0].data)
            res.status(200).json(slipjson);
        } else {
            res.status(200).json({ status: 0});
            console.log('No QR code found in image');
        }
    } else {
         res.status(400).json({ status: 0});
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).send('Internal Server Error');
});

// Start server
app.listen(PORT, async () => {
    console.log(`LINE Webhook server running on port ${PORT}`);
    console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
    
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