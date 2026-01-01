const db = require('./query');
const flex = require('./flex');

function getNextSaturday() {
    const date = new Date();
    date.setDate(date.getDate() + (6 - date.getDay() + 7) % 7 || 7);
    const d = ('0' + date.getDate()).slice(-2);
    const m = ('0' + (date.getMonth() + 1)).slice(-2);
    const y = date.getFullYear();

    return date;
}

async function process_cmd(cmd_str, member, quoteToken) {
    const pos = cmd_str.indexOf(" ");
    let cmd;
    let param = "";
    let msg = "";
    let sub = "";
    var is_mention = false;
    let member_id = member.id;
    let member_name = member.name;

    if (pos > 0) {
        cmd = cmd_str.substring(0, pos).trim();
        param = cmd_str.substring(pos).trim();
    } else {
        cmd = cmd_str.trim();
    }

    if (param.startsWith('@')) {
        if (param.includes("'")) {
            param = param.replaceAll(/[']/g, "\\'");
            //console.log(`member name has quoted - ${param}`) ;
        }
        is_mention = true;
        const mention = await db.queryMemberbyName(param);
        if (mention.length > 0) {
            console.log(`mentioned member - ${param}, id: ${mention[0].id}`);
            member_id = mention[0].id;
            member_name = param;
            if (cmd != '+1' && cmd != '-1') {
                if (!await db.IsMemberWeek(member_id)) {
                    cmd = "";
                    msg = `สมาชิก ${param} ไม่ได้ลงชื่อในสัปดาห์นี้`
                }
            }

        } else {
            cmd = "";
            msg = `ไม่พบสมาชิก ${param}`
        }

    } else {

        if (member_name.includes("'")) {
            member_name = member_name.replaceAll(/[']/g, "\\'");
            //console.log(`member name has quoted - ${param}`) ;
        }
    }
    let chat_type = "[cmd] -";
    console.log(`${chat_type} command: ${cmd} - param: ${param}`);
    let replyMessages;

    var altText;
    let msg_type = 0;
    let obj;
    let week;
    switch (cmd) {
        case 'x1':
            await db.registerNY(member_id);
            msg = await db.getMemberNY();
            break;
        case '+1':
            const reg_res = await db.registerMember(member_id, member_name);
            if (reg_res == 1) {
                console.log(`${chat_type} ${member_name} ลงทะเบียนไปแล้ว!`);
            } else if (reg_res > 1) {
                console.log(`${chat_type} ${member_name} ยังมียอดค้าง ${reg_res}บาท!`);
                msg = `${member_name} ยังมียอดค้าง ${reg_res}บาท!`
                break;
            }
            msg = await db.getMemberWeek(1);
            break;
        case '-1':
            if (await db.unregisterMember(member_id)) {
                console.log(`${chat_type} ${member_name} พบข้อมูลลงทะเบียน!`);
            }
            msg = await db.getMemberWeek(1);
            break;
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
                    msg = await db.getTeamWeek(week[0].id);
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
            msg = await db.getTeamWeek(week[0].id);
            //console.log(msg) ;
            altText = `Team Week - ${week[0].date}`;
            msg_type = 1;
            //msg = "teamweek" ;
            break;
        case 'matchweek':
            week = await db.queryWeekID(0)
            msg = await db.getMatchWeek(week[0].id);
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
        case 'newweek':
            const next_sat = getNextSaturday();
            await db.newWeek(next_sat);
            msg = `ลงชื่อเตะบอล เสาร์ที่ ${await db.getFormatDate(next_sat)} ได้`;
            break;
        case 'top':
            let limit = 10;
            if (param != '') limit = Number(param);
            msg = await db.getTopStat(limit, 0);
            let carousel = flex.tpl_carousel;
            carousel.contents = [];
            carousel.contents.push(msg);
            msg = await db.getTopStat(limit, 1);
            carousel.contents.push(msg);
            msg = await db.getTopStat(limit, 2);
            carousel.contents.push(msg);
            const date = new Date();
            altText = `Top ${limit} Stat (${date.getFullYear()})`;
            msg = carousel;
            //console.log(JSON.stringify(msg))
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

            msg_type = 1;
            break;
        case 'test':
            const data1 = {
                img_url: 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg',
                header: 'SoccerBot'
            };

            msg = flex.replacePlaceholders(flex.report_template, data1);
            //console.log(msg) ;
            msg_type = 1;
            break;
        default:
            if (msg == "")
                msg = "ไม่รู้จักคำสั่งนี้"

            break;
    }
    if (msg != '') {
        if (msg_type == 0) {
            replyMessages = [{
                type: 'text',
                quoteToken: quoteToken,
                text: msg
            }];
        } else if (msg_type == 1) {
            replyMessages = {
                type: 'flex',
                altText: altText,
                contents: msg,
            };
        } else if (msg_type == 2) {
            replyMessages = {
                type: 'textV2',
                quoteToken: quoteToken,
                text: msg,
                substitution: sub
            };
            //console.log(replyMessages) ;
        }
    }

    //console.log(replyMessages)
    return replyMessages;
}


module.exports = {
    process_cmd,
};