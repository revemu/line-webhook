const db = require('./query');
const flex = require('./flex');
const qrGen = require('./qr_gen');
const axios = require('axios');
const slipService = require('./slip');
const { getNextSaturday } = require('./utils/date');

const ADMIN_RESTRICTED_COMMANDS = new Set(['qr', 'slip', 'sliplist', 'verify']);
const MENTION_COMMANDS = new Set(['+1', '-1', '+pay', '-pay', '+pay2', '+team1', '+team2', '+team3', '+team4', '-team', 'setrank', 'setdebt', 'autoreg', '+autoreg', '-autoreg', 'stat', 'mystat', 'me', 'my']);
const WEEK_CHECK_SKIP = new Set(['+1', '-1', 'autoreg', '+autoreg', '-autoreg', 'stat', 'mystat', 'me', 'my', 'setrank', 'setdebt']);

function parseCommandString(cmdStr) {
    const pos = cmdStr.indexOf(' ');
    return {
        cmd: (pos > 0 ? cmdStr.substring(0, pos) : cmdStr).trim(),
        param: (pos > 0 ? cmdStr.substring(pos) : '').trim()
    };
}

function extractTrailingInt(param) {
    const parts = param.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
        const possibleVal = parts.pop();
        const parsed = parseInt(possibleVal, 10);
        if (!Number.isNaN(parsed)) {
            return { value: parsed, param: parts.join(' ').trim() };
        }
    }
    return { value: 0, param };
}

function formatTextReply(text, quoteToken) {
    return [{
        type: 'text',
        quoteToken,
        text
    }];
}

function formatFlexReply(contents, altText) {
    return {
        type: 'flex',
        altText,
        contents
    };
}

function formatTextV2Reply(text, quoteToken, substitution) {
    const payload = {
        type: 'textV2',
        quoteToken,
        text
    };
    if (substitution) payload.substitution = substitution;
    return payload;
}

function formatTextV2ReplyWithoutQuote(text, substitution) {
    const payload = {
        type: 'textV2',
        text
    };
    if (substitution) payload.substitution = substitution;
    return payload;
}

function buildReply({ type, text, quoteToken, substitution, altText, contents }) {
    if (!text && !contents) return;
    switch (type) {
        case 0:
            return formatTextReply(text, quoteToken);
        case 1:
            return formatFlexReply(contents, altText);
        case 2:
            return formatTextV2Reply(text, quoteToken, substitution);
        case 3:
            return formatTextV2ReplyWithoutQuote(text, substitution);
        default:
            return;
    }
}

