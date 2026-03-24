param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("add", "remove")]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$CliDir
)

$envKey = "Path"
$scope = [EnvironmentVariableTarget]::User
$current = [Environment]::GetEnvironmentVariable($envKey, $scope)
if ($null -eq $current) {
  $current = ""
}

$separator = ";"
$parts = $current.Split($separator, [System.StringSplitOptions]::RemoveEmptyEntries) |
  ForEach-Object { $_.Trim() } |
  Where-Object { $_ -ne "" }

$normalizedCliDir = [System.IO.Path]::GetFullPath($CliDir.Trim())
$comparison = [System.StringComparer]::OrdinalIgnoreCase
$filtered = New-Object System.Collections.Generic.List[string]

foreach ($part in $parts) {
  try {
    $normalizedPart = [System.IO.Path]::GetFullPath($part)
  } catch {
    $normalizedPart = $part
  }

  if (-not $comparison.Equals($normalizedPart, $normalizedCliDir)) {
    $filtered.Add($part)
  }
}

if ($Action -eq "add") {
  $filtered.Insert(0, $normalizedCliDir)
}

$next = ($filtered | Select-Object -Unique) -join $separator
[Environment]::SetEnvironmentVariable($envKey, $next, $scope)

if ($Action -eq "add") {
  if ($current -and $current.Split($separator) -contains $CliDir) {
    Write-Output "already-present"
  } else {
    Write-Output "updated"
  }
} else {
  Write-Output "updated"
}
