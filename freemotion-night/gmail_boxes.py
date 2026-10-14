# freemotion-night/gmail_boxes.py — the Gmail inboxes the mail scripts read (imap-link, imap-otp, check-sent,
# inbox-replies, followups).
#
# Applications give a new address since 2026-10-14 (GMAIL_APPLY_USER in .env); the ~3,000
# before went out with the older one (GMAIL_MACHAKA_USER), and their replies keep arriving
# there. So every reader reads both: the new inbox first, then the old one. Each needs its Gmail app password
# (GMAIL_APPLY_APP_PASSWORD, GMAIL_MACHAKA_APP_PASSWORD); a box without one is left out.
import imaplib, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PAIRS = (('GMAIL_APPLY_USER', 'GMAIL_APPLY_APP_PASSWORD'), ('GMAIL_MACHAKA_USER', 'GMAIL_MACHAKA_APP_PASSWORD'))

def load_env():
    env = {}
    for line in open(os.path.join(ROOT, '.env'), encoding='utf-8'):
        if '=' in line and not line.lstrip().startswith('#'):
            k, v = line.split('=', 1); env[k.strip()] = v.strip().strip('"').strip("'")
    return env

def accounts():
    """-> [(address, app password)], newest address first, each once."""
    env, out = load_env(), []
    for u, p in PAIRS:
        user, pw = env.get(u, ''), env.get(p, '')
        if user and pw and user.lower() not in (a.lower() for a, _ in out): out.append((user, pw))
    if not out: sys.exit('no Gmail login in .env: set GMAIL_APPLY_USER + GMAIL_APPLY_APP_PASSWORD or GMAIL_MACHAKA_USER + GMAIL_MACHAKA_APP_PASSWORD')
    return out

def addresses():
    """The candidate's own addresses, lowercased: mail from them is ours, mail to them is for the candidate."""
    return [a.lower() for a, _ in accounts()]

def all_mail(M):
    """Gmail's All Mail folder (name depends on the account's language): archived and filtered mail too.
    Reading the Inbox alone missed 109 of 501 application emails since 2026-10-01. Not spam, not bin."""
    for line in M.list()[1]:
        line = line.decode('utf-8', 'replace')
        if '\\All' in line: return line.rsplit(' "/" ', 1)[-1].strip()
    return 'INBOX'

def login(user, pw, folder='all'):
    """An IMAP connection to this box; folder 'all' = All Mail (read-only), None = nothing selected, else that folder (read-only)."""
    M = imaplib.IMAP4_SSL('imap.gmail.com'); M.login(user, pw)
    if folder: M.select(all_mail(M) if folder == 'all' else folder, readonly=True)
    return M
