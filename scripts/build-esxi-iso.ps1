param(
    [Parameter(Mandatory=$true)] [string]$DepotPath,
    [Parameter(Mandatory=$true)] [string]$DriverPaths,
    [Parameter(Mandatory=$true)] [string]$OutputPath,
    [Parameter(Mandatory=$true)] [string]$ESXiVersion,
    [Parameter(Mandatory=$true)] [string]$WorkDir
)

$ErrorActionPreference = "Stop"

function Initialize-PowerCliRuntime {
    Import-Module VMware.ImageBuilder -ErrorAction SilentlyContinue

    if (Get-Command Set-PowerCLIConfiguration -ErrorAction SilentlyContinue) {
        Set-PowerCLIConfiguration -Scope User -ParticipateInCEIP:$false -Confirm:$false | Out-Null
        if (Test-Path "/usr/bin/python3") {
            Set-PowerCLIConfiguration -Scope User -PythonPath "/usr/bin/python3" -Confirm:$false | Out-Null
        }
    }
}

function Get-DriverSoftwarePackages {
    param(
        [Parameter(Mandatory=$true)] [string]$DriverPath
    )

    $extension = [System.IO.Path]::GetExtension($DriverPath).ToLowerInvariant()
    switch ($extension) {
        ".zip" {
            $depot = Add-EsxSoftwareDepot -DepotUrl $DriverPath
            return @(Get-EsxSoftwarePackage -SoftwareDepot $depot)
        }
        ".vib" {
            return @(Get-EsxSoftwarePackage -PackageUrl $DriverPath)
        }
        default {
            throw "unsupported driver package type: $DriverPath"
        }
    }
}

function Add-DriverSoftwarePackages {
    param(
        [Parameter(Mandatory=$true)] [string]$ImageProfile,
        [Parameter(Mandatory=$true)] [string]$DriverPath
    )

    $packages = @(Get-DriverSoftwarePackages -DriverPath $DriverPath)
    if ($packages.Count -eq 0) {
        throw "no software packages found in driver file: $DriverPath"
    }

    foreach ($package in $packages) {
        Write-Host "Adding package: $($package.Name)"
        Add-EsxSoftwarePackage -ImageProfile $ImageProfile -SoftwarePackage $package -Force
    }
}

try {
    Write-Host "[PROGRESS] 0 Starting build..."
    Initialize-PowerCliRuntime

    New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

    Write-Host "[PROGRESS] 10 Loading ESXi depot..."
    Add-EsxSoftwareDepot -DepotUrl $DepotPath | Out-Null

    Write-Host "[PROGRESS] 40 Getting image profile..."
    $profiles = @(Get-EsxImageProfile | Where-Object { $_.Name -like "*standard*" } | Sort-Object Name -Descending)
    if ($profiles.Count -eq 0) {
        $profiles = @(Get-EsxImageProfile | Sort-Object Name -Descending)
    }
    $profile = $profiles | Select-Object -First 1
    if ($null -eq $profile) {
        throw "no ESXi image profiles found in depot: $DepotPath"
    }

    Write-Host "[PROGRESS] 50 Cloning profile: $($profile.Name)"
    $customName = "Custom-$ESXiVersion-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    $custom = New-EsxImageProfile -CloneProfile $profile.Name -Name $customName -Vendor "ESXi Builder"
    $custom = Set-EsxImageProfile -ImageProfile $custom.Name -AcceptanceLevel CommunitySupported

    $drivers = @()
    if (-not [string]::IsNullOrWhiteSpace($DriverPaths)) {
        $drivers = @($DriverPaths -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
    }

    $i = 0
    foreach ($d in $drivers) {
        $i++
        $pct = 50 + [int]($i / $drivers.Count * 30)
        Write-Host "[PROGRESS] $pct Loading driver: $(Split-Path $d -Leaf)"
        Add-DriverSoftwarePackages -ImageProfile $custom.Name -DriverPath $d | Out-Null
    }

    Write-Host "[PROGRESS] 85 Exporting ISO..."
    Export-EsxImageProfile -ImageProfile $custom.Name -ExportToIso -FilePath $OutputPath -Force -NoSignatureCheck

    Write-Host "[PROGRESS] 98 Cleaning up..."
    Remove-Item -Path $WorkDir -Recurse -Force -ErrorAction SilentlyContinue

    Write-Host "[PROGRESS] 100 Done"
    Write-Host "[SUCCESS] ISO created: $OutputPath"
} catch {
    Write-Host "[ERROR] $($_.Exception.Message)"
    exit 1
}
