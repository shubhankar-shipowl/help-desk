#!/bin/bash
# Script to kill process on port 4002

PORT=${1:-4002}
PID=$(lsof -ti:$PORT)

if [ -z "$PID" ]; then
  echo "No process found on port $PORT"
else
  echo "Killing process $PID on port $PORT"
  kill -9 $PID
  echo "Process killed"
fi

