const db = require('./query');

async function process_cmd(cmd_str) {
    const pos = cmd_str.indexOf(" ") ;
    let cmd ;
    let param ;
    if (pos > 0) {
        cmd = cmd_str.substring(0,pos).trim() ;
        param = cmd_str.substring(pos).trim() ;
    } else {
        cmd = cmd_str.trim() ;
    }
    console.log(`${cmd} - ${param}`) ;
    let replyMessages ;
    switch (cmd) {
        case '+1':
            const replyMessage = await db.getMemberWeek() ;
            replyMessages = [{
                    type: 'text',
                    text: replyMessage
            }];

            break ;
        default:
            break ;
    }
    return replyMessages ;
}
    

module.exports = {
  process_cmd,
};