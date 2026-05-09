# Usage Guide

## Basic Workflow

1. Open the web UI at `http://localhost:8080`.
2. Go to **Storage & Assets**.
3. Confirm the default local storage node, or add an S3-compatible/R2 node.
4. Upload ESXi Depot files and driver bundles, or place files in the configured storage path and click refresh.
5. Open **Custom Build**.
6. Select the target ESXi version.
7. Choose a Depot from the mixed storage node list.
8. Select optional drivers.
9. Run the download validation step.
10. Start the ISO build after validation succeeds.
11. Open the task detail page to watch progress and logs.
12. Download the completed ISO from the local API button, or use the remote public URL button when a public domain is configured on the storage node.

## Local Storage Layout

Recommended layout under the configured storage path:

```text
/data/storage/
  depot/6x/ESXi670-202210001.zip
  depot/8x/VMware-ESXi-8.0U3w-24784741-depot.zip
  driver/8x/network/net-driver-offline_bundle.zip
  output/custom-esxi.iso
```

Supported aliases include both version directories such as `6.5`, `6.7`, `7.0`,
`8.0`, `9.0`, and legacy families such as `6x`, `7x`, `8x`, `9x`.

## Depot Selection

The build wizard discovers Depot files from all configured storage nodes for
the selected ESXi version. After selecting a Depot, the wizard uses that same
storage node for driver selection, preflight validation, and build output.

Depot labels are shortened for scanning:

```text
[NodeName] [Downloaded] 202210001
[NodeName] [Downloaded] 8.0U3w-24784741
```

## Download Validation

Before a build starts, the preflight step downloads the selected Depot and
drivers into local cache and validates file headers. Invalid cached objects,
HTML error pages, and incomplete downloads are rejected before PowerCLI runs.

## ISO Downloads

Completed task pages expose two download paths:

- **Local Download**: downloads through the backend API.
- **Remote Download**: uses the storage node public domain plus the ISO object path.

Remote Download is available only when the selected storage node has a public
domain configured.
