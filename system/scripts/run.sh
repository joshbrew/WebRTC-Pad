#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$project_dir"
pad_install_node=1
. "$project_dir/system/scripts/ensure-node.sh"
exec node --env-file-if-exists=.env system/scripts/run.mjs "$@"
