#!/bin/bash
# Remove files exceeding Cloudflare Pages 25MB limit from the build output.
# This runs in the temporary build environment only — no data loss.
find . -not -path './.git/*' -size +25M -delete
echo "Cleaned files >25MB from build output"
