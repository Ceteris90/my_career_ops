import imaplib, email, sys, re, os, datetime
from email.header import decode_header
from email.utils import parsedate_to_datetime
sys.dont_write_bytecode = True    # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gmail_boxes import accounts, addresses, login
MINE = addresses()
subj_pat = re.compile("hellowork", re.I)
since = (datetime.date.today() - datetime.timedelta(days=3)).strftime('%d-%b-%Y')
def dec(s):
    return ''.join(p.decode(e or 'utf-8', 'replace') if isinstance(p, bytes) else p for p, e in decode_header(s or ''))
found = []    # (time, lines): the newest HelloWork email of each inbox (gmail_boxes.py); the newest of those is printed
for user, pw in accounts():
    M = login(user, pw, 'INBOX')
    ids = M.search(None, f'(SINCE "{since}")')[1][0].split()[-25:]
    for i in reversed(ids):
        msg = email.message_from_bytes(M.fetch(i, '(RFC822)')[1][0][1])
        subj, frm, to = dec(msg['Subject']), dec(msg['From']), dec(msg['To'])
        if not (subj_pat.search(subj) or subj_pat.search(frm)): continue
        if not any(a in to.lower() for a in MINE): continue
        body = ''
        for part in msg.walk():
            if part.get_content_type() in ('text/plain', 'text/html'):
                try: body += part.get_payload(decode=True).decode(part.get_content_charset() or 'utf-8', 'replace')
                except Exception: pass
        try: at = parsedate_to_datetime(msg['Date']).timestamp()
        except Exception: at = 0
        found.append((at, ['FROM: ' + frm[:60], 'SUBJECT: ' + subj[:120], 'DATE: ' + dec(msg['Date'])[:30], 'BODY: ' + body]))
        break
    M.logout()
if found: print('\n'.join(max(found, key=lambda f: f[0])[1]))
