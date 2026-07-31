#!/usr/bin/env bash
set -euo pipefail

source_dir=/root/jynx.js
target_dir=/opt/jynx
staging_dir=$(mktemp -d /tmp/jynx-deploy.XXXXXX)
trap 'rm -rf "$staging_dir"' EXIT
rm -f "$target_dir/.deploy-request"

git -C "$source_dir" fetch origin main
git -C "$source_dir" checkout main
git -C "$source_dir" pull --ff-only origin main
rsync -a --delete \
  --exclude=.git \
  --exclude=.env \
  --exclude=node_modules \
  --exclude=.jynx-work \
  --exclude=.deploy-request \
  --exclude=webhook.pem \
  "$source_dir/" "$staging_dir/"
chown -R jynx:jynx "$staging_dir"

isolated_npm() {
  runuser -u jynx -- bwrap \
    --unshare-all \
    --new-session \
    --die-with-parent \
    --ro-bind /usr /usr \
    --ro-bind /lib /lib \
    --ro-bind /lib64 /lib64 \
    --dev /dev \
    --proc /proc \
    --tmpfs /tmp \
    --bind "$staging_dir" /workspace \
    --chdir /workspace \
    --setenv PATH /usr/local/bin:/usr/bin:/bin \
    --setenv HOME /workspace \
    --setenv CI 1 \
    npm "$@"
}

cd "$staging_dir"
runuser -u jynx -- npm ci --ignore-scripts
isolated_npm run typecheck
isolated_npm test
isolated_npm run lint
isolated_npm run build
runuser -u jynx -- npm prune --omit=dev --ignore-scripts

rsync -a --delete \
  --exclude=.env \
  --exclude=.jynx-work \
  --exclude=.deploy-request \
  --exclude=webhook.pem \
  "$staging_dir/" "$target_dir/"
chown -R jynx:jynx "$target_dir"
systemctl restart jynx
