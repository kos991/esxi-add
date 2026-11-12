param([string]$WorkerScript = (Join-Path $PSScriptRoot "external-build-worker.ps1"))
$ErrorActionPreference = "Stop"
# Load functions only; never claim a real task or contact a server.
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($WorkerScript, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
foreach ($name in @("Save-WorkerFile", "Get-WorkerHeaders", "Join-ApiUrl")) {
    $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if ($null -eq $definition) { throw "missing function $name" }
    . ([scriptblock]::Create($definition.Extent.Text))
}
$ApiBaseUrl = "https://worker.invalid"
$WorkerToken = ""
$script:requests = 0
$script:failures = 0
function Invoke-WebRequest {
    param($Uri, $Headers, $OutFile, $TimeoutSec)
    $script:requests++
    [IO.File]::WriteAllText($OutFile, "partial")
    if ($script:failures -gt 0) {
        $script:failures--
        throw "simulated network interruption"
    }
    [IO.File]::WriteAllText($OutFile, $Uri)
}
function Start-Sleep { param($Seconds) }
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
$root = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $root | Out-Null
try {
    $memo = @{}
    $first = Save-WorkerFile 1 "a/driver.zip" $root $memo
    $repeat = Save-WorkerFile 1 "a/driver.zip" $root $memo
    $other = Save-WorkerFile 1 "b/driver.zip" $root $memo
    Assert ($script:requests -eq 2) "duplicate input downloaded again"
    Assert ($first -eq $repeat -and $first -ne $other) "object paths collided"
    Assert ((Get-Content -LiteralPath $first -Raw) -match 'a%2Fdriver.zip') "first input overwritten"
    Write-Output "Repeated-input workload: 3 references, 2 downloads, distinct same-name inputs preserved"
    $bucket = Save-WorkerFile 2 "a/driver.zip" $root $memo
    Assert ($bucket -ne $first) "bucket identities collided"
    $script:failures = 1
    $recovered = Save-WorkerFile 1 "recover.zip" $root $memo
    Assert ((Get-Content -LiteralPath $recovered -Raw) -ne "partial") "partial file reused"
    Assert ($script:requests -eq 5) "retry count incorrect"
    $script:failures = 3
    $failed = $false
    try { Save-WorkerFile 1 "failed.zip" $root $memo | Out-Null } catch { $failed = $true }
    Assert $failed "exhausted retries must fail"
    Assert ($script:requests -eq 8) "retries must be bounded"
    Assert (@(Get-ChildItem -LiteralPath $root -Recurse -Filter *.partial).Count -eq 0) "partial files leaked"
    Save-WorkerFile 1 "failed.zip" $root $memo | Out-Null
    Assert ($script:requests -eq 9) "failure poisoned memo"
    # A new build must fetch again, even if old input files remain on disk.
    $newRoot = Join-Path $root "next-build"
    Save-WorkerFile 1 "a/driver.zip" $newRoot @{} | Out-Null
    Assert ($script:requests -eq 10) "cross-build stale input reused"
    $parallelRoot = Join-Path $root "parallel-build"
    $parallel = Save-WorkerFile 1 "a/driver.zip" $parallelRoot @{}
    Assert ($parallel -ne $first) "build invocation paths collided"
    Assert ((Get-Content -LiteralPath $first -Raw) -match 'a%2Fdriver.zip') "another invocation changed input"
    Write-Output "PASS: deduplication, bucket/path isolation, retry recovery, retry bound, partial cleanup, fresh build, invocation isolation"
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force
}
