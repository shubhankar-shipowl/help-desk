#!/bin/bash
cd "$(dirname "$0")/../frontend"
exec npx tsx lib/backup/backup-worker.ts

