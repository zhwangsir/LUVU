# RVC 音色目录与使用指南（v0.10）

47 个公开音色（ArkanDash 公开原神角色模型，100-700 epoch + 5-20 分钟干净游戏配音）+ 你自训的个人音色（可选）。

## 部署位置
- **模型**：`workstation:C:\LUVU-rvc\assets\weights\<voice_id>.pth` (~50-80MB/个)
- **索引**：`workstation:C:\LUVU-rvc\logs\<voice_id>\added_<voice_id>.index` (~300-500MB/个)
- **sidecar API**：`GET http://127.0.0.1:8765/v1/rvc/voices` 列出全部

## 使用方法

### 方式 1：LUVU UI（推荐）
1. 打开 LUVU → 设置面板 → **RVC 区块**
2. **RVC 音色** 下拉选一个（48 选 1）
3. 调 **音调偏移**（半音）：男→女声 +12，女→男声 -12，同性微调 ±2
4. 调 **索引权重**：0.75 推荐；越高越像目标音色 + 越多伪影
5. **F0 算法**：rmvpe（默认，快+准）/ harvest（最准但慢）/ pm（最快但抖）
6. 保存 → 跟 LUVU 说话即用该音色

### 方式 2：直接调 sidecar
```bash
curl -X POST http://127.0.0.1:8765/v1/audio/speech \
  -H "content-type: application/json" \
  -d '{
    "text": "你想说的话",
    "voice": "edge_xiaoxiao",
    "rvc_voice": "nahida-jp",
    "rvc_f0_up_key": 0,
    "rvc_index_rate": 0.75,
    "rvc_f0_method": "rmvpe"
  }' \
  -o output.wav
```

## 女角色（28 个，LUVU 女友定位推荐）

### 萝莉/少女音
| voice_id | 角色 | f0 建议 |
|----------|------|---------|
| `nahida-jp` | 纳西妲 须弥草神 | 0 |
| `paimon-jp` | 派蒙 应急食物 | +2 |
| `dori-jp` | 多莉 商人萝莉 | +1 |
| `qiqi-jp` | 七七 僵尸萝莉 | 0 |
| `sigewinne-jp` | 西格雯 护士萝莉 | +1 |
| `faruzan-jp` | 珐露珊 学究萝莉 | 0 |

### 元气少女音
| voice_id | 角色 | f0 |
|----------|------|----|
| `barbara-jp` | 芭芭拉 蒙德偶像 | 0 |
| `amber-jp` | 安柏 飞行队 | 0 |
| `noelle-jp` | 诺艾尔 女仆 | 0 |
| `diona-jp` | 迪奥娜 猫猫调酒师 | +1 |
| `charlotte-jp` | 夏洛蒂 记者 | +1 |
| `nilou-jp` | 妮露 须弥舞者 | 0 |

### 温柔大小姐 / 知性姐姐
| voice_id | 角色 | f0 |
|----------|------|----|
| `ayaka-jp` | 神里绫华 白鹭公主 | 0 |
| `jean-jp` | 琴 西风团长 | -1 |
| `lisa-jp` | 丽莎 图书管理员 | -2 |
| `furina-jp` | 芙宁娜 枫丹水神 | 0 |
| `navia-jp` | 娜维娅 特派员小姐 | 0 |
| `lumine-jp` | 荧 旅行者女 | 0 |
| `sucrose-jp` | 砂糖 害羞炼金术师 | 0 |
| `kuki-jp` | 久岐忍 干练姐姐 | -1 |
| `yanfei-jp` | 烟绯 律师 | 0 |

### 冷御姐 / 飒爽
| voice_id | 角色 | f0 |
|----------|------|----|
| `raiden-jp` | 雷电将军 威严 | -2 |
| `shenhe-jp` | 申鹤 仙人弟子 | -3 |
| `ningguang-jp` | 凝光 商人 | -2 |
| `dehya-jp` | 迪希雅 佣兵 | -1 |
| `lynette-jp` | 琳妮特 冷淡 | -1 |
| `sara-jp` | 九条裟罗 女武士 | -2 |
| `rosaria-jp` | 罗莎莉亚 修女 | -2 |
| `signora-jp` | 女士 执行官 | -2 |
| `greaterLordRukkhadevata-jp` | 大慈树王 神圣 | 0 |

