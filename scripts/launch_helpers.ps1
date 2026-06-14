function Wait-ForHttpEndpoint {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,
        [int]$TimeoutSeconds = 60,
        [int]$PollIntervalMilliseconds = 250,
        [scriptblock]$Probe = {
            param([string]$Endpoint)
            try {
                $response = Invoke-WebRequest `
                    -Uri $Endpoint `
                    -UseBasicParsing `
                    -TimeoutSec 2
                return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
            } catch {
                return $false
            }
        }
    )

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    while ($stopwatch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        if (& $Probe $Url) {
            return
        }
        Start-Sleep -Milliseconds $PollIntervalMilliseconds
    }

    throw "Timed out waiting for $Url after $TimeoutSeconds seconds. Check the server window for startup errors."
}
