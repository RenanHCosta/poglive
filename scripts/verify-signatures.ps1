param(
  [Parameter(Mandatory = $true)]
  [string[]]$Path,
  [string]$Publisher = 'SignPath Foundation'
)

$ErrorActionPreference = 'Stop'
foreach ($item in $Path) {
  $resolved = Resolve-Path -LiteralPath $item
  $signature = Get-AuthenticodeSignature -LiteralPath $resolved
  if ($signature.Status -ne 'Valid') {
    throw "Assinatura invalida em $resolved`: $($signature.Status)"
  }
  if ($signature.SignerCertificate.Subject -notlike "*$Publisher*") {
    throw "Editor inesperado em $resolved`: $($signature.SignerCertificate.Subject)"
  }
  Write-Host "Valid: $resolved"
}
