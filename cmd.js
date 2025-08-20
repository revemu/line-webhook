const db = require('./query');
const flex = require('./flex');

async function process_cmd(cmd_str, member) {
    const pos = cmd_str.indexOf(" ") ;
    let cmd ;
    let param = "" ;
    let is_mention = false ;
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
        }
        
    } else {

         if (member_name.includes("'")) {
            member_name = member_name.replaceAll(/[']/g,"\\'") ;
            //console.log(`member name has quoted - ${param}`) ;
        }
    }
    console.log(`${cmd} - ${param}`) ;
    let replyMessages ;
    let msg ;
    let altText ;
    let msg_type = 0 ;

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
        case 'topscorer':
            msg = await db.getTopStat(10, 0) ;

            const data = {
                img_url: 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg',
                header: 'Soccerbot',
                content: msg
            };
                        
            msg = flex.replacePlaceholders(flex.report_template, data) ;
            msg_type = 1 ;
            break ;
        default:
            break ;
    }

    if (msg_type == 0) {
        replyMessages = [{
            type: 'text',
            text: msg
        }];
    } else if (msg_type == 1) {
        replyMessages = {
                type: 'flex',
                altText: 'This is a Flex Message',
                contents: msg,
        };
    }

    return replyMessages ;
}
    

module.exports = {
  process_cmd,
};