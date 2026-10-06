"""Download a private gzip backup through bounded Railway SSH frames, resumably.
Usage: python3 scripts/download-production-backup.py /tmp/backup.sqlite.gz LOCAL.sqlite.gz
This does not create backups, print records, or change the production database.
"""
import base64
import concurrent.futures
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

remote, local = sys.argv[1:3]
destination = Path(local)
parts = Path(str(destination) + '.parts')
parts.mkdir(mode=0o700, parents=True, exist_ok=True)

def command(code):
    result = subprocess.run(['railway', 'ssh', 'node --disable-warning=ExperimentalWarning -e ' + shlex.quote(code)], capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError('Backup transport failed: ' + result.stderr.decode(errors='replace')[:200])
    return result.stdout

size = json.loads(command("const fs=require('node:fs');console.log(JSON.stringify({bytes:fs.statSync(" + json.dumps(remote) + ").size}));").strip())['bytes']
chunk = 8 * 1024 * 1024

def fetch_part(index):
    offset = index * chunk
    length = min(chunk, size - offset)
    path = parts / str(index)
    if path.exists() and path.stat().st_size == length:
        return
    code = "const fs=require('node:fs');const fd=fs.openSync(" + json.dumps(remote) + ",'r');const b=Buffer.alloc(" + str(length) + ");let n=0;while(n<b.length){const read=fs.readSync(fd,b,n,b.length-n," + str(offset) + "+n);if(!read)throw Error('Truncated source');n+=read;}process.stdout.write('DATA:'+b.toString('base64'));fs.closeSync(fd);"
    raw = command(code).split(b'DATA:', 1)[1].replace(b'\r', b'').replace(b'\n', b'')
    data = base64.b64decode(raw, validate=True)
    if len(data) != length:
        raise RuntimeError('Truncated backup frame')
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'wb') as output:
        output.write(data)

count = (size + chunk - 1) // chunk
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    list(pool.map(fetch_part, range(count)))
descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(descriptor, 'wb') as output:
    for index in range(count):
        output.write((parts / str(index)).read_bytes())
print(json.dumps({'downloadedBytes': size, 'chunks': count, 'path': str(destination)}))
