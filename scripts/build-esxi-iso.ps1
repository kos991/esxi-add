param(
    [string]$DepotPath = "",
    [string]$DriverPaths = "",
    [string]$OutputPath = "",
    [string]$ESXiVersion = "",
    [string]$WorkDir = "",
    [string]$Mode = "Build",
    [string]$ImageProfileName = "",
    [string]$BundleFirst = "auto"
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

function Get-DepotImageProfiles {
    param(
        [Parameter(Mandatory=$true)] [string]$DepotPath
    )

    Add-EsxSoftwareDepot -DepotUrl $DepotPath | Out-Null
    return @(Get-EsxImageProfile | Sort-Object Name -Descending | ForEach-Object {
        [PSCustomObject]@{
            name = $_.Name
            vendor = $_.Vendor
            acceptance_level = [string]$_.AcceptanceLevel
            creation_time = $_.CreationTime
            modified_time = $_.ModifiedTime
        }
    })
}

function Test-ShouldUseBundleFirstExport {
    param(
        [Parameter(Mandatory=$true)] [string]$ESXiVersion,
        [string[]]$DriverPaths = @(),
        [string]$BundleFirst = "auto"
    )

    switch ($BundleFirst.ToLowerInvariant()) {
        "always" { return $true }
        "never" { return $false }
    }

    $useBundleFirstExport = $ESXiVersion -match '^6\.7'
    if ($useBundleFirstExport) {
        return $true
    }

    if ($ESXiVersion -match '^7\.') {
        foreach ($driver in $DriverPaths) {
            $name = [System.IO.Path]::GetFileName($driver).ToLowerInvariant()
            if ($name -like '*vmkusb*' -or $name -like '*fling*') {
                return $true
            }
        }
    }

    return $false
}

function Export-CustomImageProfile {
    param(
        [Parameter(Mandatory=$true)] [string]$ImageProfile,
        [Parameter(Mandatory=$true)] [string]$OutputPath,
        [Parameter(Mandatory=$true)] [string]$ESXiVersion,
        [Parameter(Mandatory=$true)] [string]$WorkDir,
        [string[]]$DriverPaths = @(),
        [string]$BundleFirst = "auto"
    )

    $useBundleFirstExport = Test-ShouldUseBundleFirstExport -ESXiVersion $ESXiVersion -DriverPaths $DriverPaths -BundleFirst $BundleFirst
    Write-Host "Export strategy: $(if ($useBundleFirstExport) { 'bundle-first' } else { 'direct' })"
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
    if ([string]::IsNullOrWhiteSpace($DepotPath)) {
        throw "DepotPath is required"
    }

    Initialize-PowerCliRuntime

    if ($Mode -eq "InspectProfiles") {
        $profiles = @(Get-DepotImageProfiles -DepotPath $DepotPath)
        $profiles | ConvertTo-Json -Compress
        exit 0
    }

    Write-Host "[PROGRESS] 0 Starting build..."

    if ([string]::IsNullOrWhiteSpace($OutputPath)) {
        throw "OutputPath is required"
    }
    if ([string]::IsNullOrWhiteSpace($ESXiVersion)) {
        throw "ESXiVersion is required"
    }
    if ([string]::IsNullOrWhiteSpace($WorkDir)) {
        throw "WorkDir is required"
    }

    New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

    Write-Host "[PROGRESS] 10 Loading ESXi depot..."
    Add-EsxSoftwareDepot -DepotUrl $DepotPath | Out-Null

    Write-Host "[PROGRESS] 40 Getting image profile..."
    if (-not [string]::IsNullOrWhiteSpace($ImageProfileName)) {
        $profiles = @(Get-EsxImageProfile -Name $ImageProfileName)
    } else {
        $profiles = @(Get-EsxImageProfile | Where-Object { $_.Name -like "*standard*" } | Sort-Object Name -Descending)
        if ($profiles.Count -eq 0) {
            $profiles = @(Get-EsxImageProfile | Sort-Object Name -Descending)
        }
    }
    $profile = $profiles | Select-Object -First 1
    if ($null -eq $profile) {
        throw "no ESXi image profiles found in depot: $DepotPath"
    }

    Write-Host "[PROGRESS] 50 Cloning profile: $($profile.Name)"
    Write-Host "Using image profile: $($profile.Name)"
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
    Export-CustomImageProfile -ImageProfile $custom.Name -OutputPath $OutputPath -ESXiVersion $ESXiVersion -WorkDir $WorkDir -DriverPaths $drivers -BundleFirst $BundleFirst

    if (-not (Test-Path -LiteralPath $OutputPath)) {
        throw "ISO export did not create output file: $OutputPath"
    }

    Write-Host "[PROGRESS] 100 Done"
    Write-Host "[SUCCESS] ISO created: $OutputPath"
} catch {
    Write-Host "[ERROR] $($_.Exception.Message)"
    exit 1
}
