# SignPath Foundation application

> Historical record: this application was submitted in September 2026 and was not
> accepted because Poglive had not yet established the public visibility and external
> adoption required by the Foundation program. No technical, security or licensing
> defect was cited. Keep this document as preparation material for a future application;
> do not represent the project as approved.

Status: repository preparation complete; external application and approval pending.

## Application text

```text
Subject: SignPath Foundation OSS code-signing application — Poglive

Hello,

I would like to apply for free Windows code signing through SignPath Foundation
for Poglive.

Project: Poglive
Repository: https://github.com/RenanHCosta/poglive
Releases: https://github.com/RenanHCosta/poglive/releases/tag/v0.2.0
License: MIT (OSI-approved, no commercial dual-licensing)
Platform: Windows 10/11 x64
Maintainer: Renan Costa (https://github.com/RenanHCosta)

Poglive is an open-source Electron desktop application for private peer-to-peer
screen sharing. Users explicitly create or join private rooms, select a screen or
window to capture and may optionally share audio. Signaling uses an authenticated
TLS connection to the room host; media travels directly between participants over
WebRTC. The installed edition checks this public GitHub Releases repository for
updates. Poglive has no accounts, analytics, advertising or developer-operated
collection service.

The optional Windows audio helper uses Microsoft's documented Application Loopback
API to capture a user-selected process tree or exclude Discord audio. It does not
inject code, extract tokens, read process memory, modify another client, bypass a
security control or request elevation. If selective capture is unavailable, it stops
instead of silently falling back to global system audio.

Windows artifacts are built from the public repository on GitHub-hosted Windows
runners. The planned pipeline uses GitHub origin verification and manual approval
for every signing request. It signs Poglive's own application and native helper,
then signs the final NSIS installer and portable executable. Updater metadata and
checksums are generated only after signing.

Code signing policy:
https://github.com/RenanHCosta/poglive/blob/main/CODE_SIGNING_POLICY.md

Privacy policy:
https://github.com/RenanHCosta/poglive/blob/main/PRIVACY.md

Security policy:
https://github.com/RenanHCosta/poglive/blob/main/SECURITY.md

Open-source audit:
https://github.com/RenanHCosta/poglive/blob/main/docs/open-source-audit.md

I control the repository, all project members use GitHub MFA, and I will act as
committer, reviewer and signing approver. The project has already published Windows
releases in the same NSIS and portable formats that will be signed.

Thank you for supporting open-source software.
```

## Maintainer checklist before applying

1. Review and commit these files, then push them to `main`.
2. Confirm that the CI workflow is green on GitHub.
3. Enable GitHub two-factor authentication.
4. Enable private vulnerability reporting under repository **Settings → Security**.
5. Open https://signpath.org/apply.html, accept the OSS terms and submit the text above
   using the maintainer's own name and email.

## Configuration after acceptance

1. Follow the invitation from SignPath and enable MFA for the SignPath account.
2. Add the predefined `GitHub.com` trusted build system and install the SignPath GitHub
   App for `RenanHCosta/poglive`.
3. Configure project `poglive` with repository URL
   `https://github.com/RenanHCosta/poglive` and origin verification.
4. Create signing policy `release-signing`, require one manual approval by Renan Costa
   and attach the SignPath Foundation certificate assigned to the project.
5. Import the repository templates as artifact configurations with slugs
   `windows-app-v1` and `windows-packages-v1`. Upload a real unsigned sample and compare
   SignPath's analysis before activating each configuration.
6. Create a CI submitter API token limited to project `poglive` and policy
   `release-signing`.
7. In GitHub, create environment `signpath-release`, restrict it to protected version
   tags if available, and add these environment secrets:
   - `SIGNPATH_API_TOKEN`
   - `SIGNPATH_ORGANIZATION_ID`
8. Never paste either value into an issue, commit, log or conversation.
9. Set the GitHub Actions repository variable `SIGNPATH_ENABLED` to `true`. Until this
   exact value is configured, version tags intentionally use the temporary unsigned
   release job and publish an explicit warning in the release notes.
10. Publish a new patch tag. Two manual approvals will be requested: one for
    Poglive-owned inner executables and another for final packages.
11. Confirm the final signatures and auto-update from one signed version to the next.

The checked-in workflow keeps unsigned and signed releases mutually exclusive. The
unsigned path omits `publisherName` so existing unsigned installations can continue to
update. The signed path is selected only by `SIGNPATH_ENABLED=true`, uses the protected
`signpath-release` environment and requires all SignPath settings above.
