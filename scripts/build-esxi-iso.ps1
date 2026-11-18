param(
    [string]$DepotPath = "",
    [string]$DriverPaths = "",
    [string]$OutputPath = "",
    [string]$ESXiVersion = "",
    [string]$WorkDir = "",
    [string]$Mode = "Build",
    [string]$ImageProfileName = "",
    [string]$BundleFirst = "auto",
    [string]$RootPassword = "niuniu",
    [string]$InstallMode = "unattended",
    [string]$BootOptions = ""
)

$ErrorActionPreference = "Stop"

if (-not $env:TMPDIR -and (Test-Path "/tmp")) {
    $env:TMPDIR = "/tmp"
}

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
            Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
            $za = [System.IO.Compression.ZipFile]::OpenRead($DriverPath)
            try {
                $hasIndex = ($za.Entries | Where-Object { $_.FullName -match '(^|/)index\.xml$' } | Measure-Object).Count -gt 0
            } finally {
                $za.Dispose()
            }
            if ($hasIndex) {
                $depot = Add-EsxSoftwareDepot -DepotUrl $DriverPath
                return @(Get-EsxSoftwarePackage -SoftwareDepot $depot)
            }
            $extractDir = Join-Path ([System.IO.Path]::GetTempPath()) ("vibzip-" + [Guid]::NewGuid().ToString("N"))
            [System.IO.Compression.ZipFile]::ExtractToDirectory($DriverPath, $extractDir)
            $pkgs = @()
            Get-ChildItem -Path $extractDir -Recurse -Filter "*.vib" | ForEach-Object {
                $pkgs += @(Get-EsxSoftwarePackage -PackageUrl $_.FullName)
            }
            return $pkgs
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

    $bundleDir = if (Test-Path "/data/builds") { "/data/builds" } else { $WorkDir }
    $bundlePath = Join-Path $bundleDir "$ImageProfile-offline_bundle.zip"
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
    Remove-Item -LiteralPath $bundlePath -Force -ErrorAction SilentlyContinue
}

try {
    if ([string]::IsNullOrWhiteSpace($DepotPath)) {
        throw "DepotPath is required"
    }

    $runtimeTimer = [System.Diagnostics.Stopwatch]::StartNew()
    Initialize-PowerCliRuntime
    if ($Mode -ne "InspectProfiles") {
        Write-Host "[TIMING] powercli_load_ms=$($runtimeTimer.ElapsedMilliseconds)"
    }

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

    $depotTimer = [System.Diagnostics.Stopwatch]::StartNew()
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

    Write-Host "[TIMING] depot_profile_ms=$($depotTimer.ElapsedMilliseconds)"
    $injectionTimer = [System.Diagnostics.Stopwatch]::StartNew()
    $i = 0
    foreach ($d in $drivers) {
        $i++
        $pct = 50 + [int]($i / $drivers.Count * 30)
        Write-Host "[PROGRESS] $pct Loading driver: $(Split-Path $d -Leaf)"
        Add-DriverSoftwarePackages -ImageProfile $custom.Name -DriverPath $d | Out-Null
    }

    Write-Host "[TIMING] driver_injection_ms=$($injectionTimer.ElapsedMilliseconds)"
    $exportTimer = [System.Diagnostics.Stopwatch]::StartNew()
    Write-Host "[PROGRESS] 85 Exporting ISO..."
    Export-CustomImageProfile -ImageProfile $custom.Name -OutputPath $OutputPath -ESXiVersion $ESXiVersion -WorkDir $WorkDir -DriverPaths $drivers -BundleFirst $BundleFirst

    if (-not (Test-Path -LiteralPath $OutputPath)) {
        throw "ISO export did not create output file: $OutputPath"
    }

    $nativeScript = Join-Path $PSScriptRoot "build-native-iso.sh"
    if ((-not [string]::IsNullOrWhiteSpace($BootOptions)) -and (Test-Path "/bin/bash") -and (Test-Path "/usr/bin/xorriso") -and (Test-Path $nativeScript)) {
        $rawIso = Join-Path $WorkDir "powercli-exported-base.iso"
        Move-Item -LiteralPath $OutputPath -Destination $rawIso -Force
        & /bin/bash $nativeScript --depot-path $rawIso --output-path $OutputPath --esxi-version $ESXiVersion --work-dir $WorkDir --root-password $RootPassword --install-mode $InstallMode --boot-options $BootOptions
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $OutputPath)) {
            throw "Failed to apply boot options onto exported ISO"
        }
        Remove-Item -LiteralPath $rawIso -Force -ErrorAction SilentlyContinue
    }

    Write-Host "[TIMING] iso_export_ms=$($exportTimer.ElapsedMilliseconds)"
    Write-Host "[PROGRESS] 100 Done"
    Write-Host "[SUCCESS] ISO created: $OutputPath"
} catch {
    Write-Host "[ERROR] $($_.Exception.Message)"
    exit 1
} finally {
    Get-ChildItem -Path ([System.IO.Path]::GetTempPath()) -Filter "tmp*" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Get-ChildItem -Path ([System.IO.Path]::GetTempPath()) -Filter "vibzip-*" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}
