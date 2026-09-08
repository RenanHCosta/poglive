# SignPath configuration templates

These files are reviewed source-of-truth templates for the SignPath dashboard; the
service does not import them automatically from the repository.

- `windows-app-v1.xml` signs only Poglive-owned `Poglive.exe` and
  `poglive-process-audio.exe`. It requires the Windows resource version, such as
  `0.2.0.0`.
- `windows-packages-v1.xml` signs the final NSIS installer and portable executable. It
  requires the application version, such as `0.2.0`.

After SignPath provisions the open-source organization, create artifact configurations
with the exact slugs used as filenames and paste the XML into the editor. Upload an
unsigned sample produced by the tagged GitHub workflow, compare SignPath's generated
analysis and retain the metadata restrictions before activation.

Changes to these templates or `.github/workflows/release.yml` affect the signed trust
boundary and require maintainer review.
