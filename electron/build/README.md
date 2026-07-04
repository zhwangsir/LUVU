# build/ — electron-builder 打包资源

放置：
- `icon.icns` (macOS, 1024x1024)
- `icon.png` (Windows/Linux, 1024x1024)
- 可选 `entitlements.mac.plist` 用于公证

> 当前未放图标，electron-builder 会用默认 Electron 图标打包。
> 准备好图标后放到此目录，重新跑 `pnpm package:mac`。
