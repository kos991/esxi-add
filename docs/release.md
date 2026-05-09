# Release Guide

## Version Files

Update all release version references:

- `VERSION`
- `frontend/package.json`
- `frontend/package-lock.json`
- `README.md`
- `CHANGELOG.md`

## Verification

Run before tagging:

```bash
go test ./...
go vet ./...
go build ./...
cd frontend
npm run build
```

## Tag Release

```bash
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin main
git push origin v0.2.0
```

## Published Images

The Docker workflow publishes:

```text
ghcr.io/kos991/esxi-add:latest
ghcr.io/kos991/esxi-add:main
ghcr.io/kos991/esxi-add:<commit-sha>
ghcr.io/kos991/esxi-add:v0.2.0
```

The tag workflow uses the tag name as the image version label.
