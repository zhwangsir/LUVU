# Cubism SDK Manual 索引（中文版）

> 来源：https://docs.live2d.com/zh-CHS/cubism-sdk-manual/top/
> 抓取日期：2026-05-19
> 用途：LUVU 项目内部速查 — 需要细节时按 URL 抓取对应章节。

---

## 0. 入口

- [Cubism SDK 手册首页](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/top/)

## 1. 版本与新功能

- [Cubism 5.3 新功能 SDK 支持](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/cubism-5-3-new-functions/)
- [Cubism 5 新功能 SDK 支持](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/cubism-5-new-functions/)
- [Cubism 4 新功能 SDK 支持](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/cubism-4-new-functions/)
- [Cubism 4.2 新功能 SDK 支持](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/cubism-4-2-new-functions/)

## 2. 兼容性与迁移

- [Cubism 5 SDK R5 正式版兼容性](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/compatibility-with-cubism-5-3-official/)
- [Cubism 5.3 SDK 兼容性与限制](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/compatibility-with-cubism-5-3/)
- [Cubism 5 功能 SDK 兼容性](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/compatibility-with-cubism-5/)
- [Cubism 4.2 功能 SDK 兼容性](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/compatibility-with-cubism-4-2/)
- [旧项目迁移到 Cubism 5 SDK](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/update-sdk-to-cubism5/)
- [旧项目迁移到 Cubism 4 SDK](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/update-sdk-to-cubism4/)

## 3. 通知 / 注意事项

- [Cubism 3.3+ 更新注意事项](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/warnnig-for-cubism3-3-00-update/)
- [关于 motion3.json 再现性变差](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/reproducibility-motion3-json/)

## 4. 平台 / 选型

- [平台支持](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/platform/)
- [各 SDK 比较](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/cubismsdk-compare/)
- [Unity vs Native 选择流程图](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/unitynativesdk-choice-flow/)
- [不同工作流的动态创建差异](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/sdk-type-for-motion/)
- [csmUpdateModel 的 Neon 指令支持](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/core-simd/)

## 5. Original Workflow（核心机制 — 必读）

- [关于 Original Workflow](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/original-workflow/)
- [SDK 构成](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/sdkconstruction/)
- [与 2.1 SDK 的区别](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/changefrom21/)
- [DrawableVertexPositions 范围](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/drawablevertexpositions/)
- [DrawableVertexPosition 验证](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/drawablevertexposition-checking/)
- [验证模型一致性](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/moc3-consistency/)

### 5.1 Framework 初始化

- [Framework 初始化/退出（Native）](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/framework-init-close/)
- [Framework 初始化/退出（Web）](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/framework-init-close-web/) ⭐
- [Framework 初始化/退出（Java）](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/framework-init-close-java/)

### 5.2 模型操作

- [关于模型（Native）](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/model/)
- [关于模型（Web）](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/model-web/) ⭐
- [关于模型（Java）](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/model-java/)
- [模型位置/缩放](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/layout/)

### 5.3 参数与动画特性

- [参数操作](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/parameters/) ⭐
- [模型重叠检测](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/hitarea/)
- [自动眨眼](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/autoeyeblink/) ⭐
- [呼吸](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/breath/) ⭐
- [口形同步](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/lipsync/) ⭐
- [用户数据](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/userdata/)
- [物理模拟](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/physics/) ⭐
- [稳定物理模拟](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/stabilize-physics/)
- [姿势](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/pose/) ⭐
- [动态](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/motion/) ⭐
- [表情动态](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/expression/) ⭐
- [Cubism 5+ 表情转换修复](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/blending-expression/)

### 5.4 蒙版 / 渲染

- [蒙版前处理（Native）](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/ow-sdk-mask-premake/)
- [蒙版前处理（Web）](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/ow-sdk-mask-premake-web/)
- [蒙版前处理（Java）](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/ow-sdk-mask-premake-java/)
- [显示辅助文件 cdi3.json](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/cdi3json/)
- [OW 混合模式](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/blend-mode-ow/)
- [OW 离屏绘制](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/offscreen-drawing-alias-ow/)
- [离屏 RenderTexture 处理](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/handle-render-texture-for-offscreen/)

## 6. Cubism Core

- [Cubism Core](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/cubism-core/) ⭐
- [Cubism Core API 参考](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/cubism-core-api-reference/) ⭐

## 7. SDK for Native

- [SDK for Native](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/cubism-sdk-for-native/)
- [动作开始/结束回调](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/callback-motion-end-native/)
- [直接使用 CubismNativeFramework](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/cubismnativeframework/)
- [Native 正片叠底/屏幕色](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/multiply-color-screen-color-native/)

## 8. SDK for Web ⭐（LUVU 主用）

- [SDK for Web](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/cubism-sdk-for-web/)
- [Cubism 4 SDK for Web R1+ 更新注意事项](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/warning-for-cubism4-web-r1-update/)
- [动作开始/结束回调（Web）](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/callback-motion-end-web/) ⭐
- [直接使用 CubismWebFramework](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/use-framework-web/) ⭐
- [Web 版特有注意事项](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/point-to-note/) ⭐
- [Web 正片叠底/屏幕色](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/multiply-color-screen-color-web/)
- [置入多张 Canvas](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/multiple-canvas/)

