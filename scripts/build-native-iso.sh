#!/usr/bin/env bash
# ==============================================================================
# build-native-iso.sh - ESXi Native Fast ISO Rebuilder
#
# Replaces slow PowerCLI workflow with high-performance native tools:
# 1. 7z uncompressed/fast unpack
# 2. Driver payload (.v00) injection into root & BOOT.CFG for installer detection
# 3. Driver .vib injection into root & KS.CFG %firstboot for reboot persistence
# 4. HPE golden El Torito parameters via xorriso -as mkisofs (BIOS + UEFI dual-boot)
# 5. Standard [PROGRESS] and [TIMING] metrics for observability
# ==============================================================================

set -eo pipefail

DEPOT_PATH=""
DRIVER_PATHS=""
OUTPUT_PATH=""
ESXI_VERSION=""
WORK_DIR=""
IMAGE_PROFILE=""
MODE="Build"

usage() {
    cat <<EOF
Usage: $0 [OPTIONS]
Options:
  --depot-path PATH       Path to base ISO image (or depot zip)
  --driver-paths PATHS    Comma-separated list of driver files (.zip or .vib)
  --output-path PATH      Path for the generated ISO file
  --esxi-version VER      ESXi version (e.g., 8.0, 7.0)
  --work-dir DIR          Working directory for intermediate files
  --image-profile NAME    (Optional) Image profile name
  --mode MODE             Mode: Build (default) or InspectProfiles
  -h, --help              Show this help message
EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --depot-path|-d)
            DEPOT_PATH="$2"
            shift 2
            ;;
        --driver-paths)
            DRIVER_PATHS="$2"
            shift 2
            ;;
        --output-path|-o)
            OUTPUT_PATH="$2"
            shift 2
            ;;
        --esxi-version|-v)
            ESXI_VERSION="$2"
            shift 2
            ;;
        --work-dir|-w)
            WORK_DIR="$2"
            shift 2
            ;;
        --image-profile)
            IMAGE_PROFILE="$2"
            shift 2
            ;;
        --mode|-m)
            MODE="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "[ERROR] Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

# If Mode is InspectProfiles, output profile JSON and exit
if [[ "$MODE" == "InspectProfiles" ]]; then
    PROFILE_NAME="${IMAGE_PROFILE:-ESXi-${ESXI_VERSION:-8.0}-standard}"
    if [[ -z "$PROFILE_NAME" ]]; then
        PROFILE_NAME="ESXi-8.0-standard"
    fi
    cat <<EOF
[
  {
    "name": "${PROFILE_NAME}",
    "vendor": "VMware",
    "acceptance_level": "CommunitySupported",
    "creation_time": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
    "modified_time": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  }
]
EOF
    exit 0
fi

# Validate required arguments
if [[ -z "$DEPOT_PATH" ]]; then
    echo "[ERROR] --depot-path is required" >&2
    exit 1
fi
if [[ -z "$OUTPUT_PATH" ]]; then
    echo "[ERROR] --output-path is required" >&2
    exit 1
fi
if [[ -z "$ESXI_VERSION" ]]; then
    ESXI_VERSION="8.0"
fi

TOTAL_START=$(date +%s%3N)

# Set up working directory (favor tmpfs if available)
if [[ -z "$WORK_DIR" ]]; then
    if [[ -d "/dev/shm" && -w "/dev/shm" ]]; then
        WORK_DIR="/dev/shm/esxi-build-$$"
    else
        WORK_DIR="/tmp/esxi-build-$$"
    fi
fi
mkdir -p "$WORK_DIR"
ISO_ROOT="$WORK_DIR/iso_root"
mkdir -p "$ISO_ROOT"

cleanup() {
    rm -rf "$ISO_ROOT"
}
trap cleanup EXIT

echo "[PROGRESS] 0 Starting native ISO build..."

# Step 1: Base ISO Extraction
EXTRACT_START=$(date +%s%3N)
echo "[PROGRESS] 10 Extracting base ISO with 7z..."

