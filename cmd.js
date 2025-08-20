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
    let replyMessage ;
    switch (cmd) {
        case '+1':
            replyMessage = await db.getMemberWeek() ;
            break ;
        default:
            break ;
    }
    return replyMessage ;
}
    

module.exports = {
  process_cmd,
};