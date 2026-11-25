import argparse
import json
import re
import sys


def select_release_base(tag: str, releases: list[dict], allow_first_release: bool = False) -> str:
    match = re.fullmatch(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:[-+].+)?', tag)
    if not match:
        raise ValueError(f'Invalid release tag: {tag}')
    current = tuple(map(int, match.groups()))
    candidates = []
    for release in releases:
        if release['draft'] or release['prerelease']:
            continue
        previous = re.fullmatch(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', release['tag_name'])
        if previous:
            version = tuple(map(int, previous.groups()))
            if version < current:
                candidates.append((version, release['tag_name']))
    if not candidates:
        if allow_first_release and not any(not release['draft'] and not release['prerelease'] for release in releases):
            return ''
        raise ValueError(f'No published stable release precedes {tag}')
    return max(candidates)[1]


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('tag')
    parser.add_argument('--allow-first-release', action='store_true')
    args = parser.parse_args()
    pages = json.load(sys.stdin)
    print(select_release_base(args.tag, [release for page in pages for release in page], args.allow_first_release))