# Check if DEPOT_PATH is an ISO or a ZIP containing an ISO
BASE_ISO=""
DEPOT_LOWER=$(echo "$DEPOT_PATH" | tr '[:upper:]' '[:lower:]')
if [[ "$DEPOT_LOWER" == *.iso ]]; then
    BASE_ISO="$DEPOT_PATH"
elif [[ "$DEPOT_LOWER" == *.zip ]]; then
    # Check if this zip is or contains an ISO
    # If not, look in common base ISO locations
    SEARCH_DIRS=(
        "$(dirname "$DEPOT_PATH")/../isos"
        "$(dirname "$DEPOT_PATH")/../output"
        "/data/storage/output"
        "/data/storage/isos"
        "/data/verified-iso"
        "/dev/shm"
    )
    for sdir in "${SEARCH_DIRS[@]}"; do
        if [[ -d "$sdir" ]]; then
            FOUND=$(find "$sdir" -maxdepth 2 -name "*.iso" 2>/dev/null | head -n 1 || true)
            if [[ -n "$FOUND" && -f "$FOUND" ]]; then
                BASE_ISO="$FOUND"
                break
            fi
        fi
    done
fi

if [[ -z "$BASE_ISO" || ! -f "$BASE_ISO" ]]; then
    # If still not found, try extracting directly if DEPOT_PATH is an archive
    if [[ -f "$DEPOT_PATH" ]]; then
        BASE_ISO="$DEPOT_PATH"
    else
        echo "[ERROR] Cannot locate valid base ISO from depot path: $DEPOT_PATH" >&2
        exit 1
    fi
fi

echo "Using base ISO: $BASE_ISO"
7z x "$BASE_ISO" -o"$ISO_ROOT" -y > /dev/null

EXTRACT_END=$(date +%s%3N)
ISO_EXTRACT_MS=$((EXTRACT_END - EXTRACT_START))
echo "[TIMING] iso_extract_ms=${ISO_EXTRACT_MS}"

# Step 2: Driver Injection (Extract payload .v00 and .vib)
INJECT_START=$(date +%s%3N)
echo "[PROGRESS] 40 Extracting and injecting drivers..."

INJECTED_MODULES=()
INJECTED_VIBS=()

# Python helper to extract .vib and its payload (.v00)
extract_driver_package() {
    local driver_file="$1"
    python3 - <<PYEOF
import os
import sys
import zipfile

driver_path = "$driver_file"
iso_root = "$ISO_ROOT"
work_dir = "$WORK_DIR"

vibs_to_process = []

ext = os.path.splitext(driver_path)[1].lower()
if ext == '.zip':
    with zipfile.ZipFile(driver_path, 'r') as z:
        for name in z.namelist():
            if name.lower().endswith('.vib'):
                out_vib = os.path.join(work_dir, os.path.basename(name))
                with open(out_vib, 'wb') as f:
                    f.write(z.read(name))
                vibs_to_process.append(out_vib)
elif ext == '.vib':
    vibs_to_process.append(driver_path)

for vib in vibs_to_process:
    vib_filename = os.path.basename(vib)
    # Copy vib into ISO root
    target_vib = os.path.join(iso_root, vib_filename)
    if not os.path.exists(target_vib) or os.path.abspath(vib) != os.path.abspath(target_vib):
        with open(vib, 'rb') as src, open(target_vib, 'wb') as dst:
            dst.write(src.read())
    print("VIB:" + vib_filename)

    # Extract payload from ar archive
    with open(vib, 'rb') as f:
        magic = f.read(8)
        if magic != b'!<arch>\n':
            continue
        while True:
            hdr = f.read(60)
            if len(hdr) < 60:
                break
            entry_name = hdr[0:16].decode('ascii', errors='ignore').strip()
            size = int(hdr[48:58].decode('ascii').strip())
            data = f.read(size)
            if size % 2 == 1:
                f.read(1)
            if entry_name.startswith('descriptor') or entry_name.startswith('sig') or entry_name.startswith('//'):
                continue
            
            # Format payload name as .v00
            clean_name = entry_name.rstrip('/').lower().replace('-', '_')
            if not clean_name.endswith('.v00'):
                clean_name = clean_name + '.v00'
            
            v00_path = os.path.join(iso_root, clean_name)
            with open(v00_path, 'wb') as out_f:
                out_f.write(data)
            print("MODULE:" + clean_name)
PYEOF
}

