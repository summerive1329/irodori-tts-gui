$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "..\launch_helpers.ps1")

$script:attempts = 0
Wait-ForHttpEndpoint `
    -Url "http://127.0.0.1:8000/api/health" `
    -TimeoutSeconds 2 `
    -PollIntervalMilliseconds 10 `
    -Probe {
        param([string]$Url)
        $script:attempts += 1
        return $script:attempts -ge 3
    }

if ($script:attempts -ne 3) {
    throw "Expected 3 health probes, got $script:attempts."
}

Write-Output "launch helper tests passed"
