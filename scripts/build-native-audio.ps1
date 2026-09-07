$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'native\process-audio'
$build = Join-Path $root 'native\process-audio\build'
cmake.exe -S $source -B $build -G 'Visual Studio 18 2026' -A x64
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
cmake.exe --build $build --config Release
exit $LASTEXITCODE
