const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const zbarimg = require('zbarimg');
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// LINE Bot configuration
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CUR_CHANNEL_ACCESS_TOKEN = process.env.CUR_CHANNEL_ACCESS_TOKEN

// Middleware to parse JSON and verify LINE signature
app.use('/webhook', express.raw({ type: 'application/json' }));

// Signature validation middleware
function validateSignature(req, res, next) {
    const signature = req.get('X-Line-Signature');
    if (!signature) {
        return res.status(400).send('Missing signature');
    }

    const body = req.body;
    const hash = crypto.createHmac('SHA256', CHANNEL_SECRET).update(body).digest('base64');

    if (hash !== signature) {
        return res.status(400).send('Invalid signature');
    }

    // Parse JSON after validation
    req.body = JSON.parse(body);
    next();
}

// Function to get image content from LINE
async function getImageContent(messageId, type = 0) {
    let access_token = CHANNEL_ACCESS_TOKEN ;
    if (type == 1) {
        access_token = CUR_CHANNEL_ACCESS_TOKEN ;
    }
    try {
        const response = await axios.get(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
            headers: {
                'Authorization': `Bearer ${access_token}`  
            },
            responseType: 'arraybuffer'
        });
        return Buffer.from(response.data);
    } catch (error) {
        console.error('Error getting image content:', error);
        throw error;
    }
}

// Function to read QR code from image buffer
async function readQRCode(imageBuffer) {
    let tempFilePath = null;
    try {
        // Create temporary file
        const tempDir = "./temp/"
        //await fs.mkdir(tempDir, { recursive: true });
        
        tempFilePath =  tempDir + `qr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg` ;
        
        // Write buffer to temporary file
        await fs.writeFile(tempFilePath, imageBuffer);
        
        // Use zbarimg to scan for codes
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
        console.error('Error reading QR/barcode:', error);
        return null;
    }
}

// Function to reply to LINE user
async function replyMessage(replyToken, messages) {
    try {
        await axios.post('https://api.line.me/v2/bot/message/reply', {
            replyToken: replyToken,
            messages: messages
        }, {
            headers: {
                'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error('Error replying message:', error);
    }
}

// Webhook endpoint
app.post('/webhook', validateSignature, async (req, res) => {
    const events = req.body.events;

    // Process each event
    for (const event of events) {
        console.log('Received event:', event.type);

        if (event.type === 'message') {
            await handleMessage(event);
        }
    }

    res.status(200).send('OK');
});

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

            // Read QR code from image
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
        
        if (text.includes('hello') || text.includes('hi')) {
            await replyMessage(replyToken, [{
                type: 'text',
                text: 'Hello! Send me an image with a QR code and I\'ll read it for you! 📷'
            }]);
        } else if (text.includes('help')) {
            await replyMessage(replyToken, [{
                type: 'text',
                text: 'I can help you read QR codes from images!\n\nJust send me a photo containing a QR code and I\'ll decode it for you. Make sure the QR code is clearly visible in the image.'
            }]);
        }
    }
}

// Health check endpoint
app.get('/webhook', async (req, res) => {
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
            res.status(200).json({ status: 1, qr: codes[0].data });
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
app.listen(PORT, () => {
    console.log(`LINE Webhook server running on port ${PORT}`);
    console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
    
    // Check if environment variables are set
    if (!CHANNEL_SECRET || !CHANNEL_ACCESS_TOKEN) {
        console.warn('⚠️  Warning: LINE_CHANNEL_SECRET and LINE_CHANNEL_ACCESS_TOKEN environment variables are not set');
        console.log('Please set these environment variables before using the bot');
    } else {
        console.log('✅ LINE Bot credentials loaded successfully');
    }
});

module.exports = app;