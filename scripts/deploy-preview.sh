#!/usr/bin/env bash
# moved to scripts/publish/deploy-preview.sh (site restructure, wave 1); this shim keeps old commands and notes working for a month.
exec bash "$(dirname "$0")/./publish/deploy-preview.sh" "$@"
