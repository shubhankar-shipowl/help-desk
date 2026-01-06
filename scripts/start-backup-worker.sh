#!/bin/bash
cd "$(dirname "$0")/.."
exec npx tsx lib/backup/backup-worker.ts

