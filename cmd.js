const db = require('./query');
const flex = require('./flex');
const qrGen = require('./qr_gen');

function getNextSaturday() {
    const date = new Date();
    date.setDate(date.getDate() + (6 - date.getDay() + 7) % 7 || 7);
    const d = ('0' + date.getDate()).slice(-2);
    const m = ('0' + (date.getMonth() + 1)).slice(-2);
    const y = date.getFullYear();

    return date;
}

async function process_cmd(cmd_str, member, quoteToken, groupId = null) {
    const pos = cmd_str.indexOf(" ");
    const cmd = (pos > 0 ? cmd_str.substring(0, pos) : cmd_str).trim();
    let param = (pos > 0 ? cmd_str.substring(pos) : "").trim();

    if (member && member.debt > 0 && member.admin !== 1 && cmd !== 'qr') {
        const displayName = (member.name || '').replace('@', '');
        return [{
            type: 'text',
            quoteToken: quoteToken,
            text: `ขออภัย ${displayName} ยังมียอดค้างชำระ ${member.debt} บาท ไม่สามารถใช้งานคำสั่งได้`
        }];
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

    let member_id = member.id;
    let member_name = member.name;
    let target_line_user_id = member.line_user_id;
    const is_mention_cmd = ['+1', '-1', '+pay', '-pay', '+pay2', '+team1', '+team2', '+team3', '+team4', '-team', 'setrank', 'autoreg', '+autoreg', '-autoreg', 'stat', 'mystat', 'me', 'my'].includes(cmd);
    let is_mention = false;

    if (is_mention_cmd && param.startsWith('@')) {
        const mention = await db.queryMemberbyName(param);
        if (mention.length > 0) {
            is_mention = true;
            console.log(`mentioned member - ${param}, id: ${mention[0].id}`);
            member_id = mention[0].id;
            member_name = param;
            target_line_user_id = mention[0].line_user_id;
            if (cmd != '+1' && cmd != '-1' && cmd != 'autoreg' && cmd != '+autoreg' && cmd != '-autoreg' && cmd != 'stat' && cmd != 'mystat' && cmd != 'me' && cmd != 'my') {
                if (!await db.IsMemberWeek(member_id)) {
                    return [{
                        type: 'text',
                        quoteToken: quoteToken,
                        text: `สมาชิก ${param} ไม่ได้ลงชื่อในสัปดาห์นี้`
                    }];
                }
            }
        } else {
            return [{
                type: 'text',
                quoteToken: quoteToken,
                text: `ไม่พบสมาชิก ${param}`
            }];
        }
    }
    let chat_type = "[cmd] -";
    console.log(`${chat_type} command: ${cmd} - param: ${param}`);
    let replyMessages;
    let msg = "";
    let sub = null;

    var altText;
    let msg_type = 0;
    let obj;
    let week;
    switch (cmd) {
        case 'setmaxweek':
            if (param == "") {
                msg = "Please enter max number";
                msg_type = 0;
                break;
            }
            await db.updateMaxNumberWeek(Number(param));

            [msg, sub, altText] = await db.getMemberWeek0(1, is_flex, groupId);
            if (is_flex && typeof msg === 'object') {
                msg_type = 1;
                altText = altText || "ลงชื่อเตะบอล";
            } else {
                msg_type = 2;
            }
            break;
        case 'removereserve':
        case 'delreserve': {
            const result = await db.removeReserveMembers();
            if (result.success) {
                const infoText = result.count > 0 
                    ? `ลบรายชื่อสำรองสำเร็จ! (${result.count} คน: ${result.names.join(', ')})`
                    : `ไม่มีรายชื่อสำรองในสัปดาห์นี้ครับ`;
                
                const [flexMsg, sub, altTextStr] = await db.getMemberWeek0(1, is_flex, groupId);
                if (is_flex && typeof flexMsg === 'object') {
                    return [
                        {
                            type: 'text',
                            quoteToken: quoteToken,
                            text: infoText
                        },
                        {
                            type: 'flex',
                            altText: altTextStr || "ลงชื่อเตะบอล",
                            contents: flexMsg
                        }
                    ];
                } else {
                    return [
                        {
                            type: 'text',
                            quoteToken: quoteToken,
                            text: infoText
                        },
                        {
                            type: 'text',
                            quoteToken: quoteToken,
                            text: flexMsg
                        }
                    ];
                }
            } else {
                msg = `เกิดข้อผิดพลาด: ${result.message}`;
                msg_type = 0;
            }
            break;
        }
        case 'x1':
            await db.registerNY(member_id);
            msg = await db.getMemberNY();
            break;
        case '+2':
            [msg, sub] = await db.getDebtList(0);
            console.log(sub);
            msg_type = 3;
            //msg = await db.getMemberWeek(1);
            break;
        case '+1': {
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
                    msg_type = 1;
                    break;
                }
            }

            const reg_res2 = await db.registerMember(member_id, member_name);
            if (reg_res2 == 1) {
                console.log(`${chat_type} ${member_name} ลงทะเบียนไปแล้ว!`);
            } else if (reg_res2 > 1) {
                console.log(`${chat_type} ${member_name} ยังมียอดค้าง ${reg_res2}บาท!`);
                msg = `ขออภัย ${member_name} ยังมียอดค้าง ${reg_res2}บาท!`;
                msg_type = 0;
                break;
            }
            [msg, sub, altText] = await db.getMemberWeek0(1, is_flex, groupId);
            if (is_flex && typeof msg === 'object') {
                msg_type = 1;
                altText = altText || "ลงชื่อเตะบอล";
            } else {
                msg_type = 2;
            }
            break;
        }
        case '-1': {
            const unregResult = await db.unregisterMember(member_id);
            if (unregResult.success) {
                console.log(`${chat_type} ${member_name} พบข้อมูลลงทะเบียน!`);
                if (unregResult.team_id != 1) {
                    await db.updateMemberAutoReg(member_id, 0);
                }
            }
            [msg, sub, altText] = await db.getMemberWeek0(1, is_flex, groupId);
            if (is_flex && typeof msg === 'object') {
                msg_type = 1;
                altText = altText || "ลงชื่อเตะบอล";
            } else {
                msg_type = 2;
            }
            break;
        }
        case '+pay2':
            //if (is_mention) {
            await db.updateMemberWeek(member_id, 1, 0);
            [msg, sub] = await db.getMemberWeek2(0);
            //console.log(sub) ;
            msg_type = 2;
            // } else {
            //     msg = "ถ้าส่ง slip แล้วยังไม่ขึ้นโปรดรอ หรือพิมพ์ +pay @ชื่อสมาชิก" ;
            // }

            break;
        case '+pay':
            //if (is_mention) {
            await db.updateMemberWeek(member_id, 1, 0);
            let count = 0;
            [msg, sub, count] = await db.getMemberWeek2(0);
            //console.log(`user count: ${count}`)
            if (count > 0 && count < 21)
                msg_type = 2;
            else
                msg_type = 0;
            // } else {
            //     msg = "ถ้าส่ง slip แล้วยังไม่ขึ้นโปรดรอ หรือพิมพ์ +pay @ชื่อสมาชิก" ;
            // }

            break;
        case '-pay':
            if (is_mention) {
                await db.updateMemberWeek(member_id, 0, 0);
                msg = await db.getMemberWeek(0);
            }
            break;
        case '-team':
            //if (is_mention) {
            //week = await db.queryWeekID(0)
            //let team_colors = await db.getTeamColorWeek(week[0].id) ;
            //console.log(team_colors) ;
            //await db.updateMemberWeek(member_id, 0, 1) ;
            msg = `พิมพ์ +team1(-4) ได้เลย ไม่ต้อง -team`;
            //} else {
            //    msg = `ต้องระบุชื่อสมาชิกด้วย` ;
            //}
            break;
        case '+team1':
        case '+team2':
        case '+team3':
        case '+team4':
            if (is_mention) {
                let team_num = Number(cmd.slice(-1)) - 1;
                let week = await db.queryWeekID(0)
                let team_colors = await db.getTeamColorWeek(week[0].id);
                //console.log(team_colors[team_num]) ;
                await db.updateMemberWeek(member_id, team_colors[team_num].id, 1);
                msg = `${member_name} อยู่ทีม ${team_colors[team_num].color}`;
            } else {
                msg = `ต้องระบุชื่อสมาชิกด้วย`;
            }

            break;
        case 'resetteam':
            await db.resetMemberTeam();
            msg = `ปรับให้ทุกคนไม่มีทีมแล้ว`;
            break;
        case 'randomteam':
            //const cdate = new Date();
            const dow = (new Date()).getDay();
            //const h = cdate.getHours() ;
            if (dow >= 0) {
                const team_res = await db.addTeamMemberWeek();
                if (team_res == 0) {
                    week = await db.queryWeekID(0)
                    //console.log(week) ;
                    msg = await db.getTeamWeek(week[0].id, groupId);
                    //console.log(msg) ;
                    altText = `Team Week - ${week[0].date}`;
                    msg_type = 1;
                } else if (team_res == 1) {
                    msg = "ทำการสุ่มไปแล้วใช้ /teamweek เพื่อดูทีม";
                    msg_type = 0;
                } else if (team_res == 2) {
                    msg = "ยังไม่ได้ถูกจัดกลุ่มเพื่อสุ่ม";
                    msg_type = 0;
                }
            } else {
                msg = "ยังไม่ได้ถูกจัดกลุ่มเพื่อสุ่ม";
                msg_type = 0;
            }

            break;
        case 'teamweek':
            week = await db.queryWeekID(0)
            //console.log(week) ;
            msg = await db.getTeamWeek(week[0].id, groupId);
            //console.log(msg) ;
            altText = `Team Week - ${week[0].date}`;
            msg_type = 1;
            //msg = "teamweek" ;
            break;
        case 'matchweek':
            week = await db.queryWeekID(0)
            msg = await db.getMatchWeek(week[0].id, groupId);
            //msg = await db.getMatchWeek(272) ;
            altText = `Match Week - ${week[0].date}`;
            msg_type = 1;
            //msg = "teamweek" ;
            break;
        case 'tableweek':
            msg = "แสดงตารางใน /matchweek แทนแล้ว";
            //msg = "teamweek" ;
            break;
        case 'topscorer':
        case 'topassist':
            msg = "ให้ใช้ /top แทน";
            break;
        case 'setrank':
            if (is_mention) {
                await db.updateMemberRank(member_id, rank_val);
                msg = `ปรับระดับ (rank) ของ ${member_name} เป็น ${rank_val} เรียบร้อยครับ`;
            } else {
                msg = `กรุณาระบุชื่อสมาชิก: /setrank @ชื่อสมาชิก ระดับ`;
            }
            msg_type = 0;
            break;
        case 'theme':
            if (param === 'black' || param === 'white') {
                await db.setTheme(param);
                msg = `เปลี่ยนธีมเป็น ${param} เรียบร้อยครับ`;
            } else {
                msg = `กรุณาระบุธีม: /theme black หรือ /theme white`;
            }
            msg_type = 0;
            break;
        case 'setcost': {
            if (param === "") {
                msg = "กรุณาระบุค่าสนามทั้งหมด เช่น /setcost 3300";
                msg_type = 0;
                break;
            }
            const totalCost = parseInt(param, 10);
            if (isNaN(totalCost) || totalCost <= 0) {
                msg = "กรุณาระบุค่าสนามเป็นตัวเลขที่มากกว่า 0";
                msg_type = 0;
                break;
            }

            const result = await db.setWeekCost(totalCost);
            if (result.success) {
                msg = `ตั้งค่าค่าสนามสำเร็จ!\n` +
                    `ยอดรวม: ${totalCost} บาท\n` +
                    `สมาชิกลงชื่อ: ${result.count} คน\n` +
                    `เฉลี่ยคนละ: ${result.sharedFee} บาท\n` +
                    `บันทึกยอดค้างชำระเรียบร้อยแล้ว`;
            } else {
                msg = `เกิดข้อผิดพลาด: ${result.message}`;
            }
            msg_type = 0;
            break;
        }
        case 'resetdebt':
        case 'resetcost': {
            const result = await db.resetWeekDebt();
            if (result.success) {
                msg = `รีเซ็ตยอดค้างชำระของสมาชิกทุกคนในสัปดาห์นี้เรียบร้อยครับ\n` +
                    `สมาชิกลงชื่อที่ถูกรีเซ็ต: ${result.count} คน`;
            } else {
                msg = `เกิดข้อผิดพลาด: ${result.message}`;
            }
            msg_type = 0;
            break;
        }
        case 'qr': {
            let amount = 0;
            if (param !== "") {
                amount = parseInt(param, 10);
                if (isNaN(amount) || amount <= 0) {
                    msg = "กรุณาระบุจำนวนเงินเป็นตัวเลข เช่น /qr 150";
                    msg_type = 0;
                    break;
                }
            } else {
                if (!member || member.debt <= 0) {
                    msg = "ยังไม่ได้คำนวณค่าสนามในสัปดาห์นี้ครับ";
                    msg_type = 0;
                    break;
                }
                amount = member.debt;
            }

            try {
                const filename = await qrGen.generateQrCode(amount, '0850705894');

                let baseUrl = global.baseWebhookUrl || "https://api.revemu.org";
                if (baseUrl.startsWith('http://')) {
                    baseUrl = baseUrl.replace('http://', 'https://');
                }
                const localQrUrl = `${baseUrl}/img/qr/${filename}`;

                const theme = await db.getTheme();
                msg = flex.buildQrFlex(amount, '0850705894', theme, localQrUrl);
                altText = `สแกน QR ชำระเงิน ${amount} บาท`;
                msg_type = 1;
            } catch (qrErr) {
                console.error('Failed to generate local QR:', qrErr);
                msg = `เกิดข้อผิดพลาดในการสร้าง QR Code: ${qrErr.message}`;
                msg_type = 0;
            }
            break;
        }
        case 'showautoreg':
        case 'whoautoreg':
        case 'autoregshow':
        case 'autoreglist':
            param = 'list';
        // falls through
        case 'autoreg':
        case '+autoreg': {
            const theme = await db.getTheme();
            const autoregTpl = await db.getTemplate('autoreg', 'header');
            const autoregImageUrl = autoregTpl ? autoregTpl.url : null;
            if (param.toLowerCase() === 'list') {
                const list = await db.getAutoRegList(groupId);
                msg = flex.buildAutoRegFlex('list', null, list, theme, autoregImageUrl);
                altText = "สมาชิกลงชื่ออัตโนมัติ";
                msg_type = 1;
                break;
            }
            const list = await db.getAutoRegList(groupId);
            const isAlreadyRegistered = list.some(m => m.id === member_id);
            if (isAlreadyRegistered) {
                const memberInfo = await db.getMemberDisplayInfo(member_id, groupId);
                msg = flex.buildAutoRegFlex('already', memberInfo, list, theme, autoregImageUrl);
                altText = `ลงชื่ออัตโนมัติอยู่แล้ว: ${member_name}`;
                msg_type = 1;
                break;
            }
            if (list.length >= 24) {
                msg = flex.buildAutoRegFlex('full', null, list, theme, autoregImageUrl);
                altText = "รายชื่อลงชื่อออโต้เต็มแล้ว";
                msg_type = 1;
                break;
            }
            await db.updateMemberAutoReg(member_id, 1);
            const memberInfo = await db.getMemberDisplayInfo(member_id, groupId);
            const updatedList = await db.getAutoRegList(groupId);
            msg = flex.buildAutoRegFlex('add', memberInfo, updatedList, theme, autoregImageUrl);
            altText = `สมัครลงชื่ออัตโนมัติสำเร็จ: ${member_name}`;
            msg_type = 1;
            break;
        }
        case '-autoreg': {
            const theme = await db.getTheme();
            const autoregTpl = await db.getTemplate('autoreg', 'header');
            const autoregImageUrl = autoregTpl ? autoregTpl.url : null;
            await db.updateMemberAutoReg(member_id, 0);
            const memberInfo = await db.getMemberDisplayInfo(member_id, groupId);
            const list = await db.getAutoRegList(groupId);
            msg = flex.buildAutoRegFlex('remove', memberInfo, list, theme, autoregImageUrl);
            altText = `ยกเลิกลงชื่ออัตโนมัติสำเร็จ: ${member_name}`;
            msg_type = 1;
            break;
        }
        case 'stat':
        case 'mystat':
        case 'me':
        case 'my': {
            const theme = await db.getTheme();
            const statTpl = await db.getTemplate('stat', 'header');
            const statsImageUrl = statTpl ? statTpl.url : null;
            const statsData = await db.getMemberStats(member_id, groupId);
            if (statsData) {
                msg = flex.buildMemberStatsFlex(statsData, theme, statsImageUrl);
                altText = `สถิติส่วนตัวของ ${statsData.member.name}`;
                msg_type = 1;
            } else {
                msg = "ไม่พบข้อมูลสถิติของสมาชิกท่านนี้";
                msg_type = 0;
            }
            break;
        }
        case 'bottom':
        case 'testbottom': {
            let limit = param != '' ? Number(param) : 30;
            if (limit > 25) {
                //limit = 25;
            }
            await db.updateHof();
            const stats = await Promise.all([
                db.getTopStat(limit, 5), // Top Weekly Bottoms / Depression
                db.getTopStat(limit, 2)  // Top Own Goals
            ]);

            const carousel = flex.tpl_carousel;
            carousel.contents = stats.filter(x => x !== null && x !== undefined);
            const date = new Date();
            altText = `ทำเนียบซึมเศร้าประจำปี (${date.getFullYear()})`;
            msg = carousel;
            msg_type = 1;
            break;
        }
        case 'newweek': {
            const next_sat = getNextSaturday();
            await db.newWeek(next_sat);
            // falls through
        }
        case 'menu': {
            const theme = await db.getTheme();
            const week = await db.queryWeekID(0);
            const dateStr = week.length > 0 ? week[0].date : '';
            let autoRegCount = 0;
            try {
                const autoRegRes = await db.executeQuery("SELECT COUNT(*) as count FROM member_tbl WHERE auto_reg = 1");
                if (autoRegRes.length > 0) {
                    autoRegCount = autoRegRes[0].count;
                }
            } catch (err) {
                console.error("Error getting autoRegCount in menu:", err.message);
            }
            msg = flex.buildMenuFlex(dateStr, theme, null, autoRegCount);
            altText = "เมนูบริการของบอท";
            msg_type = 1;
            break;
        }
        case 'register':
        case 'join':
        case 'play':
        case 'ลงชื่อ':
        case 'reg': {
            [msg, sub, altText] = await db.getMemberWeek0(1, is_flex, groupId);
            if (is_flex && typeof msg === 'object') {
                msg_type = 1;
                altText = altText || "ลงชื่อเตะบอล";
            } else {
                msg_type = 2;
            }
            break;
        }
        case 'schedule': {
            const theme = await db.getTheme();
            const args = param.split(/\s+/).filter(Boolean);
            let startTime = '17:00';
            let endTime = null;
            let matchDuration = 8;

            if (args.length > 0) {
                startTime = args[0];
            }
            if (args.length > 1) {
                if (args[1].includes(':') || args[1].includes('.')) {
                    endTime = args[1];
                } else {
                    matchDuration = parseInt(args[1], 10) || 8;
                }
            }
            if (args.length > 2) {
                if (args[2].includes(':') || args[2].includes('.')) {
                    endTime = args[2];
                } else {
                    matchDuration = parseInt(args[2], 10) || 8;
                }
            }

            const [schedText, schedJson] = await db.getScheduleText(startTime, matchDuration, 1, 3, endTime);
            if (schedJson) {
                msg = flex.buildScheduleFlex(schedJson, theme);
                altText = `⚽ ตารางแข่งขัน เสาร์ที่ ${schedJson.date}`;
                msg_type = 1;
            } else {
                msg = schedText;
            }
            break;
        }
        case 'now': {
            const theme = await db.getTheme();
            const matchInfo = await db.getCurrentMatch(groupId);
            if (!matchInfo) {
                msg = 'ยังไม่มีตารางแข่งขัน ใช้คำสั่ง /schedule ก่อนนะครับ';
                break;
            }
            const cur = matchInfo.currentMatch;
            if (!cur) {
                msg = 'ยังไม่มีข้อมูลแมตช์ปัจจุบัน';
                break;
            }
            msg = flex.buildNowFlex(matchInfo, theme);
            altText = `⚽ แมตช์ปัจจุบัน [${cur.matchNo}] ${cur.teamA} vs ${cur.teamB}`;
            msg_type = 1;
            break;
        }
        case 'live': {
            const theme = await db.getTheme();
            const matchInfo = await db.getCurrentMatch(groupId);
            if (!matchInfo || !matchInfo.sched) {
                msg = 'ยังไม่มีตารางแข่งขัน ใช้คำสั่ง /schedule ก่อนนะครับ';
                break;
            }
            const cur = matchInfo.currentMatch;
            msg = flex.buildLiveFlex(matchInfo, theme);
            altText = `⚽ Live! Match ${cur ? `[${cur.matchNo}] ${cur.teamA} vs ${cur.teamB}` : ''}`;
            msg_type = 1;
            break;
        }



        case 'top':
            let limit = param != '' ? Number(param) : 30;
            if (limit > 25) {
                //limit = 25;
            }

            await db.updateHof();
            const stats = await Promise.all([
                db.getTopStat(limit, 0),
                db.getTopStat(limit, 1),
                db.getTopStat(limit, 4),
                db.getTopStat(limit, 6)
            ]);

            const carousel = flex.tpl_carousel;
            carousel.contents = stats.filter(x => x !== null && x !== undefined);
            const date = new Date();
            altText = `Top ${limit} Stat (${date.getFullYear()})`;
            msg = carousel;
            msg_type = 1;
            break;
        case 'testcarousel':
            msg = await db.getTopStat(10, 0);
            //console.log(msg) ;
            //content = content.replace(/(\r\n|\n|\r)/gm, "");
            //console.log(content) ;
            /*const data = {
                img_url: 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg',
                content: msg
            };
            const tpl =  flex.tpl_top.replace(/(\r\n|\n|\r)/gm, "");
            //console.log(tpl) ;
            msg = flex.replaceFlex(tpl, data) ;*/
            obj = flex.tpl_bubble;
            obj.size = "nano";
            obj.hero.url = 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg';
            obj.hero.aspectRatio = "12:6"
            //console.log(msg) ;
            obj.body.contents = JSON.parse(msg);
            console.log(obj);
            //msg = test ;

            carousel = flex.tpl_carousel;
            carousel.contents = [];
            carousel.contents.push(obj);
            carousel.contents.push(obj);
            msg = carousel;
            console.log(msg);

            altText = "Test Carousel";
            msg_type = 1;
            break;
        default:
            if (msg == "") {
                const theme = await db.getTheme();
                const week = await db.queryWeekID(0);
                const dateStr = week.length > 0 ? week[0].date : '';
                let autoRegCount = 0;
                try {
                    const autoRegRes = await db.executeQuery("SELECT COUNT(*) as count FROM member_tbl WHERE auto_reg = 1");
                    if (autoRegRes.length > 0) {
                        autoRegCount = autoRegRes[0].count;
                    }
                } catch (err) {
                    console.error("Error getting autoRegCount in default menu:", err.message);
                }
                msg = flex.buildMenuFlex(dateStr, theme, `ไม่รู้จักคำสั่ง: "${cmd}"`, autoRegCount);
                altText = `ไม่รู้จักคำสั่ง: "${cmd}"`;
                msg_type = 1;
            }
            break;
    }
    if (msg == '') return;

    switch (msg_type) {
        case 0:
            return [{
                type: 'text',
                quoteToken: quoteToken,
                text: msg
            }];
        case 1:
            return {
                type: 'flex',
                altText: altText,
                contents: msg,
            };
        case 2:
            return {
                type: 'textV2',
                quoteToken: quoteToken,
                text: msg,
                substitution: sub
            };
        case 3:
            return {
                type: 'textV2',
                text: msg,
                substitution: sub
            };
        default:
            return;
    }

    //console.log(replyMessages)
    return replyMessages;
}


module.exports = {
    process_cmd,
};