// Command registry for incremental refactor: map command -> async handler(context)
// Handlers should return a reply (array/object) when they want to short-circuit,
// or `undefined` to allow the legacy switch-based fallback to run.
const COMMAND_REGISTRY = {
    // Example scaffolding (fill in handlers as we convert cases):
    // 'setmaxweek': async (context) => { /* ... */ },
    'setmaxweek': async (context) => {
        const { param, quoteToken, is_flex, groupId } = context;
        let msg = '';
        let sub = null;
        let altText;

        if (param == "") {
            msg = "Please enter max number";
            return [{ type: 'text', quoteToken: quoteToken, text: msg }];
        }

        await db.updateMaxNumberWeek(Number(param));

        const result = await db.getMemberWeek0(1, is_flex, groupId);
        // db.getMemberWeek0 returns [msg, sub, altText] in the legacy code
        if (Array.isArray(result) && result.length > 0) {
            msg = result[0];
            sub = result[1];
            altText = result[2];
        } else {
            msg = result;
        }

        if (is_flex && typeof msg === 'object') {
            return {
                type: 'flex',
                altText: altText || "ลงชื่อเตะบอล",
                contents: msg
            };
        } else {
            return {
                type: 'textV2',
                quoteToken: quoteToken,
                text: msg,
                substitution: sub
            };
        }
    },
    'removereserve': async (context) => {
        const { quoteToken, is_flex, groupId } = context;
        const result = await db.removeReserveMembers();
        if (result.success) {
            const infoText = result.count > 0
                ? `ลบรายชื่อสำรองสำเร็จ! (${result.count} คน: ${result.names.join(', ')})`
                : `ไม่มีรายชื่อสำรองในสัปดาห์นี้ครับ`;

            const [flexMsg, sub, altTextStr] = await db.getMemberWeek0(1, is_flex, groupId);
            if (is_flex && typeof flexMsg === 'object') {
                return [
                    { type: 'text', quoteToken: quoteToken, text: infoText },
                    { type: 'flex', altText: altTextStr || "ลงชื่อเตะบอล", contents: flexMsg }
                ];
            } else {
                return [
                    { type: 'text', quoteToken: quoteToken, text: infoText },
                    { type: 'text', quoteToken: quoteToken, text: flexMsg }
                ];
            }
        } else {
            return [{ type: 'text', quoteToken: quoteToken, text: `เกิดข้อผิดพลาด: ${result.message}` }];
        }
    },
    'delreserve': async (context) => COMMAND_REGISTRY['removereserve'](context),
    'x1': async (context) => {
        const { member_id } = context;
        await db.registerNY(member_id);
        const msg = await db.getMemberNY();
        return [{ type: 'text', text: msg }];
    },
    '+2': async (context) => {
        const [msg, sub] = await db.getDebtList(0);
        return { type: 'textV2', text: msg, substitution: sub };
    },
    '+1': async (context) => {
        const { member_id, member_name, is_flex, groupId, quoteToken } = context;
        let msg = '';
        let sub = null;
        let altText;

        const activeWeek = await db.queryWeekDate(0);
        if (activeWeek && activeWeek.length > 0) {
            const rawDate = new Date(activeWeek[0].date);
            const y = rawDate.getFullYear();
            const m = ('0' + (rawDate.getMonth() + 1)).slice(-2);
            const d = ('0' + rawDate.getDate()).slice(-2);
            const dateStr = `${y}-${m}-${d}`;
            const weekDate = new Date(`${dateStr}T19:00:00+07:00`);
            if (new Date() >= weekDate) {
                const theme = await db.getTheme();
                const registerTpl = await db.getTemplate('register', 'header');
                const registerImageUrl = registerTpl ? registerTpl.url : null;
                msg = flex.buildRegisterClosedFlex(theme, registerImageUrl);
                altText = "ระบบปิดรับลงชื่อแล้ว";
                return { type: 'flex', altText, contents: msg };
            }
        }

        const reg_res2 = await db.registerMember(member_id, member_name);
        if (reg_res2 == 1) {
            // already registered
        } else if (reg_res2 > 1) {
            return [{ type: 'text', quoteToken: quoteToken, text: `ขออภัย ${member_name} ยังมียอดค้าง ${reg_res2}บาท!` }];
        }
        [msg, sub, altText] = await db.getMemberWeek0(1, is_flex, groupId);
        if (is_flex && typeof msg === 'object') {
            return { type: 'flex', altText: altText || "ลงชื่อเตะบอล", contents: msg };
        } else {
            return { type: 'textV2', quoteToken, text: msg, substitution: sub };
        }
    },
    '-1': async (context) => {
        const { member_id, member_name, is_flex, groupId } = context;
        await db.unregisterMember(member_id).then(async (unregResult) => {
            if (unregResult.success) {
                if (unregResult.team_id != 1) {
                    await db.updateMemberAutoReg(member_id, 0);
                }
            }
        });
        const [msg, sub, altText] = await db.getMemberWeek0(1, is_flex, groupId);
        if (is_flex && typeof msg === 'object') {
            return { type: 'flex', altText: altText || "ลงชื่อเตะบอล", contents: msg };
        } else {
            return { type: 'textV2', text: msg, substitution: sub };
        }
    },
    '+pay2': async (context) => {
        const { member_id } = context;
        await db.updateMemberWeek(member_id, 1, 0);
        const [msg, sub] = await db.getMemberWeek2(0);
        return { type: 'textV2', text: msg, substitution: sub };
    },
    '+pay': async (context) => {
        const { member_id, quoteToken } = context;
        await db.updateMemberWeek(member_id, 1, 0);
        let count = 0;
        const [msg, sub, cnt] = await db.getMemberWeek2(0);
        count = cnt || 0;
        if (count > 0 && count < 21) return { type: 'textV2', quoteToken, text: msg, substitution: sub };
        return [{ type: 'text', quoteToken, text: msg }];
    },
    '-pay': async (context) => {
        const { is_mention, member_id } = context;
        if (is_mention) {
            await db.updateMemberWeek(member_id, 0, 0);
            const msg = await db.getMemberWeek(0);
            return [{ type: 'text', text: msg }];
        }
    },
    '-team': async (context) => ({ type: 'text', text: `พิมพ์ +team1(-4) ได้เลย ไม่ต้อง -team` }),
    '+team1': async (context) => COMMAND_REGISTRY['+teamN'] ? COMMAND_REGISTRY['+teamN'](context) : undefined,
    '+team2': async (context) => COMMAND_REGISTRY['+teamN'] ? COMMAND_REGISTRY['+teamN'](context) : undefined,
    '+team3': async (context) => COMMAND_REGISTRY['+teamN'] ? COMMAND_REGISTRY['+teamN'](context) : undefined,
    '+team4': async (context) => COMMAND_REGISTRY['+teamN'] ? COMMAND_REGISTRY['+teamN'](context) : undefined,
    '+teamN': async (context) => {
        const { cmd, is_mention, member_id, member_name, groupId } = context;
        if (is_mention) {
            let team_num = Number(cmd.slice(-1)) - 1;
            let week = await db.queryWeekID(0);
            let team_colors = await db.getTeamColorWeek(week[0].id);
            await db.updateMemberWeek(member_id, team_colors[team_num].id, 1);
            return [{ type: 'text', text: `${member_name} อยู่ทีม ${team_colors[team_num].color}` }];
        } else {
            return [{ type: 'text', text: `ต้องระบุชื่อสมาชิกด้วย` }];
        }
    },
    'resetteam': async () => { await db.resetMemberTeam(); return [{ type: 'text', text: `ปรับให้ทุกคนไม่มีทีมแล้ว` }]; },
    'randomteam': async (context) => {
        const dow = (new Date()).getDay();
        if (dow >= 0) {
            const team_res = await db.addTeamMemberWeek();
            if (team_res == 0) {
                const week = await db.queryWeekID(0);
                const msg = await db.getTeamWeek(week[0].id, context.groupId);
                return { type: 'flex', altText: `Team Week - ${week[0].date}`, contents: msg };
            } else if (team_res == 1) {
                return [{ type: 'text', text: "ทำการสุ่มไปแล้วใช้ /teamweek เพื่อดูทีม" }];
            } else if (team_res == 2) {
                return [{ type: 'text', text: "ยังไม่ได้ถูกจัดกลุ่มเพื่อสุ่ม" }];
            }
        }
        return [{ type: 'text', text: "ยังไม่ได้ถูกจัดกลุ่มเพื่อสุ่ม" }];
    },
    'teamweek': async (context) => {
        const week = await db.queryWeekID(0);
        if (week && week.length > 0) {
            const msg = await db.getTeamWeek(week[0].id, context.groupId);
            if (msg) return { type: 'flex', altText: `Team Week - ${week[0].date}`, contents: msg };
            return [{ type: 'text', text: "ยังไม่มีข้อมูลทีมในสัปดาห์นี้" }];
        }
        return [{ type: 'text', text: "ยังไม่มีข้อมูลสัปดาห์นี้" }];
    },
    'matchweek': async (context) => {
        const week = await db.queryWeekID(0);
        if (week && week.length > 0) {
            const msg = await db.getMatchWeek(week[0].id, context.groupId);
            if (msg) return { type: 'flex', altText: `Match Week - ${week[0].date}`, contents: msg };
            return [{ type: 'text', text: "ยังไม่มีข้อมูลแมตช์ในสัปดาห์นี้" }];
        }
        return [{ type: 'text', text: "ยังไม่มีข้อมูลสัปดาห์นี้" }];
    },
    'tableweek': async () => ({ type: 'text', text: "แสดงตารางใน /matchweek แทนแล้ว" }),
    'topscorer': async () => ({ type: 'text', text: "ให้ใช้ /top แทน" }),
    'topassist': async () => ({ type: 'text', text: "ให้ใช้ /top แทน" }),
    'setrank': async (context) => {
        const { is_mention, member_id, rank_val, member_name } = context;
        if (is_mention) { await db.updateMemberRank(member_id, rank_val); return [{ type: 'text', text: `ปรับระดับ (rank) ของ ${member_name} เป็น ${rank_val} เรียบร้อยครับ` }]; }
        return [{ type: 'text', text: `กรุณาระบุชื่อสมาชิก: /setrank @ชื่อสมาชิก ระดับ` }];
    },
    'setdebt': async (context) => {
        const { is_mention, member_id, debt_val, member_name } = context;
        if (is_mention) { await db.setMemberDebt(member_id, debt_val); return [{ type: 'text', text: `ตั้งยอดค้างของ ${member_name} เป็น ${debt_val} บาท เรียบร้อยครับ` }]; }
        return [{ type: 'text', text: `กรุณาระบุชื่อสมาชิก: /setdebt @ชื่อสมาชิก จำนวนเงิน` }];
    },
    'theme': async (context) => {
        const { param } = context;
        if (param === 'black' || param === 'white') { await db.setTheme(param); return [{ type: 'text', text: `เปลี่ยนธีมเป็น ${param} เรียบร้อยครับ` }]; }
        return [{ type: 'text', text: `กรุณาระบุธีม: /theme black หรือ /theme white` }];
    },
    'setcost': async (context) => {
        const { param } = context;
        if (param === "") return [{ type: 'text', text: "กรุณาระบุค่าสนามทั้งหมด เช่น /setcost 3300" }];
        const totalCost = parseInt(param, 10);
        if (isNaN(totalCost) || totalCost <= 0) return [{ type: 'text', text: "กรุณาระบุค่าสนามเป็นตัวเลขที่มากกว่า 0" }];
        const result = await db.setWeekCost(totalCost);
        if (result.success) {
            return [{ type: 'text', text: `ตั้งค่าค่าสนามสำเร็จ!\nยอดรวม: ${totalCost} บาท\nสมาชิกลงชื่อ: ${result.count} คน\nเฉลี่ยคนละ: ${result.sharedFee} บาท\nบันทึกยอดค้างชำระเรียบร้อยแล้ว` }];
        }
        return [{ type: 'text', text: `เกิดข้อผิดพลาด: ${result.message}` }];
    },
    'resetdebt': async () => {
        const result = await db.resetWeekDebt();
        if (result.success) return [{ type: 'text', text: `รีเซ็ตยอดค้างชำระของสมาชิกทุกคนในสัปดาห์นี้เรียบร้อยครับ\nสมาชิกลงชื่อที่ถูกรีเซ็ต: ${result.count} คน` }];
        return [{ type: 'text', text: `เกิดข้อผิดพลาด: ${result.message}` }];
    },
    'resetcost': async (context) => COMMAND_REGISTRY['resetdebt'](context),
    'qr': async (context) => {
        const { param, groupId, quoteToken } = context;
        const week = await db.queryWeekID(0);
        let amount = 0;
        if (param !== "") {
            amount = parseInt(param, 10);
            if (isNaN(amount) || amount < 0) return [{ type: 'text', quoteToken, text: "กรุณาระบุจำนวนเงินเป็นตัวเลข เช่น /qr 150" }];
        } else {
            if (!week || week[0].cost <= 0) return [{ type: 'text', quoteToken, text: "ยังไม่ได้คำนวณค่าสนามในสัปดาห์นี้ครับ" }];
            amount = week[0].cost;
        }
        try {
            const filename = await qrGen.generateQrCode(amount, '006990146713367');
            let baseUrl = global.baseWebhookUrl || "https://api.revemu.org";
            if (baseUrl.startsWith('http://')) baseUrl = baseUrl.replace('http://', 'https://');
            const localQrUrl = `${baseUrl}/img/qr/${filename}`;
            const theme = await db.getTheme();
            const msg = flex.buildQrFlex(amount, '0850705894', theme, localQrUrl);
            const altText = `สแกน QR ชำระเงิน ${amount} บาท`;
            return { type: 'flex', altText, contents: msg };
        } catch (qrErr) {
            return [{ type: 'text', text: `เกิดข้อผิดพลาดในการสร้าง QR Code: ${qrErr.message}` }];
        }
    },
    'showautoreg': async (context) => { context.param = 'list'; return COMMAND_REGISTRY['autoreg'](context); },
    'whoautoreg': async (context) => { context.param = 'list'; return COMMAND_REGISTRY['autoreg'](context); },
    'autoregshow': async (context) => { context.param = 'list'; return COMMAND_REGISTRY['autoreg'](context); },
    'autoreglist': async (context) => { context.param = 'list'; return COMMAND_REGISTRY['autoreg'](context); },
    'autoreg': async (context) => {
        const { param, groupId, member_id, member_name } = context;
        const theme = await db.getTheme();
        const autoregTpl = await db.getTemplate('autoreg', 'header');
        const autoregImageUrl = autoregTpl ? autoregTpl.url : null;
        if (param.toLowerCase() === 'list') {
            const list = await db.getAutoRegList(groupId);
            const msg = flex.buildAutoRegFlex('list', null, list, theme, autoregImageUrl);
            return { type: 'flex', altText: "สมาชิกลงชื่ออัตโนมัติ", contents: msg };
        }
        const list = await db.getAutoRegList(groupId);
        const isAlreadyRegistered = list.some(m => m.id === member_id);
        if (isAlreadyRegistered) {
            const memberInfo = await db.getMemberDisplayInfo(member_id, groupId);
            const msg = flex.buildAutoRegFlex('already', memberInfo, list, theme, autoregImageUrl);
            return { type: 'flex', altText: `ลงชื่ออัตโนมัติอยู่แล้ว: ${member_name}`, contents: msg };
        }
        if (list.length >= 24) {
            const msg = flex.buildAutoRegFlex('full', null, list, theme, autoregImageUrl);
            return { type: 'flex', altText: "รายชื่อลงชื่อออโต้เต็มแล้ว", contents: msg };
        }
        await db.updateMemberAutoReg(member_id, 1);
        const memberInfo = await db.getMemberDisplayInfo(member_id, groupId);
        const updatedList = await db.getAutoRegList(groupId);
        const msg = flex.buildAutoRegFlex('add', memberInfo, updatedList, theme, autoregImageUrl);
        return { type: 'flex', altText: `สมัครลงชื่ออัตโนมัติสำเร็จ: ${member_name}`, contents: msg };
    },
    '-autoreg': async (context) => {
        const { member_id, member_name, groupId } = context;
        const theme = await db.getTheme();
        const autoregTpl = await db.getTemplate('autoreg', 'header');
        const autoregImageUrl = autoregTpl ? autoregTpl.url : null;
        await db.updateMemberAutoReg(member_id, 0);
        const memberInfo = await db.getMemberDisplayInfo(member_id, groupId);
        const list = await db.getAutoRegList(groupId);
        const msg = flex.buildAutoRegFlex('remove', memberInfo, list, theme, autoregImageUrl);
        return { type: 'flex', altText: `ยกเลิกลงชื่ออัตโนมัติสำเร็จ: ${member_name}`, contents: msg };
    },
    'stat': async (context) => {
        const { member_id, groupId } = context;
        const theme = await db.getTheme();
        const statTpl = await db.getTemplate('stat', 'header');
        const statsImageUrl = statTpl ? statTpl.url : null;
        const statsData = await db.getMemberStats(member_id, groupId);
        if (statsData) return { type: 'flex', altText: `สถิติส่วนตัวของ ${statsData.member.name}`, contents: flex.buildMemberStatsFlex(statsData, theme, statsImageUrl) };
        return [{ type: 'text', text: "ไม่พบข้อมูลสถิติของสมาชิกท่านนี้" }];
    },
    'mystat': async (context) => COMMAND_REGISTRY['stat'](context),
    'me': async (context) => COMMAND_REGISTRY['stat'](context),
    'my': async (context) => COMMAND_REGISTRY['stat'](context),
    'bottom': async (context) => {
        const limit = context.param != '' ? Number(context.param) : 30;
        await db.updateHof();
        const stats = await Promise.all([ db.getTopStat(limit, 5), db.getTopStat(limit, 2) ]);
        const carousel = flex.tpl_carousel; carousel.contents = stats.filter(x => x !== null && x !== undefined);
        return { type: 'flex', altText: `ทำเนียบซึมเศร้าประจำปี (${new Date().getFullYear()})`, contents: carousel };
    },
    'testbottom': async (context) => COMMAND_REGISTRY['bottom'](context),
    'menu': async (context) => {
        const theme = await db.getTheme();
        const week = await db.queryWeekID(0);
        const dateStr = week.length > 0 ? week[0].date : '';
        const autoRegCount = await db.getAutoRegCount();
        const msg = flex.buildMenuFlex(dateStr, theme, null, autoRegCount);
        return { type: 'flex', altText: "เมนูบริการของบอท", contents: msg };
    },
    'newweek': async (context) => { const next_sat = getNextSaturday(); await db.newWeek(next_sat); return COMMAND_REGISTRY['register'](context); },
    'register': async (context) => { const { is_flex, groupId } = context; const [msg, sub, altText] = await db.getMemberWeek0(1, is_flex, groupId); if (is_flex && typeof msg === 'object') return { type: 'flex', altText: altText || "ลงชื่อเตะบอล", contents: msg }; return { type: 'textV2', text: msg, substitution: sub }; },
    'join': async (context) => COMMAND_REGISTRY['register'](context),
    'play': async (context) => COMMAND_REGISTRY['register'](context),
    'ลงชื่อ': async (context) => COMMAND_REGISTRY['register'](context),
    'reg': async (context) => COMMAND_REGISTRY['register'](context),
    'schedule': async (context) => {
        const { param, groupId } = context;
        const theme = await db.getTheme();
        const args = param.split(/\s+/).filter(Boolean);
        let startTime = '17:00';
        let endTime = null;
        let matchDuration = 8;
        if (args.length > 0) startTime = args[0];
        if (args.length > 1) {
            if (args[1].includes(':') || args[1].includes('.')) endTime = args[1];
            else matchDuration = parseInt(args[1], 10) || 8;
        }
        if (args.length > 2) {
            if (args[2].includes(':') || args[2].includes('.')) endTime = args[2];
            else matchDuration = parseInt(args[2], 10) || 8;
        }
        const [schedText, schedJson] = await db.getScheduleText(startTime, matchDuration, 1, 3, endTime);
        if (schedJson) return { type: 'flex', altText: `⚽ ตารางแข่งขัน เสาร์ที่ ${schedJson.date}`, contents: flex.buildScheduleFlex(schedJson, theme) };
        return [{ type: 'text', text: schedText }];
    },
    'now': async (context) => {
        const { groupId } = context;
        const theme = await db.getTheme();
        const matchInfo = await db.getCurrentMatch(groupId);
        if (!matchInfo) return [{ type: 'text', text: 'ยังไม่มีตารางแข่งขัน ใช้คำสั่ง /schedule ก่อนนะครับ' }];
        const cur = matchInfo.currentMatch;
        if (!cur) return [{ type: 'text', text: 'ยังไม่มีข้อมูลแมตช์ปัจจุบัน' }];
        return { type: 'flex', altText: `⚽ แมตช์ปัจจุบัน [${cur.matchNo}] ${cur.teamA} vs ${cur.teamB}`, contents: flex.buildNowFlex(matchInfo, theme) };
    },
    'live': async (context) => {
        const { groupId } = context;
        const theme = await db.getTheme();
        const matchInfo = await db.getCurrentMatch(groupId);
        if (!matchInfo || !matchInfo.sched) return [{ type: 'text', text: 'ยังไม่มีตารางแข่งขัน ใช้คำสั่ง /schedule ก่อนนะครับ' }];
        const cur = matchInfo.currentMatch;
        return { type: 'flex', altText: `⚽ Live! Match ${cur ? `[${cur.matchNo}] ${cur.teamA} vs ${cur.teamB}` : ''}`, contents: flex.buildLiveFlex(matchInfo, theme) };
    },
    'top': async (context) => {
        const limit = context.param != '' ? Number(context.param) : 30;
        await db.updateHof();
        const stats = await Promise.all([ db.getTopStat(limit, 0), db.getTopStat(limit, 1), db.getTopStat(limit, 4), db.getTopStat(limit, 6) ]);
        const carousel = flex.tpl_carousel; carousel.contents = stats.filter(x => x !== null && x !== undefined);
        return { type: 'flex', altText: `Top ${limit} Stat (${new Date().getFullYear()})`, contents: carousel };
    },
    'testcarousel': async (context) => {
        const msg = await db.getTopStat(10, 0);
        try {
            const obj = JSON.parse(msg);
            const tpl = flex.tpl_bubble;
            tpl.body.contents = obj;
            const carousel = flex.tpl_carousel; carousel.contents = [tpl, tpl];
            return { type: 'flex', altText: 'Test Carousel', contents: carousel };
        } catch (e) {
            return [{ type: 'text', text: msg }];
        }
    },
    'slip': async (context) => {
        const { member, groupId } = context;
        const theme = await db.getTheme();
        const isAdmin = member && member.admin === 1;
        const senderId = isAdmin ? null : (member ? member.line_user_id : null);
        let noticedSlips = await db.getNoticedSlips(senderId);
        if (!isAdmin && noticedSlips.length === 0 && senderId) {
            const latestSlip = await db.getLatestSlipBySender(senderId);
            if (latestSlip) noticedSlips = [latestSlip];
        }
        const msg = flex.buildSlipListFlex(noticedSlips, theme);
        return { type: 'flex', altText: `สลิปการโอนเงิน (${noticedSlips.length} รายการ)`, contents: msg };
    },
    'sliplist': async (context) => COMMAND_REGISTRY['slip'](context),
    'verify': async (context) => {
        const { param, member, quoteToken } = context;
        if (!param || isNaN(Number(param))) return [{ type: 'text', quoteToken, text: '⚠️ กรุณาระบุหมายเลขสลิป เช่น /verify 123' }];
        const slipId = Number(param);
        const slip = await db.getSlipById(slipId);
        if (!slip) return [{ type: 'text', quoteToken, text: `⚠️ ไม่พบสลิป #${slipId}` }];
        const isAdmin = member && member.admin === 1;
        if (!isAdmin && member && String(slip.sender_id) !== String(member.line_user_id)) return [{ type: 'text', quoteToken, text: '⚠️ คุณสามารถตรวจสอบได้เฉพาะสลิปของตัวเองเท่านั้น' }];
        if (!slip.qrcode) return [{ type: 'text', quoteToken, text: `⚠️ สลิป #${slipId} ไม่มี QR Code ไม่สามารถตรวจสอบได้` }];

        const verifyResult = await slipService.verifySlipPayload(slip.qrcode, slip.sender_name);
        if (verifyResult.success && verifyResult.slipData) {
            const { details, slipToMe, logStatus } = slipService.processSlipData(verifyResult.slipData, slip.sender_name);
            await db.updateSlipLog(slipId, logStatus, verifyResult.slipData);
            let msg = `✅ ตรวจสอบสลิป #${slipId} สำเร็จ!\n\n`;
            msg += `💰 ยอดเงิน: ${details.amountStr} บาท\n`;
            msg += `💸 โอนจาก: ${details.senderName} - ${details.senderBank}\n`;
            msg += `💵 ให้กับ: ${details.recipientName}\n`;
            msg += `📌 สถานะ: ${slipToMe ? 'โอนให้เรา ✅' : 'ไม่เกี่ยวกับค่าสนาม 📝'}`;
            if (slipToMe) {
                const slipMember = await db.queryMemberbyLineID(slip.sender_id);
                if (slipMember && slipMember.length > 0) {
                    await db.updateMemberWeek(slipMember[0].id, 1, 0);
                    msg += `\n\n💳 อัพเดทการชำระเงินให้ ${slip.sender_name} แล้ว`;
                }
            }
            return [{ type: 'text', text: msg }];
        } else {
            const errMsg = verifyResult.error ? `${verifyResult.error.code} - ${verifyResult.error.message}` : 'ไม่ทราบสาเหตุ';
            return [{ type: 'text', text: `❌ ตรวจสอบสลิป #${slipId} ไม่สำเร็จ\n\nสาเหตุ: ${errMsg}` }];
        }
    },
};

