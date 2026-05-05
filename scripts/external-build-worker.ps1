param(
    [Parameter(Mandatory=$true)] [string]$ApiBaseUrl,
    [string]$WorkerToken = "",
    [string]$WorkDir = ".\worker-data",
    [string]$PowerShellPath = "pwsh",
    [string]$BuildScript = "",
    [int]$PollIntervalSeconds = 10,
    [switch]$Once
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($BuildScript)) {
    $BuildScript = Join-Path $PSScriptRoot "build-esxi-iso.ps1"
}

function Get-WorkerHeaders {
    $headers = @{}
    if (-not [string]::IsNullOrWhiteSpace($WorkerToken)) {
        $headers["X-Worker-Token"] = $WorkerToken
    }
    return $headers
}

function Join-ApiUrl([string]$Path) {
    return $ApiBaseUrl.TrimEnd("/") + "/" + $Path.TrimStart("/")
}

function Send-Progress([string]$TaskId, [int]$Progress, [string]$Log, [string]$Status = "running", [string]$ErrorMessage = "") {
    $body = @{
        progress = $Progress
        log = $Log
        status = $Status
        error_message = $ErrorMessage
    } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Post -Uri (Join-ApiUrl "/api/worker/builds/$TaskId/progress") -Headers (Get-WorkerHeaders) -ContentType "application/json" -Body $body | Out-Null
}

function Save-WorkerFile([uint32]$BucketId, [string]$ObjectPath, [string]$DestinationRoot) {
    $fileName = Split-Path $ObjectPath -Leaf
    $destination = Join-Path $DestinationRoot $fileName
    $encodedPath = [System.Uri]::EscapeDataString($ObjectPath)
    $url = Join-ApiUrl "/api/worker/files?bucket_id=$BucketId&path=$encodedPath"
    Invoke-WebRequest -Uri $url -Headers (Get-WorkerHeaders) -OutFile $destination
    return $destination
}

function Invoke-BuildProcess([string]$TaskId, [object]$Task, [string]$TaskDir) {
    $inputDir = Join-Path $TaskDir "input"
    $buildDir = Join-Path $TaskDir "build"
    $outputPath = Join-Path $TaskDir $Task.output_iso_name
    New-Item -ItemType Directory -Force -Path $inputDir, $buildDir | Out-Null

    Send-Progress -TaskId $TaskId -Progress 5 -Log "Downloading depot: $($Task.depot_path)"
    $depotLocal = Save-WorkerFile -BucketId $Task.bucket_id -ObjectPath $Task.depot_path -DestinationRoot $inputDir

    $driverLocals = @()
    foreach ($driverPath in @($Task.driver_paths)) {
        Send-Progress -TaskId $TaskId -Progress 10 -Log "Downloading driver: $driverPath"
        $driverLocals += Save-WorkerFile -BucketId $Task.bucket_id -ObjectPath $driverPath -DestinationRoot $inputDir
    }

    $arguments = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $BuildScript,
        "-DepotPath", $depotLocal,
        "-DriverPaths", ($driverLocals -join ","),
        "-OutputPath", $outputPath,
        "-ESXiVersion", $Task.esxi_version,
        "-WorkDir", $buildDir
    )

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $PowerShellPath
    foreach ($arg in $arguments) {
        $psi.ArgumentList.Add($arg) | Out-Null
    }
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $psi
    if (-not $process.Start()) {
        throw "failed to start build process"
    }

    while (-not $process.HasExited) {
        while (-not $process.StandardOutput.EndOfStream) {
            Report-BuildLine -TaskId $TaskId -Line $process.StandardOutput.ReadLine()
        }
        while (-not $process.StandardError.EndOfStream) {
            $line = $process.StandardError.ReadLine()
            if (-not [string]::IsNullOrWhiteSpace($line)) {
                Send-Progress -TaskId $TaskId -Progress 0 -Log $line
            }
        }
        Start-Sleep -Milliseconds 250
    }

    while (-not $process.StandardOutput.EndOfStream) {
        Report-BuildLine -TaskId $TaskId -Line $process.StandardOutput.ReadLine()
    }
    while (-not $process.StandardError.EndOfStream) {
        $line = $process.StandardError.ReadLine()
        if (-not [string]::IsNullOrWhiteSpace($line)) {
            Send-Progress -TaskId $TaskId -Progress 0 -Log $line
        }
    }

    if ($process.ExitCode -ne 0) {
        throw "build process exited with code $($process.ExitCode)"
    }
    if (-not (Test-Path $outputPath)) {
        throw "build process completed but output ISO was not found: $outputPath"
    }
    return $outputPath
}

function Report-BuildLine([string]$TaskId, [string]$Line) {
    if ([string]::IsNullOrWhiteSpace($Line)) {
        return
    }
    if ($Line -match '^\[PROGRESS\]\s+(\d+)\s*(.*)$') {
        Send-Progress -TaskId $TaskId -Progress ([int]$Matches[1]) -Log $Matches[2]
        return
    }
    if ($Line -match '^\[ERROR\]\s*(.*)$') {
        Send-Progress -TaskId $TaskId -Progress 0 -Log $Matches[1]
        return
    }
    if ($Line -match '^\[SUCCESS\]\s*(.*)$') {
        Send-Progress -TaskId $TaskId -Progress 99 -Log $Matches[1]
        return
    }
    Send-Progress -TaskId $TaskId -Progress 0 -Log $Line
}

function Send-Artifact([string]$TaskId, [string]$OutputPath) {
    $form = @{
        file = Get-Item $OutputPath
    }
    Invoke-RestMethod -Method Post -Uri (Join-ApiUrl "/api/worker/builds/$TaskId/artifact") -Headers (Get-WorkerHeaders) -Form $form | Out-Null
}

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

do {
    $claim = Invoke-RestMethod -Method Post -Uri (Join-ApiUrl "/api/worker/builds/claim") -Headers (Get-WorkerHeaders)
    if ($null -eq $claim.data) {
        if ($Once) {
            break
        }
        Start-Sleep -Seconds $PollIntervalSeconds
        continue
    }

    $task = $claim.data
    $taskDir = Join-Path $WorkDir $task.task_id
    New-Item -ItemType Directory -Force -Path $taskDir | Out-Null

    try {
        Send-Progress -TaskId $task.task_id -Progress 1 -Log "External worker claimed task $($task.task_id)"
        $outputPath = Invoke-BuildProcess -TaskId $task.task_id -Task $task -TaskDir $taskDir
        Send-Progress -TaskId $task.task_id -Progress 99 -Log "Uploading ISO artifact"
        Send-Artifact -TaskId $task.task_id -OutputPath $outputPath
    } catch {
        $message = $_.Exception.Message
        Send-Progress -TaskId $task.task_id -Progress 0 -Log $message -Status "failed" -ErrorMessage $message
    }

    if ($Once) {
        break
    }
} while ($true)
