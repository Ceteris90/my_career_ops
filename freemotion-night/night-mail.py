# freemotion-night/night-mail.py [--to <address>] [--every 10] [--dry-run]
# The address is NIGHT_MAIL_TO in .env unless --to is given.
# Progress emails for a full night run (full-night.sh): it reads tmp/fm/night/full-night.log as the night
# writes it, from the last "##### full night run" line on, and sends
#   - one email when it starts,
#   - one every --every finished jobs (default 10; 0 = none),
#   - one at the end of each round, and one when the night is done (then it exits).
# Each says what every job ended as (company and role from tmp/fm/night/job-<N>.json), the counts for the
# round and for the night, and the notes the run printed (a driver out, a wait, a failure), with the
# Claude and Codex allowances run.sh prints before each round (claude-usage.mjs).
# Sent through Gmail's SMTP with the .env login the other mail scripts use (GMAIL_MACHAKA_USER,
# GMAIL_MACHAKA_APP_PASSWORD). --dry-run prints the emails instead. It gives up after 30 hours.
import argparse, json, os, re, smtplib, sys, time
from collections import Counter
from email.message import EmailMessage

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
LOG = os.path.join(ROOT, 'tmp/fm/night/full-night.log')
ap = argparse.ArgumentParser()
ap.add_argument('--to')   # default: NIGHT_MAIL_TO in .env
ap.add_argument('--every', type=int, default=10)
ap.add_argument('--dry-run', action='store_true')
args = ap.parse_args()

env = {}
for line in open(os.path.join(ROOT, '.env'), encoding='utf-8'):
    if '=' in line and not line.lstrip().startswith('#'):
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
user, pw = env.get('GMAIL_MACHAKA_USER'), env.get('GMAIL_MACHAKA_APP_PASSWORD')
if not args.dry_run and (not user or not pw):
    sys.exit('GMAIL_MACHAKA_USER and GMAIL_MACHAKA_APP_PASSWORD must be set in .env')
args.to = args.to or env.get('NIGHT_MAIL_TO')
if not args.dry_run and not args.to:
    sys.exit('no address: pass --to or set NIGHT_MAIL_TO in .env')


def send(subject, body):
    if args.dry_run:
        print(f'--- {subject}\n{body}\n', flush=True); return
    m = EmailMessage()
    m['From'], m['To'], m['Subject'] = user, args.to, subject
    m.set_content(body)
    for attempt in range(3):   # the network drops now and then at night; a lost email is not worth a crash
        try:
            with smtplib.SMTP_SSL('smtp.gmail.com', 465, timeout=60) as s:
                s.login(user, pw); s.send_message(m)
            print(f'sent: {subject}', flush=True); return
        except Exception as e:
            print(f'not sent ({e}); attempt {attempt + 1}', flush=True); time.sleep(60)


def job_name(num):
    try:
        j = json.load(open(os.path.join(ROOT, f'tmp/fm/night/job-{num}.json'), encoding='utf-8'))
        return f"{j['co']} — {j['title']}"
    except Exception:
        return ''


def counts(jobs):
    c = Counter(o for _, _, o in jobs)
    return ', '.join(f'{n} {o}' for o, n in c.most_common()) or 'no job yet'


def body(round_no, jobs, notes, night):
    lines = [f'Round {round_no}: {len(jobs)} job(s): {counts(jobs)}', f'Night so far: {len(night)} job(s): {counts(night)}', '']
    lines += [f'{o:<16} {n} ({d})  {job_name(n)}' for n, d, o in jobs]
    if notes: lines += ['', 'Notes:'] + [f'  {x}' for x in notes]
    return '\n'.join(lines)


JOB = re.compile(r'^job (\d+) \(([^)]+)\): (.*)$')
round_no, jobs, notes, night, mailed, pos, buf = 0, [], [], [], 0, None, b''
deadline = time.time() + 30 * 3600
while time.time() < deadline:
    if not os.path.exists(LOG): time.sleep(30); continue
    with open(LOG, 'rb') as f:
        if pos is None:   # start at this night's first line
            data = f.read(); pos = max(data.rfind(b'##### full night run'), 0)
        f.seek(pos); chunk = f.read(); pos = f.tell()
    buf += chunk
    *done, buf = buf.split(b'\n')
    for raw in done:
        line = raw.decode('utf-8', 'replace').rstrip('\r')
        if line.startswith('##### full night run'):
            send('Full night run: started', line.lstrip('# '))
        elif line.startswith('===== round'):
            round_no, jobs, notes, mailed = round_no + 1, [], [], 0
        elif JOB.match(line):
            n, d, o = JOB.match(line).groups()
            if 'skipped' in o: continue
            jobs.append((n, d, o or 'no result')); night.append(jobs[-1])
            if args.every and len(jobs) - mailed >= args.every:
                mailed = len(jobs)
                send(f'Full night run: round {round_no}, {len(jobs)} jobs: {counts(jobs)}', body(round_no, jobs, notes, night))
        elif line.startswith('note: ') and not line.startswith('note: round'):
            notes.append(line[6:])
        elif line.startswith('allowance: '):   # run.sh, before each round: Claude's and Codex's windows
            notes.append(line[11:])
        elif line == 'ALL DONE' or 'nothing to apply to this round' in line or 'no jobs this round' in line:
            send(f'Full night run: round {round_no} done: {counts(jobs)}', body(round_no, jobs, notes, night))
        elif line.startswith('FULL NIGHT DONE'):
            send(f'Full night run: finished, {len(night)} jobs: {counts(night)}', f'{line}\n\nNight: {len(night)} job(s): {counts(night)}')
            sys.exit(0)
    time.sleep(30)
