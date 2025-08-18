const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const jimp = require('jimp');
const jsQR = require('jsqr');

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
async function getImageContent(messageId) {
    
    try {
        const response = await axios.get(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
            headers: {
                //'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`
                'Authorization': `Bearer ${CUR_CHANNEL_ACCESS_TOKEN}`  
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
    try {
        
        const image = await jimp.Jimp.read(imageBuffer);
        const { data, width, height } = image.bitmap;
        
        // Convert RGBA to RGB for jsQR
        const rgbData = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < data.length; i += 4) {
            rgbData[i] = data[i];     // R
            rgbData[i + 1] = data[i + 1]; // G
            rgbData[i + 2] = data[i + 2]; // B
            rgbData[i + 3] = data[i + 3]; // A
        }

        const qrCode = jsQR(rgbData, width, height);
        return qrCode ? qrCode.data : null;
    } catch (error) {
        console.error('Error reading QR code:', error);
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
            const qrData = await readQRCode(imageBuffer);

            let replyMessages;
            if (qrData) {
                console.log('QR code detected:', qrData);
                replyMessages = [{
                    type: 'text',
                    text: `QR Code detected!\n\nContent: ${qrData}`
                }];
            } else {
                console.log('No QR code found in image');
                replyMessages = [{
                    type: 'text',
                    text: 'No QR code found in the image. Please make sure the QR code is clear and visible.'
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
        
        const imageBuffer = await getImageContent(req.query.msgid);
        console.log('Image downloaded, size:', imageBuffer.length, 'bytes');
        console.log(`Time load img elapsed: ${timeElapsed} ms`);
        // Read QR code from image
        const qrData = await readQRCode(imageBuffer);

        if (qrData) {
            console.log('QR code detected:', qrData);
            // Perform operations or execute code here

            let endTime = new Date();
            let timeElapsed = endTime - startTime; // Difference in milliseconds

            console.log(`Time total elapsed: ${timeElapsed} ms`);
            res.status(200).json({ status: 'OK', qr: qrData });
        } else {
            console.log('No QR code found in image');
        }
    } else {
         res.status(400).json({ status: 'failed'});
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