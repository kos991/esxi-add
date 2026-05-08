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
        $pythonPath = @("/usr/local/bin/python3", "/usr/bin/python3") | Where-Object { Test-Path $_ } | Select-Object -First 1
        if ($pythonPath) {
            Set-PowerCLIConfiguration -Scope User -PythonPath $pythonPath -Confirm:$false | Out-Null
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

function Export-CustomImageProfile {
    param(
        [Parameter(Mandatory=$true)] [string]$ImageProfile,
        [Parameter(Mandatory=$true)] [string]$OutputPath,
        [Parameter(Mandatory=$true)] [string]$ESXiVersion,
        [Parameter(Mandatory=$true)] [string]$WorkDir
    )

    $useBundleFirstExport = $ESXiVersion -match '^6\.7'
    if (-not $useBundleFirstExport) {
        Export-EsxImageProfile -ImageProfile $ImageProfile -ExportToIso -FilePath $OutputPath -Force -NoSignatureCheck
        return
    }

    $bundlePath = Join-Path $WorkDir "$ImageProfile-offline_bundle.zip"
    Write-Host "[PROGRESS] 85 Exporting offline bundle for ESXi 6.7..."
    Export-EsxImageProfile -ImageProfile $ImageProfile -ExportToBundle -FilePath $bundlePath -Force -NoSignatureCheck

    Write-Host "[PROGRESS] 90 Reloading offline bundle for ISO export..."
    Remove-EsxImageProfile -ImageProfile $ImageProfile -Confirm:$false | Out-Null
    Add-EsxSoftwareDepot -DepotUrl $bundlePath | Out-Null
    $bundleProfiles = @(Get-EsxImageProfile -Name $ImageProfile)
    $bundleProfile = $bundleProfiles | Select-Object -First 1
    if ($null -eq $bundleProfile) {
        throw "no ESXi image profile found in generated offline bundle: $bundlePath"
    }

    Export-EsxImageProfile -ImageProfile $bundleProfile.Name -ExportToIso -FilePath $OutputPath -Force -NoSignatureCheck
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
    Export-CustomImageProfile -ImageProfile $custom.Name -OutputPath $OutputPath -ESXiVersion $ESXiVersion -WorkDir $WorkDir

    if (-not (Test-Path -LiteralPath $OutputPath)) {
        throw "ISO export did not create output file: $OutputPath"
    }

    Write-Host "[PROGRESS] 100 Done"
    Write-Host "[SUCCESS] ISO created: $OutputPath"
} catch {
    Write-Host "[ERROR] $($_.Exception.Message)"
    exit 1
}
