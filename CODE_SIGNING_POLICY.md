# Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by
[SignPath Foundation](https://signpath.org).

Status: application preparation. This policy does not claim that SignPath Foundation
has accepted Poglive or that the current downloads are signed. The status will be
updated only after acceptance and successful signature verification.

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

## Release controls

1. The release tag must be `v<version>`, match `package.json` exactly and point to a
   commit contained in `origin/main`.
2. Tests, static checks and all Windows builds run on GitHub-hosted runners.
3. GitHub is configured as the SignPath trusted build system with origin verification.
4. The application executable and Poglive native helper are signed before packaging.
5. The resulting installer and portable executable are submitted for a second,
   outer-file signature.
6. Every SignPath request requires manual approval by the signing approver.
7. Update metadata, blockmap and checksums are generated only from the final signed
   files.
8. Installed updates require the `SignPath Foundation` publisher, and the workflow
   verifies each signature and expected publisher before publishing.

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