## 男角色（17 个）

### 少年音
| voice_id | 角色 |
|----------|------|
| `aether-jp` | 旅行者空 |
| `xiao-jp` | 魈 冷酷夜叉 |
| `kazuha-jp` | 万叶 飘逸浪人 |
| `chongyun-jp` | 重云 方士 |
| `razor-jp` | 雷泽 野性少年 |
| `venti-jp` | 温迪 诗人 |
| `lyney-jp` | 林尼 魔术师 |
| `bennett-jp` | 班尼特 倒霉冒险家 |

### 青年男 / 大叔
| voice_id | 角色 |
|----------|------|
| `tartaglia-jp` | 达达利亚 公子 |
| `albedo-jp` | 阿贝多 学者 |
| `alhaitam-jp` | 艾尔海森 书记 |
| `cyno-jp` | 赛诺 风纪官 |
| `kaveh-jp` | 卡维 建筑师 |
| `neuvillette-jp` | 那维莱特 水龙王 |
| `wriothesley-jp` | 莱欧斯利 典狱长 |
| `zhongli-jp` | 钟离 岩王帝君 |
| `itto-jp` | 一斗 豪迈（**唯一 40k 采样率**） |

## 自训音色（可选）

你可以用 RVC 训练自己的音色（命名 `master` 或任意 voice_id），步骤：
1. 准备 5-20 分钟干净语音样本（单说话人，去背景音）
2. 在 workstation 跑 RVC WebUI 训练（100 epoch CPU 即可起步）
3. 模型放 `assets/weights/<voice_id>.pth`，索引放 `logs/<voice_id>/added_<voice_id>.index`
4. LUVU UI → 设置 → RVC 音色下拉就会列出

## 推荐组合（LUVU 女友场景）

| 场景 | 推荐 |
|------|------|
| 默认温柔陪伴 | `furina-jp` f0=0 index=0.75 |
| 萝莉治愈 | `nahida-jp` f0=0 index=0.75 |
| 御姐反差 | `raiden-jp` f0=-2 index=0.7 |
| 大小姐 | `ayaka-jp` f0=0 index=0.8 |
| 元气陪伴 | `barbara-jp` f0=0 index=0.75 |
| 听你自训音色 | `<your_voice_id>` f0=0 index=0.75 |
| 不用 RVC | 设置里清空 RVC 音色，走纯 edge_tts |

## 参数微调

| 参数 | 范围 | 调法 |
|------|-----|------|
| `f0_up_key` | -12 ~ +12 半音 | 男→女 +12 / 女→男 -12 / 同性 ±2 |
| `index_rate` | 0.0 ~ 1.0 | 0.5=模型为主，1.0=索引为主。**0.75 多数最佳** |
| `f0_method` | rmvpe/harvest/pm | rmvpe 推荐；电影级用 harvest（慢 3x） |

## 性能（端到端）

| 链路 | 时间 |
|------|------|
| edge_tts 生成 | ~1.0s |
| RVC convert（已 cache） | ~0.5-1.0s |
| **首次新 voice** | 多 ~5s 冷启动 |
| **总端到端** | **1.5-2.5s** |

切换音色第一次会 load `.pth` + `.index` 到 GPU 需要 ~5 秒，后续热的无延迟。同时只能 load 1 个 voice。

## 磁盘成本

- workstation `C:\LUVU-rvc`：~38GB（17GB Live2D models + 20GB RVC voices + 1GB pretrained）
- mac 项目：17GB `electron/models-library/`（git ignore）

## 排错

某个 voice 推理报错：
1. `/v1/rvc/voices` 检查它是否在 `trained_voices` 列表
2. 看 sidecar 日志：`ssh "$LUVU_WORKSTATION" 'powershell -NoProfile -Command "Get-Content C:\LUVU-sidecar\qwen-tts-server\sidecar.log -Tail 20"'`
3. 重启 sidecar 强制重 load：`ssh ... 'Restart-Service LUVUSidecar'`

（`LUVU_WORKSTATION` 是 env 变量，格式 `user@host`，按你自己 workstation 配置）
