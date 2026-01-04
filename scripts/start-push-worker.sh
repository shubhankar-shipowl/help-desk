#!/bin/bash
cd "$(dirname "$0")/.."
exec npx tsx lib/notifications/workers/push-worker.ts
