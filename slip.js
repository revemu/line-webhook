const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const EASYSLIP_API_KEY = process.env.EASYSLIP_API_KEY || '196e73b3-6b1a-4a46-be07-5ef89dffa11b';

/**
 * Verify bank slip via EasySlip API v2 using QR Code payload.
 * @param {string} payload - QR Code payload string.
 * @returns {Promise<Object|null>} EasySlip API response object.
 */
async function verifyEasySlipByPayload(payload) {
    try {
        const response = await axios.post('https://api.easyslip.com/v2/verify/bank', {
            payload: payload
        }, {
            headers: {
                'Authorization': `Bearer ${EASYSLIP_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });
        return response.data;
    } catch (error) {
        if (error.response && error.response.data) {
            console.error('[EasySlip] Payload verification response:', error.response.data);
            return error.response.data;
        }
        console.error('[EasySlip] Payload verification error:', error.message);
        return null;
    }
}

/**
 * Verify bank slip via EasySlip API v2 using Image Buffer.
 * @param {Buffer} imageBuffer - Buffer of slip image.
 * @returns {Promise<Object|null>} EasySlip API response object.
 */
async function verifyEasySlipByImage(imageBuffer) {
    try {
        const response = await axios.post('https://api.easyslip.com/v2/verify/bank', {
            base64: imageBuffer.toString('base64')
        }, {
            headers: {
                'Authorization': `Bearer ${EASYSLIP_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 20000
        });
        return response.data;
    } catch (error) {
        if (error.response && error.response.data) {
            console.error('[EasySlip] Image verification response:', error.response.data);
            return error.response.data;
        }
        console.error('[EasySlip] Image verification error:', error.message);
        return null;
    }
}

/**
 * Parse EasySlip data object to extract sender, amount, recipient, and ownership details.
 * @param {Object} slipData - The `data` object inside EasySlip successful response.
 * @param {string} [defaultSenderName=''] - Fallback sender name if missing in slip.
 * @returns {Object|null} Formatted slip details object.
 */
function parseSlipDetails(slipData, defaultSenderName = '') {
    if (!slipData) return null;

    const raw = slipData.rawSlip || {};
    const recvDate = raw.transDate || raw.date;

    const senderName = raw.sender?.account?.name?.th ||
        raw.sender?.account?.name?.en ||
        raw.sender?.name ||
        defaultSenderName;

    const senderBank = raw.sender?.bank?.short || '';

    const amount = slipData.amountInSlip ?? (raw.amount?.amount);
    const amountStr = (amount !== undefined && amount !== null) ? Number(amount).toLocaleString('th-TH') : '0';

    const recipient = raw.receiver?.account?.name?.en || raw.receiver?.account?.name?.th || '';
    const recipient_th = raw.receiver?.account?.name?.th || '';
    const account = raw.receiver?.account?.proxy?.account || '';

    let recipientName = recipient;
    let slipToMe = false;

    if (account) {
        if (account.endsWith("5894") || (account.startsWith("006") && account.endsWith("3367"))) {
            recipientName = "Kyne";
            slipToMe = true;
        } else if ((recipient_th.includes("เศรษฐ") || recipientName.toUpperCase().includes("KTB G")) && account.endsWith("3367")) {
            recipientName = "Kyne";
            slipToMe = true;
        }
    }
    if (recipientName.includes("เศรษฐ") || recipientName.toUpperCase().includes("SAGE") || recipientName.toUpperCase().includes("SETH")) {
        slipToMe = true;
        recipientName = "Kyne";
    }

    return {
        rawSlip: raw,
        recvDate,
        senderName,
        senderBank,
        amount,
        amountStr,
        recipient,
        recipient_th,
        account,
        recipientName,
        slipToMe
    };
}

/**
 * Convenience function to verify a QR payload and return parsed slip details.
 * @param {string} payload - QR Code payload.
 * @param {string} [defaultSenderName=''] - Default sender name.
 * @returns {Promise<Object>} Verification result with `success`, `slipData`, `details`, and `error`.
 */
async function verifySlipPayload(payload, defaultSenderName = '') {
    const easySlipRes = await verifyEasySlipByPayload(payload);
    if (easySlipRes && easySlipRes.success === true) {
        const details = parseSlipDetails(easySlipRes.data, defaultSenderName);
        return {
            success: true,
            slipData: easySlipRes.data,
            details,
            response: easySlipRes
        };
    }
    return {
        success: false,
        slipData: null,
        details: null,
        error: easySlipRes ? easySlipRes.error : null,
        response: easySlipRes
    };
}

/**
 * Processes extracted slip data, determines log status & ownership, and formats summary header text.
 * @param {Object|null} slipData - EasySlip data payload.
 * @param {string} memberName - Name of the member who uploaded/sent the slip.
 * @param {Object} [options={}]
 * @param {boolean} [options.isDuplicate=false] - True if slip was already found in cache/DB.
 * @param {number} [options.memberDebt=0] - Current member debt amount.
 * @param {Function} [options.formatDateFn] - Function to format date string.
 * @returns {Object} { details, slipToMe, logStatus, header }
 */
function processSlipData(slipData, memberName, options = {}) {
    const { isDuplicate = false, memberDebt = 0, formatDateFn } = options;

    if (!slipData) {
        let header = `🙏 ${memberName} ได้รับสลิปโอนแล้ว \n\n`;
        header += `** 📝 ยังไม่พบข้อมูลการโอนในระบบที่เชื่อมกับธนาคาร ระบบจะบันทึกสลิปนี้ไว้เพื่อตรวจสอบอีกครั้งครับ บางครั้งข้อมูลจะล่าช้าประมาณ 2-3 นาทีหลังโอน ทำให้ระบบอาจจะยังตรวจสอบไม่พบ \n\nสามารถตรวจสอบสถานะได้ด้วยตัวเองอีกครั้ง ด้วยคำสั่ง /slip **`;
        let logStatus = 'noticed';
        if (isDuplicate) {
            header += `⚠️ สลิปนี้ถูกส่งมาแล้ว \n\n`;
            logStatus = 'duplicate';
        }
        return {
            details: null,
            slipToMe: true,
            logStatus,
            header
        };
    }

    const details = parseSlipDetails(slipData, memberName);
    const slipToMe = details.slipToMe;
    let logStatus = 'success';
    let header = `🙏 ${memberName} ได้รับสลิปโอนแล้ว **💰 ${details.amountStr} บาท**`;

    if (slipToMe) {
        if (isDuplicate) {
            header += `\n\n** สลิปนี้เคยส่งเข้ามาแล้ว **`;
            logStatus = 'duplicate';
        } else {
            logStatus = 'success';
        }
        if (details.amount !== undefined && memberDebt > 0 && Number(details.amount) > Number(memberDebt)) {
            header += `\n\n⚠️ ยอดโอนมากกว่าค่าสนาม \n`;
        }
    } else {
        header += `\n\n**📝 ไม่เกี่ยวกับค่าสนามบอล **`;
        logStatus = 'not_me';
    }

    const formattedDate = formatDateFn ? formatDateFn(details.recvDate) : (details.recvDate || '-');
    header += `\n\n💰 ยอดเงิน: ** ${details.amountStr} บาท **\n💸 โอนจาก: ** ${details.senderName}. - ${details.senderBank} **\n💵 ให้กับ: ** ${details.recipientName} **\n📅 วันที่: ** ${formattedDate} **\n`;

    return {
        details,
        slipToMe,
        logStatus,
        header
    };
}

/**
 * Processes payment slip verification & DB updates when an image contains a payment QR code.
 * @param {Object} params
 * @param {Object} params.event - LINE webhook message event
 * @param {Object} params.member - Member record
 * @param {Buffer} params.imageBuffer - Image buffer
 * @param {string} params.qrCode - Detected QR code payload
 * @param {Object} params.db - DB module reference
 * @param {Function} params.replyMessage - Reply message helper
 * @param {Function} params.getFormatDate - Date format helper
 * @returns {Promise<boolean>} Returns true if processed as payment slip, false if not a payment slip.
 */
async function processPaymentSlip({ event, member, imageBuffer, qrCode, db, replyMessage, getFormatDate, timing = {} }) {
    const { replyToken, message, source } = event;

    let isSlipValid = false;
    let slipData = null;
    let isDuplicate = false;
    let cachedSlipId = null;

    // 1. DB Cache Check Timer
    const tDbCacheStart = Date.now();
    const cachedSlip = await db.getSlipByQRCode(qrCode);
    const tDbCache = Date.now() - tDbCacheStart;

    // 2. EasySlip API Verification Timer
    let tEasySlip = 0;
    const tEasySlipStart = Date.now();
    if (cachedSlip) {
        if (cachedSlip.data) {
            console.log('[EasySlip] Slip verified from cache (duplicate)');
            slipData = cachedSlip.data;
            isSlipValid = true;
            isDuplicate = true;
        } else {
            console.log('[EasySlip] Slip found in cache but no JSON data, re-verifying via API...');
            cachedSlipId = cachedSlip.id;
            const easySlipRes = await verifyEasySlipByPayload(qrCode);
            if (easySlipRes && easySlipRes.success === true) {
                console.log('[EasySlip] Re-verification successful, updating existing record');
                slipData = easySlipRes.data;
                isSlipValid = true;
                isDuplicate = true;
            } else {
                if (easySlipRes && easySlipRes.error) {
                    console.warn(`[EasySlip] Re-verification failed: ${easySlipRes.error.code} - ${easySlipRes.error.message}`);
                }
                isSlipValid = true;
                isDuplicate = true;
            }
        }
        tEasySlip = Date.now() - tEasySlipStart;
    } else {
        const easySlipRes = await verifyEasySlipByPayload(qrCode);
        tEasySlip = Date.now() - tEasySlipStart;
        if (easySlipRes && easySlipRes.success === true) {
            console.log('[EasySlip] Slip verified successfully via payload:', easySlipRes.data);
            slipData = easySlipRes.data;
            isSlipValid = true;
        } else {
            if (easySlipRes && easySlipRes.error) {
                console.warn(`[EasySlip] Verification failed: ${easySlipRes.error.code} - ${easySlipRes.error.message}`);
            }
            if (!isSlipValid) {
                if (qrCode.includes("60000010103")) {
                    console.log('QR payload contains PromptPay identifier (60000010103), accepting slip as fallback.');
                    isSlipValid = true;
                }
            }
        }
    }

    if (!isSlipValid) {
        return false;
    }

    // 3. Disk File Saving & DB Log Timer
    const tSaveStart = Date.now();
    const imgSlipDir = path.join(__dirname, 'img', 'slip');
    try {
        await fs.mkdir(imgSlipDir, { recursive: true });
    } catch (e) { }
    const slipFileName = `slip_${Date.now()}_${message.id}.jpg`;
    const slipFilePath = path.join(imgSlipDir, slipFileName);
    const relativeSlipPath = `/img/slip/${slipFileName}`;
    await fs.writeFile(slipFilePath, imageBuffer);

    const processed = processSlipData(slipData, member.name, {
        isDuplicate,
        memberDebt: member.debt,
        formatDateFn: getFormatDate
    });
    const { details, slipToMe, logStatus, header } = processed;
    if (details) {
        console.log('[EasySlip] Slip data:', slipData?.rawSlip?.receiver);
        console.log('[EasySlip] Recipient:', details.recipient);
        console.log('[EasySlip] Recipient TH:', details.recipient_th);
        console.log('[EasySlip] Account:', details.account);
    }

    if (isDuplicate) {
        if (cachedSlipId && slipData) {
            await db.updateSlipLog(cachedSlipId, logStatus, slipData);
            console.log(`[EasySlip] Updated existing slip log (id: ${cachedSlipId}) with new API data`);
        }
        try {
            await fs.unlink(slipFilePath);
            console.log(`Deleted duplicate slip image: ${slipFilePath}`);
        } catch (e) {
            console.error('Error deleting duplicate slip image:', e);
        }
    } else {
        await db.logSlip(source.userId, member.name, relativeSlipPath, logStatus, qrCode, slipData);
    }
    const tSave = Date.now() - tSaveStart;

    // 4. DB Payment Week Query Timer
    const tDbWeekStart = Date.now();
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
        if (slipToMe && !isDuplicate) await db.updateMemberDebt(member.id);
        replyMessages = [{
            type: 'text',
            quoteToken: message.quoteToken,
            text: header
        }];
    } else {
        if (slipToMe && !isDuplicate) await db.updateMemberWeek(member.id, 1, 0);
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
    const tDbWeek = Date.now() - tDbWeekStart;

    // 5. LINE Reply Message Timer
    const tReplyStart = Date.now();
    await replyMessage(replyToken, replyMessages);
    const tReply = Date.now() - tReplyStart;

    // Overall Total Breakdown Output
    const tDownload = timing.tDownload || 0;
    const tQr = timing.tQr || 0;
    const tTotal = tDownload + tQr + tDbCache + tEasySlip + tSave + tDbWeek + tReply;

    const pct = (ms) => tTotal > 0 ? ((ms / tTotal) * 100).toFixed(1).padStart(5, ' ') : '  0.0';

    console.log(`\n==================== ⏱️ IMAGE PROCESSING BREAKDOWN ====================`);
    console.log(`📥 1. Download Image (LINE Server API) : ${String(tDownload).padStart(4, ' ')} ms (${pct(tDownload)}%)`);
    console.log(`🔍 2. QR Code Scanner (readQRCode)     : ${String(tQr).padStart(4, ' ')} ms (${pct(tQr)}%)`);
    console.log(`🗄️ 3. DB Cache Check                   : ${String(tDbCache).padStart(4, ' ')} ms (${pct(tDbCache)}%)`);
    console.log(`🌐 4. EasySlip Bank API Check          : ${String(tEasySlip).padStart(4, ' ')} ms (${pct(tEasySlip)}%)`);
    console.log(`💾 5. Save Slip File & DB Log          : ${String(tSave).padStart(4, ' ')} ms (${pct(tSave)}%)`);
    console.log(`📊 6. DB Payment Week Query            : ${String(tDbWeek).padStart(4, ' ')} ms (${pct(tDbWeek)}%)`);
    console.log(`💬 7. LINE Reply Message API           : ${String(tReply).padStart(4, ' ')} ms (${pct(tReply)}%)`);
    console.log(`----------------------------------------------------------------------`);
    console.log(`🏁 TOTAL PIPELINE TIME                 : ${String(tTotal).padStart(4, ' ')} ms (100.0%)`);
    console.log(`======================================================================\n`);

    return true;
}

module.exports = {
    EASYSLIP_API_KEY,
    verifyEasySlipByPayload,
    verifyEasySlipByImage,
    parseSlipDetails,
    verifySlipPayload,
    processSlipData,
    processPaymentSlip
};
