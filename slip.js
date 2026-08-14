const axios = require('axios');

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

module.exports = {
    EASYSLIP_API_KEY,
    verifyEasySlipByPayload,
    verifyEasySlipByImage,
    parseSlipDetails,
    verifySlipPayload
};
