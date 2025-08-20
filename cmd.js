const db = require('./query');

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
            member_name = mention[0].name ;
        }
        
    }
    console.log(`${cmd} - ${param}`) ;
    let replyMessages ;
    let msg ;
    let altText ;
    let msg_type = 0 ;
    switch (cmd) {
        case '+1':
            if (!await db.registerMember(member_id)) {
                console.log(`${member_name} ลงทะเบียนแล้ว!`) ;
            } else {
                console.log(`${member_name} ยังไม่ได้ลงทะเบียน`) ;
            }
            msg = await db.getMemberWeek(1) ;
            break ;
        default:
            break ;
    }

    if (msg_type == 0) {
        replyMessages = [{
            type: 'text',
            text: msg
        }];
    }

    return replyMessages ;
}
    

module.exports = {
  process_cmd,
};