#!/usr/bin/env bash
# Starts or stops a local Spark Connect server (gRPC, port 15002) with the Spark that PySpark ships, for the specs that run against Spark
# (`npm run test:spark`). PySpark is installed by `uv sync --extra spark`; the Spark Connect jar is fetched from Maven the first time.
#
#   scripts/spark-connect.sh start   starts it in the background and waits until it answers
#   scripts/spark-connect.sh stop    stops it
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$ROOT/.spark"
PORT="${SPARK_CONNECT_PORT:-15002}"
VERSION="3.5.9"

spark_home() {
  uv run --extra spark python -c 'import os, pyspark; print(os.path.dirname(pyspark.__file__))'
}

case "${1:-}" in
  start)
    if [ -f "$STATE/server.pid" ] && kill -0 "$(cat "$STATE/server.pid")" 2>/dev/null; then
      echo "Spark Connect is already running on port $PORT (pid $(cat "$STATE/server.pid"))"
      exit 0
    fi
    mkdir -p "$STATE"
    # the tables of an earlier run are gone with its server, and their files would be in the way of making them again
    rm -rf "$STATE/warehouse"
    : > "$STATE/server.log"
    SPARK_HOME="$(spark_home)"
    export SPARK_HOME
    nohup "$SPARK_HOME/bin/spark-submit" \
      --class org.apache.spark.sql.connect.service.SparkConnectServer \
      --name data-finder-ts-spark-connect \
      --packages "org.apache.spark:spark-connect_2.12:$VERSION" \
      --master 'local[2]' \
      --conf "spark.connect.grpc.binding.port=$PORT" \
      --conf "spark.sql.warehouse.dir=$STATE/warehouse" \
      --conf spark.sql.session.timeZone=UTC \
      --conf spark.driver.host=127.0.0.1 \
      --conf spark.ui.enabled=false \
      spark-internal > "$STATE/server.log" 2>&1 &
    echo $! > "$STATE/server.pid"
    for _ in $(seq 1 180); do
      if grep -q "Spark Connect server started" "$STATE/server.log"; then
        echo "Spark Connect is running on port $PORT (pid $(cat "$STATE/server.pid"))"
        exit 0
      fi
      if ! kill -0 "$(cat "$STATE/server.pid")" 2>/dev/null; then
        echo "Spark Connect stopped while starting; see $STATE/server.log" >&2
        tail -20 "$STATE/server.log" >&2
        exit 1
      fi
      sleep 1
    done
    echo "Spark Connect did not start within 3 minutes; see $STATE/server.log" >&2
    exit 1
    ;;
  stop)
    if [ -f "$STATE/server.pid" ] && kill -0 "$(cat "$STATE/server.pid")" 2>/dev/null; then
      kill "$(cat "$STATE/server.pid")"
      rm -f "$STATE/server.pid"
      echo "Spark Connect stopped"
    else
      echo "Spark Connect is not running"
    fi
    ;;
  *)
    echo "usage: $0 start|stop" >&2
    exit 2
    ;;
esac
