const db = require('./query');

async function process_cmd(cmd_str) {
    const pos = cmd_str.indexOf(" ") ;
    const cmd = (cmd_str.substring(0,pos)).trim() ;
    const param = (cmd_str.substring(pos)).trim() ;
    console.log(`${cmd} - ${param}`) ;
}

module.exports = {
  process_cmd,
};