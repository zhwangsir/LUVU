# LUVU 安装指南

> 非开发者用户拿到 `.dmg` 后怎么装。

---

## macOS

### 下载

从 `electron/release/0.6.3/` 拿对应 cpu 架构的 dmg：

| 文件 | 适用 | 大小 |
|------|------|------|
| `LUVU-0.6.3-arm64.dmg` | Apple Silicon (M1/M2/M3/M4) | 108 MB |
| `LUVU-0.6.3.dmg` | Intel Mac | 113 MB |

不知道自己是 arm64 还是 Intel？ → 苹果菜单 → 关于本机 → 看 "芯片"：M 开头 = arm64，Intel = x64。

### 首次打开（重要）

**当前 dmg 是 unsigned 状态**（没买 Apple Developer 证书 99 USD/年），所以 macOS 默认会拦。
解决方法：

1. 双击 dmg → 把 LUVU 拖到 Applications
2. 进 Applications，**右键点 LUVU → 选「打开」**（不是双击！）
3. 弹出「来自身份不明开发者」对话框 → 点「打开」
4. 之后双击即可正常启动

如果还提示「已损坏，应该移到废纸篓」（macOS 12+ 更严），打开终端跑：

```bash
xattr -cr /Applications/LUVU.app
```

这是去除 macOS quarantine 标记，本地化资源无安全风险。

### 首次启动

1. 桌面右上角会浮出立绘 + 弹出「欢迎来到 LUVU」引导对话框（v0.13+）
2. 按引导填 LLM endpoint（先装 Ollama 或 LM Studio）
3. TTS sidecar 可选，需要 Python 3.10+

### 卸载

```bash
# 删 app
rm -rf /Applications/LUVU.app
# 删用户数据（含模型缩略图缓存 + 对话历史 + 配置）
rm -rf ~/.luvu/
```

---

## Windows

> v0.13 时点 — Windows 包尚未实测过。Maintainer 主测平台是 macOS。

理论上跑：
```bash
pnpm package:win
```
产物在 `electron/release/0.6.3/LUVU Setup 0.6.3.exe`（nsis installer）。

---

## Linux

> v0.13 时点 — Linux 包尚未实测过。

理论上跑：
```bash
pnpm package:linux
```
产物 `electron/release/0.6.3/LUVU-0.6.3.AppImage`。

---

## 从源码开发

见 [README.md 的「快速开始」section](README.md#-快速开始)。

```bash
git clone https://github.com/zhwangsir/LUVU.git
cd LUVU
pnpm install
pnpm dev
```

---

## 常见问题

**Q: LUVU 开了但没说话？**
A: TTS sidecar 需要单独装，见 [README.md 的「配 TTS sidecar」section](README.md)。

**Q: 立绘出来了但没对话？**
A: LLM 没配。右键立绘 → 设置 → 🧠 大脑 tab 填 endpoint + model。

**Q: 占用多少磁盘？**
A: app 本身 ~250 MB；模型库（自己放）5-17 GB；TTS sidecar 模型（可选）4-6 GB。
设置 → 📊 占用 可以看实时统计。
