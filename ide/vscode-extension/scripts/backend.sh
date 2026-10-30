#!/usr/bin/env bash
# Prints (default) or starts (--start) the Robotics Backend container used by the prototype.
# Never pulls, rebuilds, retags, removes or prunes anything.
set -euo pipefail

IMAGE="jderobot/robotics-backend:rosetta-fix"
NAME="ra-proto"
CMD=(docker run --rm -it --platform linux/amd64 --name "$NAME"
  -p 6080-6090:6080-6090 -p 7163:7163
  "$IMAGE")

if [[ "${1:-}" != "--start" ]]; then
  echo "Start the backend with:"
  echo
  echo "  ${CMD[*]}"
  echo
  echo "or run: $0 --start"
  echo "Ready when the logs show: Listening on port 7163 for clients.."
  exit 0
fi

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Image $IMAGE not found locally. This script won't pull or build it (see README)." >&2
  exit 1
fi
if [[ -n "$(docker ps -aq --filter "name=^${NAME}$")" ]]; then
  echo "A container named $NAME already exists. Stop it first: docker stop $NAME" >&2
  exit 1
fi
echo "> ${CMD[*]}"
exec "${CMD[@]}"
