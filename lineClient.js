const fs = require('fs');
const path = require('path');
const { Client } = require('@line/bot-sdk');
require('dotenv').config({ quiet: true });

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.CUR_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || '',
};

let clientInstance = null;

/**
 * Returns the singleton LINE SDK Client instance.
 * @returns {Client}
 */
function getLineClient() {
  if (!clientInstance) {
    clientInstance = new Client(config);
  }
  return clientInstance;
}

/**
 * Fetches member profile from LINE API with group profile fallback.
 * @param {string} userId - LINE User ID
 * @param {string|null} [groupId=null] - LINE Group ID
 * @returns {Promise<Object|null>}
 */
async function fetchUserProfile(userId, groupId = null) {
  const client = getLineClient();
  if (!userId) return null;

  if (groupId) {
    try {
      return await client.getGroupMemberProfile(groupId, userId);
    } catch (groupErr) {
      console.warn(`[lineClient] getGroupMemberProfile failed for ${userId} in group ${groupId}: ${groupErr.message}. Trying direct profile...`);
    }
  }

  try {
    return await client.getProfile(userId);
  } catch (err) {
    console.error(`[lineClient] getProfile failed for ${userId}:`, err.message);
    return null;
  }
}

/**
 * Recursively sanitizes and validates Flex Message components to strictly adhere to LINE Messaging API requirements.
 * Fixes empty text fields, invalid borderWidths, invalid image URLs, and removes empty boxes/headers.
 */
function sanitizeFlexComponent(node, parentBox = null) {
  if (!node || typeof node !== 'object') return node;

  if (Array.isArray(node)) {
    return node.map(child => sanitizeFlexComponent(child, parentBox)).filter(Boolean);
  }

  const result = { ...node };

  // 1. Text Component
  if (result.type === 'text') {
    if (result.text === undefined || result.text === null || String(result.text).trim() === '') {
      result.text = ' ';
    } else {
      result.text = String(result.text);
    }
    if (result.weight && !['regular', 'bold'].includes(result.weight)) {
      result.weight = 'regular';
    }
    if (result.color && typeof result.color === 'string' && !result.color.startsWith('#') && result.color !== 'transparent') {
      delete result.color;
    }
  }

  // 2. Image / Icon Component
  if (result.type === 'image' || result.type === 'icon') {
    let url = result.url;
    if (!url || typeof url !== 'string' || url.trim() === '' || url.toLowerCase() === 'none') {
      return null;
    }
    url = url.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      const baseUrl = global.baseWebhookUrl || "https://api.revemu.org";
      url = url.startsWith('/') ? `${baseUrl}${url}` : `${baseUrl}/${url}`;
    }
    if (url.startsWith('http://')) {
      url = url.replace('http://', 'https://');
    }
    try {
      url = encodeURI(url);
    } catch (e) {}
    result.url = url;

    // If parent box has explicit width/height, remove aspectRatio to prevent conflicting constraints
    if (parentBox && (parentBox.width || parentBox.height)) {
      delete result.aspectRatio;
    }
  }

  // 3. Box Component
  if (result.type === 'box') {
    if (result.borderWidth) {
      if (!['none', 'xs', 'sm', 'md', 'lg', 'xl', 'semi-bold', 'bold'].includes(result.borderWidth)) {
        result.borderWidth = 'sm';
      }
      if (!result.borderColor || typeof result.borderColor !== 'string' || result.borderColor.trim() === '' || result.borderColor === '#00000000' || result.borderColor.toLowerCase() === 'transparent') {
        delete result.borderWidth;
        delete result.borderColor;
      }
    } else if (result.borderColor === '#00000000' || (typeof result.borderColor === 'string' && result.borderColor.toLowerCase() === 'transparent')) {
      delete result.borderColor;
    }

    if (result.alignItems && !['flex-start', 'center', 'flex-end'].includes(result.alignItems)) {
      delete result.alignItems;
    }
    if (result.justifyContent && !['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'].includes(result.justifyContent)) {
      delete result.justifyContent;
    }
    if (Array.isArray(result.contents)) {
      result.contents = result.contents.map(child => sanitizeFlexComponent(child, result)).filter(Boolean);
      if (result.contents.length === 0) {
        return null;
      }
    }
  }

  // 4. Bubble Container
  if (result.type === 'bubble') {
    if (result.header) {
      result.header = sanitizeFlexComponent(result.header);
      if (!result.header || (result.header.contents && result.header.contents.length === 0)) {
        delete result.header;
      }
    }
    if (result.hero) {
      result.hero = sanitizeFlexComponent(result.hero);
      if (!result.hero) delete result.hero;
    }
    if (result.body) {
      result.body = sanitizeFlexComponent(result.body);
      if (!result.body) delete result.body;
    }
    if (result.footer) {
      result.footer = sanitizeFlexComponent(result.footer);
      if (!result.footer) delete result.footer;
    }
  }

  // 5. Root Flex Message Object
  if (result.type === 'flex') {
    if (!result.altText || typeof result.altText !== 'string' || result.altText.trim() === '') {
      result.altText = 'LINE Notification';
    }
    if (result.contents) {
      result.contents = sanitizeFlexComponent(result.contents);
    }
  }

  return result;
}

/**
 * Replies to a LINE event using SDK client with formatted error handling.
 * @param {string} replyToken 
 * @param {Object|Array} messages 
 * @returns {Promise<Object>}
 */
async function replyMessage(replyToken, messages) {
  const client = getLineClient();
  const sanitizedMessages = sanitizeFlexComponent(messages);

  try {
    const jsonStr = JSON.stringify(sanitizedMessages, null, 2);
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const logFile = path.join(tempDir, 'latest_flex.json');
    fs.writeFileSync(logFile, jsonStr, 'utf8');
  } catch (fsErr) {}

  try {
    return await client.replyMessage(replyToken, sanitizedMessages);
  } catch (error) {
    console.error('Error replying message:', error);
    let details = null;
    if (error.response && error.response.data) {
      details = error.response.data;
    } else if (error.originalError && error.originalError.response && error.originalError.response.data) {
      details = error.originalError.response.data;
    } else if (error.data) {
      details = error.data;
    }
    if (details) {
      console.error('LINE API Error Details:', JSON.stringify(details, null, 2));
    } else {
      console.error('Full Error Object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    }
    throw error;
  }
}

module.exports = {
  config,
  getLineClient,
  fetchUserProfile,
  replyMessage
};
