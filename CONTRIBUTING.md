# Contributing to Poglive

Contributions are welcome under the project's MIT license.

1. Open an issue for substantial behavioral or protocol changes.
2. Create a focused branch and avoid committing generated files, credentials or room
   invitations.
3. Run `npm ci`, `npm run check` and `npm test`.
4. Open a pull request describing behavior, security implications and manual tests.
5. Wait for maintainer review before merging.

Changes to release workflows, `.signpath`, capture, networking, updates or native code
receive additional review because they affect the release trust boundary. Contributors
must not attempt to submit artifacts to the repository's reserved SignPath workflows or
future signing policies.
