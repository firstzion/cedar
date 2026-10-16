#!/bin/bash
# Creates the Haxall database on first run, then starts the server.
set -e
export PATH=$PATH:/app/haxall/bin
mkdir -p /app/haxall/dbs && cd /app/haxall/dbs
if [ ! -d "$HAXALL_DB_NAME" ] || [ -z "$(ls -A "$HAXALL_DB_NAME")" ]; then
  echo "Initialising database $HAXALL_DB_NAME ..."
  fan hx init -headless "$HAXALL_DB_NAME" -suUser "$HAXALL_SU_USERNAME" -suPass "$HAXALL_SU_PASSWORD"
else
  echo "Database $HAXALL_DB_NAME already exists, skipping init."
fi
exec fan hx run "$HAXALL_DB_NAME"
