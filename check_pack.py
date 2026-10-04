"""check_pack.py — assert every workspace's published tarball actually contains its entry points.

`npm pack --dry-run --workspaces` exits 0 even when a package's `files` field points at a
directory that doesn't exist — it silently ships a near-empty tarball (just README.md and
package.json, no code) rather than failing loudly (confirmed empirically 2026-08-19, breaking
@dojo-ng/button's `files` on purpose: exit code stayed 0). An exit-code-only pack check would
never catch that, so this parses `npm pack --json`'s per-package file list and asserts each
package's `main`, `module`, and `types` entries are actually present in its own tarball.

Run from framework/:  python3 check_pack.py

DUPLICATE NOTICE: this file is copied as-is from `components/check_pack.py`. There is no shared
location between the two repos today, so this is deliberate duplication, not drift by accident.
A fix made in one copy needs to be made in the other by
hand; neither repo currently has a mechanism that would catch the two diverging.
"""

import json
import subprocess
import sys


def main():
    result = subprocess.run(
        ["npm", "pack", "--dry-run", "--json", "--workspaces"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"check_pack: npm pack exited {result.returncode}")
        print(result.stdout)
        print(result.stderr)
        sys.exit(1)

    packages = json.loads(result.stdout)
    failures = []
    for pkg in packages:
        name = pkg["name"]
        packed_paths = {f["path"] for f in pkg["files"]}
        manifest = next(f for f in pkg["files"] if f["path"] == "package.json")
        # entryCount includes package.json itself; re-read the source package.json for the
        # fields npm pack doesn't echo back (main/module/types), keyed by workspace name.
        src = json.load(open(f"packages/{name.split('/')[-1]}/package.json"))
        for field in ("main", "module", "types"):
            entry = src.get(field)
            if not entry:
                continue
            entry = entry.lstrip("./")
            if entry not in packed_paths:
                failures.append(f"{name}: {field} ({entry}) missing from its own tarball")
        if len(packed_paths) <= 2:  # just package.json + README, no real content
            failures.append(f"{name}: tarball has no content beyond package.json/README.md")

    if failures:
        print("check_pack: published tarball doesn't match what package.json promises:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)

    print(f"check_pack: clean, {len(packages)} packages verified")


if __name__ == "__main__":
    main()
