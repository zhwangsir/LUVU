#!/usr/bin/env bash
# 一键推送 LUVU 到你的 GitHub。
# 用法：bash scripts/push-to-github.sh [仓库名]
# 默认仓库名：LUVU

set -euo pipefail

REPO_NAME="${1:-LUVU}"
VISIBILITY="${LUVU_REPO_VIS:-private}" # 默认私有，需要公开请改 public

cd "$(dirname "$0")/.."

# 1. 校验 gh 登录
if ! gh auth status >/dev/null 2>&1; then
  echo "❌ 请先登录：gh auth login"
  exit 1
fi

# 2. 检查仓库是否已存在
OWNER=$(gh api user --jq .login)
if gh repo view "$OWNER/$REPO_NAME" >/dev/null 2>&1; then
  echo "ℹ️  GitHub 仓库 $OWNER/$REPO_NAME 已存在，跳过创建。"
else
  echo "🚀 创建 GitHub 仓库 $OWNER/$REPO_NAME（$VISIBILITY）..."
  gh repo create "$REPO_NAME" \
    --"$VISIBILITY" \
    --description "LUVU — 离线本地的 Live2D 桌面伴侣，专属灵魂、永远只属于 master" \
    --source=. \
    --remote=origin \
    --push=false
fi

# 3. 设置 remote（幂等）
if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "https://github.com/$OWNER/$REPO_NAME.git"
fi

# 4. 推送 main + tags
echo "📤 推送 main 分支与所有 tag..."
git push -u origin main
git push origin --tags

echo ""
echo "✅ 推送完成！"
echo "🔗 https://github.com/$OWNER/$REPO_NAME"
echo ""
echo "下一步可做的："
echo "  - gh release create v0.1.0 --notes-from-tag    # 发布 v0.1.0 release"
echo "  - 或在 Web 上手动创建 release"