## 9. SDK for Unity

- [SDK for Unity](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/cubism-sdk-for-unity/)
- [2.1 → 3.0 框架变更](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/cubismcomponents/)
- [与 Cubism 5 SDK for Unity R4_1 区别](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/differences-from-before-unity-r4_1/)
- [输出平台注意事项](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/point-to-note-for-platform/)
- [Unity 2018.3 项目](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/unity2018-3/)
- [Unity 值操作时机](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/update-value-unity/)
- [Importer / Deleter](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/importerdeleter/)
- [Unity 性能调整](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/performance-unity/)
- [Unity 参数操作](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/cubism-sdk-for-unity-parameter/)
- [SRP 使用注意事项](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/scriptable-render-pipeline/)
- [Unity 正片叠底/屏幕色](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/multiply-color-screen-color-unity/)
- [Unity 蒙版使用上限](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/maximum-number-of-masks-used/)
- [Assembly Definition 支持](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/assembly-definition/)
- [Unity 混合模式](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/blend-mode-unity/)
- [Unity 离屏绘制](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/offscreen-drawing-unity/)
- [自定义渲染通道](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/rendering-urp/)
- [BiRP → URP 迁移](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/migration-from-birp-to-urp/)
- [URP 蒙版](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/about-masks-in-urp/)
- [绘制中断功能](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/rendering-interrupt-unity/)

### Unity Framework

- [EyeBlink](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/eyeblink-unity/)
- [HarmonicMotion](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/harmonicmotion/)
- [Json](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/json-unity/)
- [LookAt](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/lookat-unity/)
- [MouthMovement](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/mouthmovement-unity/)
- [Raycasting](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/raycasting-unity/)
- [UserData](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/userdata-unity/)

### Unity OW

- [Unity For OW](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/unity-for-ow/)
- [CubismParameterStore](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/parameterstore/)
- [CubismUpdateController](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/updatecontroller/)
- [Expression](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/expression-unity/)
- [Motion](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/motion-unity/)
- [MotionFade](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/motionfade/)
- [Pose](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/pose-unity/)

### Unity Samples

- [Animation](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/animation-unity-sample/)
- [AsyncBenchmark](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/asyncbenchmark/)
- [AutomaticAsyncBenchmark](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/automaticasyncbenchmark/)
- [LookAt 范例](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/lookat-unity-sample/)
- [Masking](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/masking-unity-sample/)
- [MultipleModels](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/multiplemodels-unity-sample/)
- [PerspectiveCamera](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/perspectivecamera-unity-sample/)
- [Raycasting 范例](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/raycasting-unity-sample/)

## 10. SDK for Java

- [SDK for Java](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/cubism-sdk-for-java/)
- [动作结束回调（Java）](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/calback-motion-end-java/)
- [直接使用 CubismJavaFramework](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/use-framework-java/)
- [Java 版特有注意事项](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/point-to-note-java/)
- [Java 正片叠底/屏幕色](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/multiply-color-screen-color-java/)

## 11. SDK for Cocos Creator

- [SDK for Cocos Creator](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/cubism-sdk-for-cocos-creator/)
- [值操作时机](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/update-value-cocos/)
- [性能调优](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/performance-cocos/)
- [参数操作](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/cubism-sdk-for-cocos-parameter/)
- [Cocos Creator 版注意事项](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/point-to-note-cocos/)
- [正片叠底/屏幕色](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/multiply-color-screen-color-cocos/)

### Cocos Framework / OW / Samples

- EyeBlink / HarmonicMotion / Json / LookAt / MouthMovement / Raycasting / UserData
- CocosCreator For OW / CubismParameterStore / CubismUpdateController / Expression / Pose / CubismMotionApplier
- Animation / LookAt 范例

（完整 URL 列表见 SDK Manual 首页对应章节，按需抓取）

## 12. SDK for Unreal Engine

- [SDK for Unreal Engine](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/cubism-sdk-for-unreal-engine/)
- [UE 版特别注意事项](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/point-to-note-ue/)
- [动作结束回调（UE）](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/callback-motion-end-ue/)
- [正片叠底/屏幕色（UE）](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/multiply-color-screen-color-ue/)
- [蒙版纹理规格（UE）](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/mask-texture-ue/)

### UE Framework

- Expression / EyeBlink / HarmonicMotion / Json / LipSync / LookAt / UserData / Motion / Pose / Raycast / ParameterStore

## 13. SDK MotionSync Plugin

- [MotionSync 平台支持](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/motionsync-plugin-platform/)
- [在 Cubism 4.2- 模型中使用](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/use-models-cubism-4-2/)
- MotionSync for Unity / Native / Web — 含动态同步设置、场景使用、WebGL 行为

## 14. Cubism Unity Samples Extended

- [入口](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/cubism-unity-samples-extended/)
- Blur / Following / FollowingCollider / MaskLimit / Mosaic / SetTexture

## 15. FAQ

- [常见问题](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/faq/)
- [纹理显示异常时](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/texture-trouble-shooting/)

---

⭐ = LUVU 项目当前阶段最相关。
