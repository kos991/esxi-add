#!/usr/bin/env bash
# Run over SSH on the existing Docker host. Builds only this isolated app.
set -Eeuo pipefail
root=${1:?usage: deploy-isolated.sh DEPLOY_ROOT RELEASE SOURCE_DIR}
release=${2:?release tag required}
source_dir=${3:?source directory required}
[[ $release =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]+$ ]] || exit 2
root=$(realpath "$root")
source_dir=$(realpath "$source_dir")
project=esxi-source-cleanup-20261112
container=${project}-app-1
for tool in docker curl python3 flock sha256sum; do command -v "$tool" >/dev/null; done
cd "$root"
test -f compose.yaml
test -f "$source_dir/Dockerfile"
docker compose version >/dev/null
docker buildx version >/dev/null
exec 9>"$root/.deploy.lock"
flock -n 9 || { echo 'Another deployment holds the lock' >&2; exit 1; }
record="$root/releases/$release"
mkdir -p "$root/releases"
mkdir "$record" # A release identity is never silently reused.

snapshot_dns() {
 docker inspect veladns | python3 -c 'import json,sys; d=json.load(sys.stdin)[0]; print(json.dumps({"id":d["Id"],"started":d["State"]["StartedAt"],"restarts":d["RestartCount"],"health":d["State"]["Health"]["Status"]},sort_keys=True)); assert d["State"]["Health"]["Status"]=="healthy"'
}
snapshot_dns >"$record/veladns-before.json"
old_image=$(docker inspect "$container" --format '{{.Image}}')
docker image inspect "$old_image" >/dev/null
printf '%s\n' "$old_image" >"$record/old-image.txt"
printf 'services:\n  app:\n    image: %s\n' "$old_image" >"$record/rollback.yaml"
cat >"$record/rollback.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd '$root'
docker image inspect '$old_image' >/dev/null
docker compose -p '$project' -f compose.yaml -f '$record/rollback.yaml' up -d --no-deps --pull never app
for attempt in {1..60}; do
 if [ "\$(docker inspect '$container' --format '{{.State.Health.Status}}')" = healthy ] && curl -fsS --max-time 10 http://127.0.0.1:8080/health; then exit 0; fi
 sleep 3
done
exit 1
EOF
chmod 700 "$record/rollback.sh"

assert_idle() {
 docker exec -i "$container" python3 - <<'PY'
import os,sqlite3
con=sqlite3.connect('file:'+os.environ.get('DB_PATH','/data/db/esxi-builder.db')+'?mode=ro',uri=True,timeout=10)
rows=con.execute("select task_id,status from build_tasks where deleted_at is null and status in ('pending','running')").fetchall()
print('unfinished SQL tasks:',rows)
assert not rows, 'Refusing deployment with active or waiting tasks'
PY
 for queue in active pending; do
  count=$(docker exec "$container" redis-cli --raw LLEN "asynq:{default}:$queue")
  [[ $count = 0 ]] || { echo "$queue queue not empty: $count" >&2; return 1; }
 done
 for queue in scheduled retry; do
  count=$(docker exec "$container" redis-cli --raw ZCARD "asynq:{default}:$queue")
  [[ $count = 0 ]] || { echo "$queue queue not empty: $count" >&2; return 1; }
 done
}
assert_idle | tee "$record/idle-before-build.txt"
# Keep the existing Dockerfile and its known working BuildKit caches/network.
image="esxi-source-cleanup:$release"
if docker image inspect "$image" >/dev/null 2>&1; then echo 'Release image already exists' >&2; exit 1; fi
docker buildx build --network=host --load --progress=plain --build-arg "APP_VERSION=$release" -t "$image" "$source_dir" 2>&1 | tee "$record/build.log"
new_image=$(docker image inspect "$image" --format '{{.Id}}')
printf '%s\n' "$new_image" >"$record/new-image.txt"
printf 'services:\n  app:\n    image: %s\n' "$new_image" >"$record/release.yaml"
assert_idle | tee "$record/idle-before-switch.txt"
snapshot_dns >"$record/veladns-preswitch.json"
cmp "$record/veladns-before.json" "$record/veladns-preswitch.json"
# Snapshot SQLite consistently, including WAL, while the old app is idle.
docker exec -i "$container" python3 - <<'PY' >"$record/database-backup.log"
import os,sqlite3,time
path=os.environ.get('DB_PATH','/data/db/esxi-builder.db')
target=path+'.pre-release-'+str(time.time_ns())+'.backup'
with sqlite3.connect(path,timeout=30) as src, sqlite3.connect(target) as dst: src.backup(dst)
print(target)
PY
switched=0
on_exit() {
 code=$?
 trap - EXIT
 if (( code != 0 && switched == 1 )); then
  echo 'Deployment failed; restoring previous immutable image' >&2
  bash "$record/rollback.sh" || echo "ROLLBACK FAILED: $record/rollback.sh" >&2
 fi
 snapshot_dns >"$record/veladns-after.json" || code=1
 cmp "$record/veladns-before.json" "$record/veladns-after.json" || code=1
 exit "$code"
}
trap on_exit EXIT
switched=1
docker compose -p "$project" -f compose.yaml -f "$record/release.yaml" up -d --no-deps --pull never app
healthy=0
for attempt in {1..60}; do
 if [[ $(docker inspect "$container" --format '{{.State.Health.Status}}') = healthy ]] && curl -fsS --max-time 10 http://127.0.0.1:8080/health >"$record/health.json"; then healthy=1; break; fi
 sleep 3
done
[[ $healthy = 1 ]]
[[ $(docker inspect "$container" --format '{{.Image}}') = "$new_image" ]]
assert_idle >"$record/idle-after-switch.txt"
curl -fsS --max-time 10 http://127.0.0.1:8080/ > /dev/null
curl -fsS --max-time 10 http://127.0.0.1:8080/api/system/status >"$record/system-status.json"
docker tag "$new_image" "esxi-source-cleanup:stable-$release"
printf 'Use for subsequent starts: docker compose -p %s -f compose.yaml -f %q up -d --no-deps --pull never app\n' "$project" "$record/release.yaml" >"$record/start-command.txt"
printf 'Released %s (%s). Rollback: bash %s/rollback.sh\n' "$release" "$new_image" "$record"
