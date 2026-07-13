#!/bin/bash
# NISRA -> Internet Archive mirror, run unattended on a small cloud VM (e.g. GCP
# e2-micro). Invoked by the instance startup-script AFTER the repo has been
# cloned to /root/civgraph. Reads the IA S3 keys from instance metadata, then
# streams each planned file  download -> `ia upload --no-derive` -> delete,
# resumable (skips files already present in each item), pausing after the first
# item for supervision, then powering the VM off. Output goes to the serial
# console (visible via `gcloud compute instances get-serial-port-output`).
set -uo pipefail
export HOME=/root DEBIAN_FRONTEND=noninteractive
echo "=== NISRA IA mirror: start $(date -u) ==="

META="http://metadata.google.internal/computeMetadata/v1/instance/attributes"
IAS3_ACCESS="$(curl -s -H 'Metadata-Flavor: Google' "$META/IAS3_ACCESS" || true)"
IAS3_SECRET="$(curl -s -H 'Metadata-Flavor: Google' "$META/IAS3_SECRET" || true)"
PAUSE="$(curl -s -H 'Metadata-Flavor: Google' "$META/pause_after_first" 2>/dev/null || echo 300)"
[ -z "${PAUSE:-}" ] && PAUSE=300
if [ -z "$IAS3_ACCESS" ] || [ -z "$IAS3_SECRET" ]; then echo "FATAL: IA S3 keys missing from metadata"; poweroff; exit 1; fi

PLAN="/root/civgraph/data/census/source-inventory/nisra-ia-mirror-plan.json"
[ -f "$PLAN" ] || { echo "FATAL: plan not found at $PLAN (repo clone failed?)"; poweroff; exit 1; }

apt-get update -y >/dev/null 2>&1 && apt-get install -y python3-pip curl >/dev/null 2>&1
pip3 install --quiet internetarchive 2>/dev/null || pip3 install --quiet --break-system-packages internetarchive
mkdir -p /root/.config/internetarchive
printf '[s3]\naccess = %s\nsecret = %s\n' "$IAS3_ACCESS" "$IAS3_SECRET" > /root/.config/internetarchive/ia.ini

cat > /root/mirror.py <<'PY'
import json, os, subprocess, time, urllib.request
PAUSE = int(os.environ.get('PAUSE', '300'))
plan = json.load(open(os.environ['PLAN']))
items = plan['items']
META = ['--metadata=title:NISRA statistical data files (mirror)',
        '--metadata=mediatype:data',
        '--metadata=licenseurl:https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
        '--metadata=description:Mirror of NISRA statistical data files (Open Government Licence v3.0). Source: https://www.nisra.gov.uk/publications',
        '--metadata=subject:NISRA', '--metadata=subject:Northern Ireland', '--metadata=subject:statistics']

def existing(item):
    try:
        m = json.load(urllib.request.urlopen('https://archive.org/metadata/%s' % item, timeout=90))
        return {f['name'] for f in m.get('files', [])}
    except Exception:
        return set()

paused = False
for i, it in enumerate(items):
    item = it['itemId']
    have = existing(item)
    meta_added = len(have) > 0
    todo = [f for f in it['files'] if f['remoteName'] not in have]
    print('== item %d/%d %s: %d files, %d present, %d to do' % (i+1, len(items), item, it['fileCount'], len(have), len(todo)), flush=True)
    for f in todo:
        tmp = '/root/f.bin'
        try:
            subprocess.run(['curl','-sL','--fail','--max-time','600', f['url'], '-o', tmp], check=True)
            args = ['ia','upload', item, tmp, '--remote-name=%s' % f['remoteName'], '--no-derive', '--retries', '4']
            if not meta_added:
                args += META; meta_added = True
            subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
        except Exception as e:
            print('  FAIL %s: %s' % (f['remoteName'], e), flush=True)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
    print('== item %d done (%s)' % (i+1, item), flush=True)
    if not paused:
        paused = True
        print('== SUPERVISION PAUSE: first item complete. Sleeping %ds — delete the VM now to abort, else it continues. ==' % PAUSE, flush=True)
        time.sleep(PAUSE)
print('== ALL %d ITEMS PROCESSED ==' % len(items), flush=True)
PY

echo "=== mirroring (pause_after_first=${PAUSE}s) ==="
PLAN="$PLAN" PAUSE="$PAUSE" python3 /root/mirror.py
echo "=== NISRA IA mirror complete $(date -u); powering off ==="
poweroff
