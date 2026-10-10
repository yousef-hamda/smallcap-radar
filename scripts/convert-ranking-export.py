"""Convert the streamed /api/export JSON into bounded-memory ranking JSONL.

The result can be passed directly to verify-complete-ranking.mjs --stored.
The export contains source evidence and must stay in ignored private storage.
"""
import argparse
import json
import os
import tempfile
from pathlib import Path


CHUNK = 1 << 20
MAX_RECORD = 64 << 20
MARKER = ',"results":['


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def convert(source: Path, destination: Path):
    if source.resolve() == destination.resolve():
        raise ValueError('Input and output must be different files')
    decoder = json.JSONDecoder()
    with source.open(encoding='utf-8') as reader:
        buffer = reader.read(CHUNK)
        while MARKER not in buffer:
            if len(buffer) > MAX_RECORD:
                raise ValueError('Export header exceeds the supported bound')
            part = reader.read(CHUNK)
            if not part:
                raise ValueError('Missing results array')
            buffer += part
        prefix, buffer = buffer.split(MARKER, 1)
        header = json.loads(prefix + '}')
        release = header.get('release')
        summary = header.get('summary')
        if not isinstance(release, dict) or not isinstance(release.get('runId'), str) or not release['runId']:
            raise ValueError('Missing pinned release identity')
        expected = summary.get('total') if isinstance(summary, dict) else None
        if not isinstance(expected, int) or isinstance(expected, bool) or expected <= 0:
            raise ValueError('Missing complete export count')
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=destination.parent,
                                             prefix=destination.name + '.tmp.', delete=False) as writer:
                temporary = Path(writer.name)
                writer.write(compact({'runId': release['runId'], 'release': release, 'rowCount': expected}) + '\n')
                count = 0
                symbols = set()
                position = 0
                while True:
                    if position >= len(buffer):
                        buffer = reader.read(CHUNK)
                        position = 0
                        if not buffer:
                            raise ValueError('Truncated results array')
                    if buffer[position] in ' \t\r\n,':
                        position += 1
                        continue
                    if buffer[position] == ']':
                        closing = False
                        tail = buffer[position + 1:]
                        while True:
                            for character in tail:
                                if not closing and character == '}':
                                    closing = True
                                elif character not in ' \t\r\n':
                                    raise ValueError('Unexpected content after results array')
                            tail = reader.read(CHUNK)
                            if not tail:
                                break
                        if not closing:
                            raise ValueError('Missing export closing brace')
                        break
                    try:
                        record, end = decoder.raw_decode(buffer, position)
                    except json.JSONDecodeError as error:
                        if len(buffer) - position > MAX_RECORD:
                            raise ValueError('Export record exceeds the supported bound') from error
                        part = reader.read(CHUNK)
                        if not part:
                            raise ValueError('Truncated or invalid export record') from error
                        buffer = buffer[position:] + part
                        position = 0
                        continue
                    if not isinstance(record, dict):
                        raise ValueError('Export record must be an object')
                    snapshot = record.get('snapshot')
                    evaluation = record.get('evaluation')
                    rank = record.get('rank')
                    if not isinstance(snapshot, dict) or not isinstance(evaluation, dict):
                        raise ValueError('Export record has no saved snapshot/evaluation')
                    symbol = snapshot.get('symbol')
                    if not isinstance(symbol, str) or not symbol or symbol in symbols:
                        raise ValueError('Missing or duplicate export symbol')
                    if not isinstance(rank, int) or isinstance(rank, bool) or rank != count + 1:
                        raise ValueError(f'Nonconsecutive saved rank for {symbol}')
                    writer.write(compact({'symbol': symbol, 'payload': compact(snapshot),
                                          'evaluation': compact({'opportunity': evaluation}), 'rank': rank}) + '\n')
                    symbols.add(symbol)
                    count += 1
                    position = end
                    if position >= CHUNK:
                        buffer = buffer[position:]
                        position = 0
                if count != expected:
                    raise ValueError(f'Incomplete export: {count} rows, expected {expected}')
            os.replace(temporary, destination)
            return {'runId': release['runId'], 'rows': count, 'output': str(destination)}
        finally:
            if temporary and temporary.exists():
                temporary.unlink()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    print(compact(convert(args.input, args.output)))
