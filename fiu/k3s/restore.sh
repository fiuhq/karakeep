#!/bin/sh
# Restores Karakeep's two SQLite databases (db.db and the job queue) from the newest replica the pointer names, then
# writes this pod's own Litestream config. /work/pointer holds pod UIDs newest first; the pointer-read step fetched it.
# A UID whose replica holds nothing yet (a pod that died before its first upload) is skipped for the next one.
# The UID restored from goes to /work/restored-from, so pointer-write never trims it away.
set -eu

config() { # $1: the UID whose replica to use, $2: where to write the config
  cat > "$2" <<YAML
dbs:
  - path: /data/db.db
    replica: { type: s3, endpoint: "$R2_ENDPOINT", bucket: "$R2_BUCKET", path: "litestream/$1/db", region: auto, sync-interval: 10s }
  - path: /data/queue.db
    replica: { type: s3, endpoint: "$R2_ENDPOINT", bucket: "$R2_BUCKET", path: "litestream/$1/queue", region: auto, sync-interval: 10s }
YAML
}

if [ -f /data/db.db ]; then
  echo "this pod already holds its database (a container restart): nothing to restore"
else
  from=""
  for uid in $(cat /work/pointer); do
    config "$uid" /work/restore.yml
    litestream restore -config /work/restore.yml -if-replica-exists -integrity-check quick /data/db.db
    if [ -f /data/db.db ]; then
      litestream restore -config /work/restore.yml -if-replica-exists /data/queue.db
      from=$uid
      break
    fi
  done
  echo "$from" > /work/restored-from
  echo "restored from: ${from:-nothing, no replica exists yet, so Karakeep starts empty}"
fi
config "$POD_UID" /work/litestream.yml
