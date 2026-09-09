# Security policy

## Supported versions

Security fixes are provided for the latest Poglive release. Users should update before
reporting a problem that has already been fixed in a newer release.

## Reporting a vulnerability

Do not publish room invitations, secrets, private IP addresses, proof-of-concept
exploits or other sensitive details in a public issue. Prefer GitHub's private
vulnerability reporting page:

https://github.com/RenanHCosta/poglive/security/advisories/new

If private reporting is unavailable, contact the maintainer through the GitHub profile
at https://github.com/RenanHCosta and ask for a private channel before sharing details.

Include the Poglive and Windows versions, affected component, impact and minimal
reproduction steps. You should receive an acknowledgement within seven days. A fix and
disclosure schedule will be coordinated according to severity.

## Release integrity

Official downloads are published only at:

https://github.com/RenanHCosta/poglive/releases

SHA-256 checksums are attached to each release. Windows artifacts are currently
unsigned and release notes identify this limitation. The September 2026 SignPath
Foundation application was not accepted because the project does not yet meet the
program's public visibility requirement. If a future application is accepted, signed
artifacts will be announced only after their Authenticode signatures are verified.
