# Third-party software

Poglive is built with Electron and open-source JavaScript packages. Production
builds generate `THIRD_PARTY_NOTICES.txt` from the exact packages installed by
`npm ci`; that file is included in the application resources together with the
Electron and Chromium license files provided by Electron.

The package names, versions, declared licenses and full license texts in that
generated file are informational. Each dependency remains governed by its own
license. No dependency is relicensed under the Poglive MIT license.
