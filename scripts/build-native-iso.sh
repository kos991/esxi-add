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
ROOT_PASSWORD="niuniu"
INSTALL_MODE="unattended"
BOOT_OPTIONS=""

usage() {
    cat <<EOF
Usage: $0 [OPTIONS]
Options:
  --depot-path PATH       Path to base ISO image (Depot ZIP requires PowerCLI)
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
        --root-password)
            ROOT_PASSWORD="$2"
            shift 2
            ;;
        --install-mode)
            INSTALL_MODE="$2"
            shift 2
            ;;
        --boot-options)
            BOOT_OPTIONS="$2"
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

if [[ "$MODE" == "InspectProfiles" ]]; then
    echo "[ERROR] Native ISO engine cannot inspect Depot ImageProfiles; use PowerCLI" >&2
    exit 1
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

# Native builds must use exactly the supplied ISO, never a previous output.
BASE_ISO="$DEPOT_PATH"
if [[ "${BASE_ISO,,}" != *.iso || ! -f "$BASE_ISO" ]]; then
    echo "[ERROR] Native engine only accepts an existing ISO file; Depot ZIP must use PowerCLI: $DEPOT_PATH" >&2
    exit 1
fi
if [[ "$(dd if="$BASE_ISO" bs=1 skip=32769 count=5 2>/dev/null)" != "CD001" ]]; then
    echo "[ERROR] Input is not a valid ISO9660 image: $BASE_ISO" >&2
    exit 1
fi
echo "Using base ISO: $BASE_ISO"
if [[ -e "$OUTPUT_PATH" ]]; then
    echo "[ERROR] Output already exists; refusing to overwrite or reuse an old artifact: $OUTPUT_PATH" >&2
    exit 1
fi
7z x "$BASE_ISO" -o"$ISO_ROOT" -y
BOOT_SOURCE=$(find "$ISO_ROOT" -maxdepth 1 -iname 'boot.cfg' -print -quit)
if [[ -z "$BOOT_SOURCE" ]]; then
    echo "[ERROR] Input ISO is missing ESXi BOOT.CFG" >&2
    exit 1
fi
ACTUAL_VERSION=$(sed -nE 's/^build=([0-9]+\.[0-9]+).*/\1/ip' "$BOOT_SOURCE" | head -n 1)
if [[ -z "$ACTUAL_VERSION" || "$ACTUAL_VERSION" != "$ESXI_VERSION" ]]; then
    echo "[ERROR] ISO version mismatch: requested=$ESXI_VERSION actual=$ACTUAL_VERSION source=$BASE_ISO" >&2
    exit 1
fi

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
            
            existing_match = None
            for existing_f in os.listdir(iso_root):
                if existing_f.lower() == clean_name.lower():
                    existing_match = existing_f
                    break
            final_mod_name = existing_match if existing_match else clean_name
            v00_path = os.path.join(iso_root, final_mod_name)
            with open(v00_path, 'wb') as out_f:
                out_f.write(data)
            print("MODULE:" + final_mod_name)
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

EXTRA_KOPTS=""
PERSIST_KOPTS=""
TWEAK_HYBRID=0
TWEAK_HEADLESS=0

if [[ -n "$BOOT_OPTIONS" ]]; then
    IFS=',' read -ra OPT_LIST <<< "$BOOT_OPTIONS"
    for opt in "${OPT_LIST[@]}"; do
        opt=$(echo "$opt" | tr -d '[:space:]')
        case "$opt" in
            hybrid_cpu)
                EXTRA_KOPTS="${EXTRA_KOPTS} cpuUniformityHardCheckPanic=FALSE"
                PERSIST_KOPTS="${PERSIST_KOPTS} cpuUniformityHardCheckPanic=FALSE"
                TWEAK_HYBRID=1
                echo "Enabled boot tweak: cpuUniformityHardCheckPanic=FALSE (Intel hybrid P/E-core)"
                ;;
            legacy_cpu)
                EXTRA_KOPTS="${EXTRA_KOPTS} allowLegacyCPU=true"
                PERSIST_KOPTS="${PERSIST_KOPTS} allowLegacyCPU=true"
                echo "Enabled boot tweak: allowLegacyCPU=true (unsupported legacy CPU)"
                ;;
            osdata_8g)
                EXTRA_KOPTS="${EXTRA_KOPTS} autoPartitionOSDataSize=8192"
                echo "Enabled boot tweak: autoPartitionOSDataSize=8192 (8GB ESX-OSData volume)"
                ;;
            headless)
                EXTRA_KOPTS="${EXTRA_KOPTS} ignoreHeadless=TRUE"
                PERSIST_KOPTS="${PERSIST_KOPTS} ignoreHeadless=TRUE"
                TWEAK_HEADLESS=1
                echo "Enabled boot tweak: ignoreHeadless=TRUE (headless boot)"
                ;;
        esac
    done
