#!/usr/bin/env bash
# LUVU 自检脚本：当用户保持 `pnpm tauri:dev` 启动时，让 AI 远程截屏 + 抓日志。
#
# 用法：bash scripts/self-diagnose.sh
# 输出：/tmp/luvu-diag/  含 screen.png + 各种状态文件

set -e

DIAG=/tmp/luvu-diag
mkdir -p "$DIAG"

echo "=== [1] 截屏（macOS screencapture）==="
/usr/sbin/screencapture -x -t png "$DIAG/screen.png" 2>&1 || true
ls -la "$DIAG/screen.png" 2>&1 || true

echo ""
echo "=== [2] 进程状态 ==="
ps aux | grep -i "luvu\|target/debug" | grep -v grep | head -10 || echo "(no process)"

echo ""
echo "=== [3] vite 端口 ==="
lsof -ti:1420 || echo "(port closed)"

echo ""
echo "=== [4] sidecar 端口 ==="
lsof -ti:5050 || echo "(port closed)"

echo ""
echo "=== [5] HTTP endpoints ==="
for p in "/" "/src/main.ts" "/live2dcubismcore.min.js" "/live2d/HuTao-Live2D/Hu%20Tao.model3.json"; do
  code=$(/usr/bin/curl -s -o /dev/null -w "%{http_code}" "http://localhost:1420${p}" 2>/dev/null)
  printf "  %s  %s\n" "$code" "$p"
done

echo ""
echo "=== [6] sqlite memory.db ==="
DB="$HOME/Library/Application Support/LUVU/memory.db"
if [ -f "$DB" ]; then
  echo "  size: $(stat -f%z "$DB" 2>/dev/null) bytes"
  /usr/bin/sqlite3 "$DB" "SELECT count(*) || ' messages, ' || (SELECT count(*) FROM memories) || ' memories' FROM messages;" 2>/dev/null
fi

echo ""
echo "=== [7] config.json ==="
cat "$HOME/Library/Application Support/LUVU/config.json" 2>/dev/null | head -40

echo ""
echo "=== [8] 最近 Rust panic / crash logs ==="
grep -E "panicked|terminated|FATAL|ERROR" "$HOME/Library/Logs/DiagnosticReports"/*LUVU* 2>/dev/null | head -5 || echo "(no crash logs)"

echo ""
echo "诊断结果已写到 $DIAG/"
ls -la "$DIAG/"
