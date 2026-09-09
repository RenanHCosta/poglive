param(
  [Parameter(Mandatory = $true)]
  [string[]]$Path
)

$ErrorActionPreference = 'Stop'

foreach ($item in $Path) {
  if (-not (Test-Path -LiteralPath $item -PathType Leaf)) {
    throw "Unsigned artifact not found: $item"
  }

  $signature = Get-AuthenticodeSignature -LiteralPath $item
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::NotSigned) {
    throw "Expected an unsigned artifact at $item, but Authenticode status is $($signature.Status)."
  }
}

Write-Host "Verified $($Path.Count) unsigned artifacts."