async function resolveMentionTarget(cmd, param, member, quoteToken) {
    let member_id = member ? member.id : undefined;
    let member_name = member ? member.name : undefined;
    let target_line_user_id = member ? member.line_user_id : undefined;
    let is_mention = false;

    if (!MENTION_COMMANDS.has(cmd) || !param.startsWith('@')) {
        return { member_id, member_name, target_line_user_id, is_mention, param };
    }

    const mention = await db.queryMemberbyName(param);
    if (!mention || mention.length === 0) {
        return { reply: formatTextReply(`ไม่พบสมาชิก ${param}`, quoteToken) };
    }

    is_mention = true;
    member_id = mention[0].id;
    member_name = param;
    target_line_user_id = mention[0].line_user_id;

    if (!WEEK_CHECK_SKIP.has(cmd) && !await db.IsMemberWeek(member_id)) {
        return {
            reply: formatTextReply(`สมาชิก ${param} ไม่ได้ลงชื่อในสัปดาห์นี้`, quoteToken)
        };
    }

    return { member_id, member_name, target_line_user_id, is_mention, param };
}

async function process_cmd(cmd_str, member, quoteToken, groupId = null) {
    const { cmd, param: rawParam } = parseCommandString(cmd_str);
    let param = rawParam;

    if (member && member.debt > 0 && member.admin !== 1 && !ADMIN_RESTRICTED_COMMANDS.has(cmd)) {
        const displayName = (member.name || '').replace('@', '');
        return formatTextReply(`ขออภัย ${displayName} ยังมียอดค้างชำระ ${member.debt} บาท ไม่สามารถใช้งานคำสั่งได้`, quoteToken);
    }

    try {
        const adminCmds = await db.getAdminCommands();
        const adminCmdSet = new Set(adminCmds || []);
        if (adminCmdSet.has(cmd)) {
            if (!member || member.admin !== 1) {
                return [{
                    type: 'text',
                    quoteToken: quoteToken,
                    text: `ขออภัย คุณไม่มีสิทธิ์ใช้งานคำสั่งนี้ (สำหรับผู้ดูแลระบบเท่านั้น)`
                }];
            }
        }
    } catch (dbErr) {
        console.error('⚠️ Failed to verify admin command from database:', dbErr.message);
    }

    let is_flex = true;
    if (param.toLowerCase().includes('text')) {
        is_flex = false;
        param = param.replace(/text/gi, '').trim();
    }

    let rank_val = 0;
    if (cmd === 'setrank') {
        const parts = param.split(/\s+/).filter(Boolean);
        if (parts.length > 1) {
            const possibleVal = parts.pop();
            const parsed = parseInt(possibleVal, 10);
            if (!isNaN(parsed)) {
                rank_val = parsed;
                param = parts.join(' ').trim();
            }
        }
    }

    let debt_val = 0;
    if (cmd === 'setdebt') {
        const parts = param.split(/\s+/).filter(Boolean);
        if (parts.length > 1) {
            const possibleVal = parts.pop();
            const parsed = parseInt(possibleVal, 10);
            if (!isNaN(parsed)) {
                debt_val = parsed;
                param = parts.join(' ').trim();
            }
        }
    }

    const mentionResult = await resolveMentionTarget(cmd, param, member, quoteToken);
    if (mentionResult.reply) {
        return mentionResult.reply;
    }

    let member_id = mentionResult.member_id;
    let member_name = mentionResult.member_name;
    let target_line_user_id = mentionResult.target_line_user_id;
    let is_mention = mentionResult.is_mention;
    param = mentionResult.param;

    return handleCommandSwitch({
        cmd,
        param,
        quoteToken,
        groupId,
        is_flex,
        rank_val,
        debt_val,
        member,
        member_id,
        member_name,
        target_line_user_id,
        is_mention
    });
}

