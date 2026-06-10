#!/bin/sh
# Drains the daily-eval queue in bounded batches so no single HTTP request
# exceeds the edge (~100s) proxy timeout. Loops until remaining=0.
# Used by the cron-daily-eval Render Cron Job. Needs $APP_URL and $CRON_SECRET.
set -e

while : ; do
  R=$(curl -fsS -A "Mozilla/5.0 (compatible; BytesQA-Cron/1.0)" \
        --retry 5 --retry-all-errors --retry-delay 20 \
        -X POST "$APP_URL/api/cron/daily-eval?limit=40" \
        -H "Authorization: Bearer $CRON_SECRET")
  echo "$R"

  # Stop on any non-success response (don't hot-loop on errors).
  case "$R" in
    *'"status":"success"'*) ;;
    *) echo "non-success response — stopping"; exit 1 ;;
  esac

  # Done when nothing is left to grade.
  case "$R" in
    *'"remaining":0'*) echo "queue drained"; break ;;
  esac
done
