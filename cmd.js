const db = require('./query');
const flex = require('./flex');

async function process_cmd(cmd_str, member, quoteToken) {
    const pos = cmd_str.indexOf(" ") ;
    let cmd ;
    let param = "" ;
    let msg ;
    var is_mention = false ;
    let member_id = member.id ;
    let member_name = member.name ;

    if (pos > 0) {
        cmd = cmd_str.substring(0,pos).trim() ;
        param = cmd_str.substring(pos).trim() ;
    } else {
        cmd = cmd_str.trim() ;
    }

    if (param.startsWith('@'))  {
        if (param.includes("'")) {
            param = param.replaceAll(/[']/g,"\\'") ;
            //console.log(`member name has quoted - ${param}`) ;
        }
        is_mention = true ;
        const mention = await db.queryMemberbyName(param) ;
        if (mention.length > 0) {
            console.log(`mentioned member - ${param}, id: ${mention[0].id}`) ;
            member_id = mention[0].id ;
            member_name = param ;
            if (!await db.IsMemberWeek(member_id)) {
                cmd = "" ;
                msg = `สมาชิก ${param} ไม่ได้ลงชื่อในสัปดาห์นี้`
            }
        } else {
            cmd = "" ;
            msg = `ไม่พบสมาชิก ${param}`
        }
        
    } else {

         if (member_name.includes("'")) {
            member_name = member_name.replaceAll(/[']/g,"\\'") ;
            //console.log(`member name has quoted - ${param}`) ;
        }
    }
    console.log(`${cmd} - ${param}`) ;
    let replyMessages ;
    
    var altText ;
    let msg_type = 0 ;
    let obj ;
    let week ;
    switch (cmd) {
        case '+1':
            if (!await db.registerMember(member_id, member_name)) {
                console.log(`${member_name} ลงทะเบียนแล้ว!`) ;
            } else {
                console.log(`${member_name} ยังไม่ได้ลงทะเบียน`) ;
            }
            msg = await db.getMemberWeek(1) ;
            break ;
        case '-1':
            if (await db.unregisterMember(member_id)) {
                console.log(`${member_name} ลงทะเบียนแล้ว!`) ;
            } else {
                console.log(`${member_name} ยังไม่ได้ลงทะเบียน`) ;
            }
            msg = await db.getMemberWeek(1) ;
            break ;
        case '+pay':
            await db.updateMemberWeek(member_id, 1, 0) ;
            msg = await db.getMemberWeek(0) ;
            break ;
        case '-pay':
            await db.updateMemberWeek(member_id, 0, 0) ;
            msg = await db.getMemberWeek(0) ;
            break ;
        case '-team':
            if (is_mention) {
                week = await db.queryWeekID(0)
                let team_colors = await db.getTeamColorWeek(week[0].id) ;
                console.log(team_colors) ;
                //await db.updateMemberWeek(member_id, 0, 1) ;
                msg = `${member_name} ยังไม่มีทีม` ;
            } else {
                msg = `ต้องระบุชื่อสมาชิกด้วย` ;
            }
            break ;
        case '+team1':
        case '+team2':
        case '+team3':
            if (is_mention) {
                let team_num = Number(cmd.slice(-1)) - 1 ;
                let week = await db.queryWeekID(0)
                let team_colors = await db.getTeamColorWeek(week[0].id) ;
                //console.log(team_colors[team_num]) ;
                await db.updateMemberWeek(member_id, team_colors[team_num].id, 1) ;
                msg = `${member_name} อยู่ทีม ${team_colors[team_num].color}` ;
            } else {
                msg = `ต้องระบุชื่อสมาชิกด้วย` ;
            }
            
            break ;
        case 'teamweek':
            week = await db.queryWeekID(0)
            console.log(week) ;
            msg = await db.getTeamWeek(week[0].id) ;
            console.log(msg) ;
            altText = `Team Week ${week[0].date}` ;
            msg_type = 1 ;
            //msg = "teamweek" ;
            break ;
        case 'matchweek':
            week = await db.queryWeekID(0)
            msg = await db.getMatchWeek(week[0].id) ;
            altText = `Match Week ${week[0].date}` ;
            msg_type = 1 ;
            //msg = "teamweek" ;
            break ;
        /*case 'tableweek':
            msg = await db.getTableWeek(271) ;
            altText = "Table Week"
            msg_type = 1 ;
            //msg = "teamweek" ;
            break ;*/
        case 'top':
    
            msg = await db.getTopStat(10, 0);
            let carousel = flex.tpl_carousel ;
            carousel.contents = [] ;
            carousel.contents.push(msg) ;
            msg = await db.getTopStat(10, 1);
            carousel.contents.push(msg) ;
            altText = `Top Stat` ;
            msg = carousel ;
            msg_type = 1 ;
            break ;
        case 'testcarousel':
            msg = await db.getTopStat(10, 0) ;
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
            obj = flex.tpl_bubble ;
            obj.size = "nano" ;
            obj.hero.url = 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg' ;
            obj.hero.aspectRatio = "12:6"
            //console.log(msg) ;
            obj.body.contents = JSON.parse(msg) ;
            console.log(obj) ;
            //msg = test ;
            
            carousel = flex.tpl_carousel ;
            carousel.contents = [] ;
            carousel.contents.push(obj) ;
            carousel.contents.push(obj) ;
            msg = carousel ;
            console.log(msg) ;
            
            msg_type = 1 ;
            break ;
        case 'test':
            const data1 = {
                img_url: 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg',
                header: 'SoccerBot'
            };
                       
            msg = flex.replacePlaceholders(flex.report_template, data1);
            //console.log(msg) ;
            msg_type = 1 ;
            break ;
        default:
            break ;
    }

    if (msg_type == 0) {
        replyMessages = [{
            type: 'text',
            quoteToken: quoteToken,
            text: msg
        }];
    } else if (msg_type == 1) {
        replyMessages = {
                type: 'flex',
                altText: altText ,
                contents: msg,
        };
    } 
    //console.log(replyMessages)
    return replyMessages ;
}
    

module.exports = {
  process_cmd,
};