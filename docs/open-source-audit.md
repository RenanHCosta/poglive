# Open-source readiness audit

Audit date: 2026-09-08.

## Project ownership

The Git history inspected during this audit identifies `RenanHCosta` as the source
author. The maintainer confirmed that the project may be licensed under the MIT
License in the name of Renan Costa.

## Dependencies

The installed production npm dependency tree declares permissive open-source licenses,
including MIT, ISC, BSD, Apache-2.0 and BlueOak licenses. The build runs
`scripts/generate-third-party-notices.mjs`, which generates the notices bundled with
each app. It fails when a package has no usable license text; the sole exception is
`lazy-val`, whose package declares MIT and names its author but omits the license file,
so the generator supplies the standard MIT terms with that author attribution.

Electron packages their own Electron and Chromium license files. Windows system
libraries and SDK headers used by the native helper are system components and are not
copied into this repository.

## Removed generated and unlicensed material

`native/process-audio/build` previously contained local CMake/MSVC output and is now
ignored and rebuilt from `main.cpp`, `version.rc.in` and `CMakeLists.txt`.

Two sound files whose names referred to Discord did not have documented redistribution
terms. They were removed from the build and replaced with short tones generated at
runtime from original Web Audio code. No Discord binary, SDK or asset is included.

## Secrets

No environment files, private keys, code-signing certificates or credential files are
intended to be tracked. `.gitignore` excludes environment files. SignPath API material
must exist only in GitHub Actions secrets and must never be committed.

A scan of all Git patches and object names found no high-confidence private-key, GitHub
token, AWS key, Google API key or Slack token pattern and no credential-like filename.
This does not replace revoking any credential that a maintainer knows was previously
committed or shared.

This audit is a technical inventory, not legal advice. New dependencies or assets must
be reviewed before they enter a signed release.
