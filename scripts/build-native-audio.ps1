$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'native\process-audio'
$build = Join-Path $root 'native\process-audio\build'
$package = Get-Content -Raw (Join-Path $root 'package.json') | ConvertFrom-Json
if ($package.version -notmatch '^(\d+)\.(\d+)\.(\d+)$') {
  throw 'O helper nativo exige uma versao semver estavel, como 1.2.3.'
}
$version = $package.version
cmake.exe -S $source -B $build -A x64 "-DPOGLIVE_VERSION=$version"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
cmake.exe --build $build --config Release
exit $LASTEXITCODE
