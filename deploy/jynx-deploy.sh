#!/usr/bin/env bash
set -euo pipefail

source_dir=/root/jynx.js
target_dir=/opt/jynx
request_file="$target_dir/.deploy-request"
first_stage=$(mktemp -d /tmp/jynx-pr.XXXXXX)
main_stage=$(mktemp -d /tmp/jynx-main.XXXXXX)
trap 'rm -rf "$first_stage" "$main_stage"' EXIT

mapfile -t deployment < <(
  node -e '
    const fs = require("node:fs");
    const request = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (!Number.isInteger(request.prNumber) || request.prNumber < 1) throw new Error("invalid PR");
    if (!/^jynx\/[a-z0-9/-]+$/.test(request.branch ?? "")) throw new Error("invalid branch");
    console.log(request.prNumber);
    console.log(request.branch);
  ' "$request_file"
)
pr_number=${deployment[0]}
branch=${deployment[1]}
rm -f "$request_file"

archive_ref() {
  local ref=$1
  local destination=$2
  git -C "$source_dir" archive "$ref" | tar -x -C "$destination"
  chown -R jynx:jynx "$destination"
}

verify_tree() {
  local directory=$1
  cd "$directory"
  runuser -u jynx -- npm ci --ignore-scripts
  isolated_npm "$directory" run typecheck
  isolated_npm "$directory" test
  isolated_npm "$directory" run lint
  isolated_npm "$directory" run build
}

isolated_npm() {
  local directory=$1
  shift
  bwrap \
    --unshare-all --share-net --new-session --die-with-parent \
    --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
    --dev /dev --proc /proc --tmpfs /tmp \
    --bind "$directory" /workspace --chdir /workspace \
    --setenv PATH /usr/local/bin:/usr/bin:/bin --setenv HOME /workspace --setenv CI 1 \
    npm "$@"
}

git -C "$source_dir" fetch origin "+refs/heads/$branch:refs/remotes/origin/$branch"
archive_ref "origin/$branch" "$first_stage"
verify_tree "$first_stage"

node --env-file="$target_dir/.env" /usr/local/lib/jynx/merge-pr.mjs "$pr_number" "$branch"

git -C "$source_dir" checkout main
git -C "$source_dir" pull --ff-only origin main
archive_ref main "$main_stage"
verify_tree "$main_stage"
cd "$main_stage"
runuser -u jynx -- npm prune --omit=dev --ignore-scripts

rsync -a --delete \
  --exclude=.env \
  --exclude=.jynx-work \
  --exclude=.deploy-request \
  --exclude=webhook.pem \
  "$main_stage/" "$target_dir/"
chown -R jynx:jynx "$target_dir"
systemctl restart jynx
