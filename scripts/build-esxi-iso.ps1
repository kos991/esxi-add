param(
    [Parameter(Mandatory=$true)] [string]$DepotPath,
    [Parameter(Mandatory=$true)] [string]$DriverPaths,
    [Parameter(Mandatory=$true)] [string]$OutputPath,
    [Parameter(Mandatory=$true)] [string]$ESXiVersion,
    [Parameter(Mandatory=$true)] [string]$WorkDir
)
$ErrorActionPreference = "Stop"
try {
    Write-Host "[PROGRESS] 0 Starting build..."
    New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
    Write-Host "[PROGRESS] 10 Extracting depot..."
    Add-EsxSoftwareDepot -DepotUrl $DepotPath
    Write-Host "[PROGRESS] 40 Getting image profile..."
    $profile = Get-EsxImageProfile | Select-Object -First 1
    Write-Host "[PROGRESS] 50 Cloning profile: $($profile.Name)"
    $custom = New-EsxImageProfile -CloneProfile $profile.Name -Name "Custom-$ESXiVersion-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    $drivers = $DriverPaths -split ","
    $i = 0
    foreach ($d in $drivers) {
        $i++; $pct = 50 + [int]($i / $drivers.Count * 30)
        Write-Host "[PROGRESS] $pct Injecting: $(Split-Path $d -Leaf)"
        Add-EsxSoftwarePackage -ImageProfile $custom.Name -SoftwarePackage $d -Force
    }
    Write-Host "[PROGRESS] 85 Exporting ISO..."
    Export-EsxImageProfile -ImageProfile $custom.Name -ExportToIso -FilePath $OutputPath -Force
    Write-Host "[PROGRESS] 98 Cleaning up..."
    Remove-Item -Path $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "[PROGRESS] 100 Done"
    Write-Host "[SUCCESS] ISO created: $OutputPath"
} catch {
    Write-Host "[ERROR] $($_.Exception.Message)"
    exit 1
}
