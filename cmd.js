const db = require('./query');

async function process_cmd(cmd_str, member) {
    const pos = cmd_str.indexOf(" ") ;
    let cmd ;
    let param = "" ;
    if (pos > 0) {
        cmd = cmd_str.substring(0,pos).trim() ;
        param = cmd_str.substring(pos).trim() ;
    } else {
        cmd = cmd_str.trim() ;
    }
    if (param.startsWith('@'))  {
        if ((param.includes("'")) > 0) {
            param = param.replaceAll("'","\'") ;
        }
        console.log(`mentioned member - ${param}`) ;
    }
    console.log(`${cmd} - ${param}`) ;
    let replyMessages ;
    let msg ;
    let altText ;
    let msg_type = 0 ;
    switch (cmd) {
        case '+1':
            if (!await db.registerMember(member.id)) {
                console.log(`${member.name} ลงทะเบียนแล้ว!`)
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