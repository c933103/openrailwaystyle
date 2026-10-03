#!/usr/bin/env python3
"""Load the published worldwide snapshot; never download operator feeds here."""
import argparse
from pathlib import Path
import tarfile
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import urlopen

URL='https://github.com/c933103/openrailwaystyle/releases/download/service-frequency-data/frequency-snapshot.tar.gz'


def unpack(path, output):
    output.mkdir(parents=True, exist_ok=True)
    with tarfile.open(path, 'r:gz') as archive:
        members=archive.getmembers()
        if sum(m.size for m in members)>12_000_000_000:
            raise ValueError('Snapshot exceeds expanded byte budget')
        for member in members:
            name=Path(member.name)
            if name.is_absolute() or '..' in name.parts or member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                raise ValueError('Unsafe snapshot member')
            if name.parts and name.parts[0] not in {'manifest.json','inventory.json','feeds','tiles'}:
                raise ValueError('Unexpected snapshot member')
        archive.extractall(output, members=members, filter='data')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive',type=Path)
    parser.add_argument('--output',type=Path,default=Path('styles/data/service-frequency'))
    args=parser.parse_args()
    if args.archive:
        unpack(args.archive,args.output);return
    with tempfile.TemporaryDirectory() as temp:
        path=Path(temp)/'snapshot.tar.gz'
        for attempt in range(3):
            try:
                with urlopen(URL,timeout=60) as response,path.open('wb') as file:
                    size=0
                    while chunk:=response.read(1_048_576):
                        size+=len(chunk)
                        if size>1_500_000_000:raise ValueError('Snapshot exceeds download byte budget')
                        file.write(chunk)
                break
            except HTTPError as error:
                if error.code!=404:raise
                # An existing release with a temporarily replaced/missing
                # asset must not be mistaken for initial no-data startup.
                try:
                    with urlopen('https://api.github.com/repos/c933103/openrailwaystyle/releases/tags/service-frequency-data',timeout=30):pass
                except HTTPError as release_error:
                    if release_error.code!=404:raise
                    print('No worldwide frequency release yet; frequency coverage remains unknown.');return
                if attempt==2:raise ValueError('Worldwide data release exists but its snapshot asset is missing')
                time.sleep(5)
        unpack(path,args.output)


if __name__=='__main__':main()
