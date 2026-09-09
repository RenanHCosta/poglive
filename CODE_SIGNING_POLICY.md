# Code signing policy

## Current status

Poglive releases are not currently signed with Authenticode. The project's September
2026 application to the SignPath Foundation program was not accepted because Poglive
does not yet have the level of public visibility and external adoption required by the
program. SignPath did not report a technical, security or licensing defect in the
project.

Official releases are built by GitHub Actions, explicitly identified as unsigned and
published with SHA-256 checksums. The update channel does not claim a signed publisher.
Poglive may reapply after it has established verifiable public recognition.

## Planned provider

If a future application is accepted: Free code signing provided by
[SignPath.io](https://signpath.io), certificate by
[SignPath Foundation](https://signpath.org).

## Scope

The policy covers the official Windows x64 installer and portable executable published
at https://github.com/RenanHCosta/poglive/releases. It also covers Poglive's own main
executable and native process-audio helper contained in those packages. Third-party
Electron and Chromium binaries are not signed with the Poglive signing entitlement;
their existing upstream signatures are preserved.

Only binaries built from this public repository may be submitted. Test binaries,
forks, local builds and third-party components must not use the release signing policy.

## Team roles

| Role                 | Member                                        |
| -------------------- | --------------------------------------------- |
| Author and committer | [Renan Costa](https://github.com/RenanHCosta) |
| Reviewer             | [Renan Costa](https://github.com/RenanHCosta) |
| Signing approver     | [Renan Costa](https://github.com/RenanHCosta) |

Contributions from people without direct write access require review before merging.
All members with repository or SignPath access must use multi-factor authentication.

## Current release controls

1. The release tag must be `v<version>`, match `package.json` exactly and point to a
   commit contained in `origin/main`.
2. Tests, static checks and all Windows builds run on GitHub-hosted runners.
3. The unsigned workflow verifies that Poglive's application, native helper, installer
   and portable executable have no Authenticode signature.
4. Update metadata, blockmap and checksums are generated from the final packages.
5. Release notes state that the artifacts are unsigned.

## Controls reserved for a future signed release

1. GitHub must be configured as the SignPath trusted build system with origin
   verification.
2. The application executable and Poglive native helper must be signed before packaging.
3. The resulting installer and portable executable must receive a second, outer-file
   signature.
4. Every SignPath request requires manual approval by the signing approver.
5. Installed updates require the `SignPath Foundation` publisher, and the workflow
   verifies each signature and expected publisher before publishing.
6. The repository variable `SIGNPATH_ENABLED=true` may be set only after the full
   SignPath configuration and credentials exist.

Product names and product versions are restricted by the SignPath artifact
configurations stored in `.signpath/artifact-configurations`.

## Privacy

Poglive's data flows, local storage, peer-to-peer connections and update checks are
documented in [PRIVACY.md](PRIVACY.md). The project does not contain analytics,
advertising or developer-operated collection services.

## Compromise and revocation

If repository, GitHub Actions or SignPath access may be compromised, signing and
publishing stop immediately. The maintainer will revoke affected credentials, notify
SignPath, investigate the exact commits and artifacts, and publish a security advisory.
Affected releases will be removed or clearly marked unsafe and certificate revocation
will be requested when appropriate.