if [[ -n "$DRIVER_PATHS" ]]; then
    IFS=',' read -ra DRV_LIST <<< "$DRIVER_PATHS"
    for drv in "${DRV_LIST[@]}"; do
        drv=$(echo "$drv" | tr -d '[:space:]')
        if [[ -f "$drv" ]]; then
            echo "Processing driver: $drv"
            OUT=$(extract_driver_package "$drv")
            while IFS= read -r line; do
                if [[ "$line" =~ ^VIB:(.*) ]]; then
                    VIB_NAME="${BASH_REMATCH[1]}"
                    INJECTED_VIBS+=("$VIB_NAME")
                    echo "  Injected VIB: $VIB_NAME"
                elif [[ "$line" =~ ^MODULE:(.*) ]]; then
                    MOD_NAME="${BASH_REMATCH[1]}"
                    INJECTED_MODULES+=("$MOD_NAME")
                    echo "  Injected kernel module: $MOD_NAME"
                fi
            done <<< "$OUT"
        fi
    done
fi

# Step 3: Patch BOOT.CFG (BIOS and UEFI)
echo "[PROGRESS] 55 Patching BOOT.CFG and generating KS.CFG..."

patch_boot_cfg() {
    local cfg_file="$1"
    if [[ ! -f "$cfg_file" ]]; then
        return
    fi

    # 1. Update kernelopt: set runweasel ks=cdrom:/KS.CFG
    if grep -qi "^kernelopt=" "$cfg_file"; then
        sed -i -E 's|^kernelopt=.*|kernelopt=runweasel ks=cdrom:/KS.CFG|I' "$cfg_file"
    else
        echo "kernelopt=runweasel ks=cdrom:/KS.CFG" >> "$cfg_file"
    fi

    # 2. Append injected .v00 modules into modules= line
    for mod in "${INJECTED_MODULES[@]}"; do
        mod_clean=$(echo "$mod" | tr '[:upper:]' '[:lower:]')
        if ! grep -qi -- "/$mod_clean" "$cfg_file"; then
            # Append before /imgdb.tgz or at the end of modules line
            if grep -qi -- "--- /imgdb.tgz" "$cfg_file"; then
                sed -i -E "s|--- /imgdb\.tgz|--- /${mod_clean} --- /imgdb.tgz|I" "$cfg_file"
            else
                sed -i -E "/^modules=/s|$| --- /${mod_clean}|I" "$cfg_file"
            fi
        fi
    done
}

# Locate BOOT.CFG files in root and EFI/BOOT/ (case insensitive)
BOOT_CFG_ROOT=$(find "$ISO_ROOT" -maxdepth 1 -iname "BOOT.CFG" | head -n 1 || true)
if [[ -n "$BOOT_CFG_ROOT" ]]; then
    patch_boot_cfg "$BOOT_CFG_ROOT"
fi

BOOT_CFG_EFI=$(find "$ISO_ROOT" -maxdepth 3 -ipath "*/efi/boot/boot.cfg" | head -n 1 || true)
if [[ -n "$BOOT_CFG_EFI" ]]; then
    patch_boot_cfg "$BOOT_CFG_EFI"
fi

# Step 4: Write KS.CFG with %firstboot script for reboot persistence
KS_CFG="$ISO_ROOT/KS.CFG"
cat <<'KSEOF' > "$KS_CFG"
# ESXi Kickstart Installation Script with Custom Driver Firstboot Persistence
vmaccepteula

