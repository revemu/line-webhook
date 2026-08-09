from pathlib import Path

path = Path('cmd.js')
text = path.read_text(encoding='utf-8')
orig_nl = '\r\n' if '\r\n' in text else '\n'
norm = text.replace('\r\n', '\n')

sig = 'async function process_cmd(cmd_str, member, quoteToken, groupId = null) {'
start = norm.find(sig)
if start == -1:
    raise SystemExit('process_cmd signature not found')

# Find the closing brace for process_cmd using a simple brace scanner.
brace = 0
in_string = False
escape = False
string_char = ''
proc_end = None
for i, ch in enumerate(norm[start:], start):
    if in_string:
        if escape:
            escape = False
        elif ch == '\\':
            escape = True
        elif ch == string_char:
            in_string = False
    else:
        if ch in ('"', "'", '`'):
            in_string = True
            string_char = ch
        elif ch == '{':
            brace += 1
        elif ch == '}':
            brace -= 1
            if brace == 0:
                proc_end = i
                break

if proc_end is None:
    raise SystemExit('process_cmd end not found')

body_start_marker = '    let chat_type = "[cmd] -";\n    console.log(`${chat_type} command: ${cmd} - param: ${param}`);\n    let msg = "";\n'
body_start = norm.find(body_start_marker, start, proc_end)
if body_start == -1:
    raise SystemExit('body start marker not found')
body_start += len(body_start_marker)

body_end_marker = '    //console.log(replyMessages)\n    return replyMessages;'
body_end = norm.rfind(body_end_marker, body_start, proc_end)
if body_end == -1:
    raise SystemExit('body end marker not found')
body_end += len(body_end_marker)

body_text = norm[body_start:body_end]

helper_lines = [
    'async function handleCommandSwitch(context) {',
    '    const { cmd, param, quoteToken, groupId, is_flex, rank_val, debt_val, member, member_id, member_name, target_line_user_id, is_mention } = context;',
    '    let chat_type = "[cmd] -";',
    '    console.log(`${chat_type} command: ${cmd} - param: ${param}`);',
    '    let msg = "";',
    '    let sub = null;',
    '    let altText;',
    '    let msg_type = 0;',
    '    let obj;',
    '    let week;',
    '',
    body_text.rstrip('\n'),
    '}',
    ''
]
helper_text = '\n'.join(helper_lines)

if 'async function handleCommandSwitch' in norm:
    raise SystemExit('handleCommandSwitch already exists')

# Replace the command body inside process_cmd with a delegation.
prefix = norm[:body_start]
post = norm[body_end:proc_end]
new_proc = prefix + '    return handleCommandSwitch({ cmd, param, quoteToken, groupId, is_flex, rank_val, debt_val, member, member_id, member_name, target_line_user_id, is_mention });\n' + post + norm[proc_end:]

new_text = norm[:start] + helper_text + new_proc

if new_text.count('async function handleCommandSwitch') != 1:
    raise SystemExit(f'handleCommandSwitch count: {new_text.count("async function handleCommandSwitch")}')
if new_text.count('return handleCommandSwitch({') != 1:
    raise SystemExit(f'delegation count: {new_text.count("return handleCommandSwitch({")}')

path.write_text(new_text.replace('\n', orig_nl), encoding='utf-8')
print('rewrite applied successfully')