async function handleCommandSwitch(context) {
    const { cmd, param, quoteToken, groupId, is_flex, rank_val, debt_val, member, member_id, member_name, target_line_user_id, is_mention } = context;
    let chat_type = "[cmd] -";
    console.log(`${chat_type} command: ${cmd} - param: ${param}`);

    // If a registry handler exists for this command, call it first. Handler may
    // return a reply (array/object) to short-circuit; `undefined` continues to
    // the legacy switch-based fallback.
    const registryHandler = COMMAND_REGISTRY[cmd];
    if (registryHandler && typeof registryHandler === 'function') {
        try {
            const registryResult = await registryHandler(context);
            if (registryResult !== undefined) {
                return registryResult;
            }
        } catch (handlerErr) {
            console.error('⚠️ Error in command registry handler for', cmd, handlerErr.message || handlerErr);
            // fall through to legacy switch
        }
    }
    // No registry handler matched; show default unknown-command menu
    return unknownCommandResponse(context);
}


module.exports = {
    process_cmd,
};

async function unknownCommandResponse(context) {
    const { cmd, quoteToken, groupId } = context;
    const theme = await db.getTheme();
    const week = await db.queryWeekID(0);
    const dateStr = week.length > 0 ? week[0].date : '';
    const autoRegCount = await db.getAutoRegCount();
    const msg = flex.buildMenuFlex(dateStr, theme, `ไม่รู้จักคำสั่ง: "${cmd}"`, autoRegCount);
    const altText = `ไม่รู้จักคำสั่ง: "${cmd}"`;
    return { type: 'flex', altText, contents: msg };
}