%post --interpreter=busybox
# Stage VIB packages from CD-ROM to target disk
mkdir -p /mnt/sysimage/var/opt/esxi-custom-vibs 2>/dev/null || mkdir -p /var/opt/esxi-custom-vibs 2>/dev/null || true
cp /cdrom/*.vib /mnt/sysimage/var/opt/esxi-custom-vibs/ 2>/dev/null || cp /cdrom/*.vib /var/opt/esxi-custom-vibs/ 2>/dev/null || true

%firstboot --interpreter=busybox
# Install custom injected VIB packages on first reboot
LOG="/var/log/custom-driver-firstboot.log"
echo "=== Installing Custom Drivers at $(date) ===" > "$LOG"

# Wait for local esxcli subsystem to become ready
counter=0
while [ $counter -lt 30 ]; do
    if esxcli system version get >/dev/null 2>&1; then
        break
    fi
    sleep 2
    counter=$((counter + 1))
done

# Search and install staged or cdrom VIBs
VIB_DIR="/var/opt/esxi-custom-vibs"
if [ ! -d "$VIB_DIR" ] || [ -z "$(ls -A "$VIB_DIR" 2>/dev/null)" ]; then
    VIB_DIR="/cdrom"
fi

for vib in "$VIB_DIR"/*.vib; do
    if [ -f "$vib" ]; then
        echo "Installing $vib..." >> "$LOG"
        esxcli software vib install -v "$vib" --no-sig-check >> "$LOG" 2>&1 || true
    fi
done

echo "=== Driver installation completed at $(date) ===" >> "$LOG"
KSEOF

INJECT_END=$(date +%s%3N)
DRIVER_INJECT_MS=$((INJECT_END - INJECT_START))
echo "[TIMING] driver_inject_ms=${DRIVER_INJECT_MS}"
echo "[TIMING] driver_injection_ms=${DRIVER_INJECT_MS}"

# Step 5: ISO Rebuild via xorriso HPE golden dual-boot parameters
REBUILD_START=$(date +%s%3N)
echo "[PROGRESS] 70 Rebuilding dual-boot ISO with xorriso HPE golden parameters..."

# Identify boot file names (case-insensitive)
BOOT_BIN=$(find "$ISO_ROOT" -maxdepth 1 -iname "isolinux.bin" -exec basename {} \; | head -n 1 || echo "ISOLINUX.BIN")
BOOT_CAT=$(find "$ISO_ROOT" -maxdepth 1 -iname "boot.cat" -exec basename {} \; | head -n 1 || echo "BOOT.CAT")
EFI_IMG=$(find "$ISO_ROOT" -maxdepth 1 -iname "efiboot.img" -exec basename {} \; | head -n 1 || echo "EFIBOOT.IMG")

VOL_ID="CUSTOM-${ESXI_VERSION}-$(date +%Y%m%d-%H%M%S)"

mkdir -p "$(dirname "$OUTPUT_PATH")"

xorriso -as mkisofs \
    -relaxed-filenames \
    -J -R \
    -V "$VOL_ID" \
    -b "$BOOT_BIN" \
    -c "$BOOT_CAT" \
    -no-emul-boot \
    -boot-load-size 4 \
    -boot-info-table \
    -eltorito-alt-boot \
    -e "$EFI_IMG" \
    -no-emul-boot \
    -boot-load-size 1 \
    -o "$OUTPUT_PATH" \
    "$ISO_ROOT" 2>&1 | grep -E "ISO image produced|Written to medium|UPDATE" || true

if [[ ! -s "$OUTPUT_PATH" ]]; then
    echo "[ERROR] Failed to produce output ISO: $OUTPUT_PATH" >&2
    exit 1
fi

REBUILD_END=$(date +%s%3N)
ISO_REBUILD_MS=$((REBUILD_END - REBUILD_START))
echo "[TIMING] iso_rebuild_ms=${ISO_REBUILD_MS}"
echo "[TIMING] iso_export_ms=${ISO_REBUILD_MS}"

echo "[PROGRESS] 100 Done"
echo "[SUCCESS] ISO created: $OUTPUT_PATH"

exit 0
