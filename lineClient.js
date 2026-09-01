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
 * Replies to a LINE event using SDK client with formatted error handling.
 * @param {string} replyToken 
 * @param {Object|Array} messages 
 * @returns {Promise<Object>}
 */
async function replyMessage(replyToken, messages) {
  const client = getLineClient();
  try {
    return await client.replyMessage(replyToken, messages);
  } catch (error) {
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
      console.error('LINE API Error Details:', JSON.stringify({ message: error.message || String(error) }, null, 2));
    }
    return null;
  }
}

module.exports = {
  config,
  getLineClient,
  fetchUserProfile,
  replyMessage
};
