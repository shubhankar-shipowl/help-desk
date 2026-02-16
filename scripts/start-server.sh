#!/bin/bash
cd "$(dirname "$0")/../frontend"
exec npx tsx server.ts
