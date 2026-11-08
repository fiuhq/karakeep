#!/bin/sh
# Applies Karakeep to fiuhq/k3s from the Mac. Renders upstream's kubernetes/ and this overlay in a scratch directory,
# with the .env/.secrets upstream's kustomization reads filled from secrets.json, so no secret lands in the checkout.
#   usage: fiu/k3s/deploy.sh   (KUBECONFIG must point at the cluster; FIU_SECRETS defaults to the workspace's file)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
secrets=${FIU_SECRETS:-$HOME/workspace/secrets.json}
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/fiu"
cp -R "$repo/kubernetes" "$scratch/kubernetes"
cp -R "$here" "$scratch/fiu/k3s"
python3 - "$secrets" "$scratch/kubernetes" <<'PY'
import json, os, secrets as rnd, subprocess, sys
path, out = sys.argv[1], sys.argv[2]
s = json.load(open(path))
k = s.setdefault("karakeep", {})
changed = False
for key in ("nextauth_secret", "meili_master_key", "next_public_secret"):
    if key not in k:
        k[key] = rnd.token_urlsafe(36); changed = True
if changed:  # first deploy: keep the generated app secrets so every later deploy reuses them
    fd = os.open(path, os.O_WRONLY | os.O_TRUNC); os.write(fd, (json.dumps(s, indent=2) + "\n").encode()); os.close(fd)
r2 = k["r2"]
ts = json.loads(subprocess.run(["/Applications/Tailscale.app/Contents/MacOS/Tailscale", "status", "--json"], capture_output=True, text=True, check=True).stdout)
# Karakeep's URL is the tailnet name of the node the kubeconfig talks to: the always-on server, whose front serves it.
server = subprocess.run(["kubectl", "config", "view", "--minify", "-o", "jsonpath={.clusters[0].cluster.server}"], capture_output=True, text=True, check=True).stdout
server_ip = server.split("//")[1].rsplit(":", 1)[0]
host = next(p["DNSName"].rstrip(".") for p in ts["Peer"].values() if server_ip in p.get("TailscaleIPs", []))
env = {"NEXTAUTH_URL": f"http://{host}:3000", "KARAKEEP_VERSION": "0.34.1", "ASSET_STORE_S3_BUCKET": r2["bucket"]}
sec = {"NEXTAUTH_SECRET": k["nextauth_secret"], "MEILI_MASTER_KEY": k["meili_master_key"], "NEXT_PUBLIC_SECRET": k["next_public_secret"],
       "OPENAI_API_KEY": s["llmgateway"]["api_key"], "ASSET_STORE_S3_ENDPOINT": r2["endpoint"],
       "ASSET_STORE_S3_ACCESS_KEY_ID": r2["access_key_id"], "ASSET_STORE_S3_SECRET_ACCESS_KEY": r2["secret_access_key"]}
if "api_key" in k:  # the first account's key, made after the first deploy; lets a moved pod rebuild its search index
    sec["KARAKEEP_ADMIN_API_KEY"] = k["api_key"]
for name, d in ((".env", env), (".secrets", sec)):
    fd = os.open(os.path.join(out, name), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.write(fd, "".join(f"{a}={b}\n" for a, b in d.items()).encode()); os.close(fd)
PY
kubectl apply -k "$scratch/fiu/k3s"