fi

patch_boot_cfg() {
    local cfg_file="$1"
    if [[ ! -f "$cfg_file" ]]; then
        return
    fi

    local kernelopt_val="runweasel cdromBoot${EXTRA_KOPTS}"
    if [[ "$INSTALL_MODE" != "interactive" ]]; then
        kernelopt_val="runweasel ks=cdrom:/KS.CFG cdromBoot${EXTRA_KOPTS}"
    fi
    if grep -qi "^kernelopt=" "$cfg_file"; then
        sed -i -E "s|^kernelopt=.*|kernelopt=${kernelopt_val}|I" "$cfg_file"
    else
        echo "kernelopt=${kernelopt_val}" >> "$cfg_file"
    fi

    for mod in "${INJECTED_MODULES[@]}"; do
        mod_clean=$(echo "$mod" | tr '[:upper:]' '[:lower:]')
        if ! grep -qi -- "/$mod_clean" "$cfg_file"; then
            if grep -qi -- "--- /imgdb.tgz" "$cfg_file"; then
                sed -i -E "s|--- /imgdb\.tgz|--- /${mod_clean} --- /imgdb.tgz|I" "$cfg_file"
            else
                sed -i -E "/^modules=/s|$| --- /${mod_clean}|I" "$cfg_file"
            fi
        fi
    done
}

BOOT_CFG_ROOT=$(find "$ISO_ROOT" -maxdepth 1 -iname "BOOT.CFG" | head -n 1 || true)
if [[ -n "$BOOT_CFG_ROOT" ]]; then
    patch_boot_cfg "$BOOT_CFG_ROOT"
fi

BOOT_CFG_EFI=$(find "$ISO_ROOT" -maxdepth 3 -ipath "*/efi/boot/boot.cfg" | head -n 1 || true)
if [[ -n "$BOOT_CFG_EFI" ]]; then
    patch_boot_cfg "$BOOT_CFG_EFI"
fi

# Step 4: Write KS.CFG with %post bootbank persistence and %firstboot VIB install
KS_CFG="$ISO_ROOT/KS.CFG"
cat <<KSEOF > "$KS_CFG"
# ESXi Kickstart Installation Script with Custom Driver & Kernel Persistence
vmaccepteula
rootpw ${ROOT_PASSWORD}
clearpart --firstdisk=local --overwritevmfs
install --firstdisk=local --overwritevmfs
reboot

%post --interpreter=busybox
mkdir -p /mnt/sysimage/var/opt/esxi-custom-vibs 2>/dev/null || mkdir -p /var/opt/esxi-custom-vibs 2>/dev/null || true
cp /cdrom/*.vib /mnt/sysimage/var/opt/esxi-custom-vibs/ 2>/dev/null || cp /cdrom/*.vib /var/opt/esxi-custom-vibs/ 2>/dev/null || true
if [ -n "${PERSIST_KOPTS}" ]; then
    for bcfg in /mnt/sysimage/bootbank/boot.cfg /mnt/sysimage/altbootbank/boot.cfg /bootbank/boot.cfg; do
        if [ -f "$bcfg" ]; then
            sed -i "s|^kernelopt=.*|&${PERSIST_KOPTS}|" "$bcfg" 2>/dev/null || true
        fi
    done
fi

%firstboot --interpreter=busybox
LOG="/var/log/custom-driver-firstboot.log"
echo "=== Installing Custom Drivers & Kernel Settings at $(date) ===" > "$LOG"

counter=0
while [ $counter -lt 30 ]; do
    if esxcli system version get >/dev/null 2>&1; then
        break
    fi
    sleep 2
    counter=$((counter + 1))
done

if [ "${TWEAK_HYBRID}" = "1" ]; then
    esxcli system settings kernel set -s cpuUniformityHardCheckPanic -v FALSE >> "$LOG" 2>&1 || true
fi
if [ "${TWEAK_HEADLESS}" = "1" ]; then
    esxcli system settings kernel set -s ignoreHeadless -v TRUE >> "$LOG" 2>&1 || true
fi

VIB_DIR="/var/opt/esxi-custom-vibs"
if [ ! -d "$VIB_DIR" ] || [ -z "$(ls -A "$VIB_DIR" 2>/dev/null)" ]; then
    VIB_DIR="/cdrom"
fi

for vib in "$VIB_DIR"/*.vib; do
    if [ -f "$vib" ]; then
        echo "Installing $vib..." >> "$LOG"
        esxcli software vib install -v "$vib" --no-sig-check -f >> "$LOG" 2>&1 || true
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
    "$ISO_ROOT" 2>&1

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
