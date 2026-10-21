---
name: openvideo-agent
description: 根据一份文案 + 截图（spec.json）自动生成软件产品的安装介绍 / 功能宣传视频：竖版 1080×1920 和横版 1920×1080，中英双语标题、终端动画、截图高亮、背景音乐（模板库）、音效卡拍、中文人声旁白与烧录字幕。用户说"做个产品视频""安装介绍视频""宣传片""用截图做视频""加人声 / 字幕""竖版横版"时使用。
---

# openvideo-agent

一份 `spec.json`（文案 + 素材路径）→ `generate.mjs` → 两个完整视频工程 → 成片 `renders/final-narrated-sub.mp4`。
`<skill>` 指本目录。本 skill 自包含（`engine/` 引擎、`scripts/` 混音与交付检查、`templates/` 视图与配乐）。

## 开工前问一次（一条消息问完）

1. 视频要讲的**流程顺序**。用户给了就照做，不要自己增删步骤。
2. 要展示哪些**平台**（Windows / macOS / Linux）。
3. **不能出现的信息**：未公开的仓库地址、账号、域名、水印 → 写进 spec 的 `privacy_terms`。
4. 有没有**截图**（放进 spec 同目录，用相对路径引用）。

其余用默认：30 fps、中文旁白、约 50 秒、浅色产品舞台 + 深色终端交替、竖版 + 横版都出。

## 素材来源（只用这些，不编造）

- `README.md`：步骤、命令、功能说明。
- 产品可执行文件的 `--help`：命令的准确写法。
- 用户给的截图：当真实界面用，只加高亮环、不改内容。没有截图的界面（如二维码）是示意图，交付时要说明。

## 流程

1. 写 `spec.json`（格式见 README，完整例子见 `examples/spec.example.json`）。
2. `node <skill>/generate.mjs spec.json -o <out>`：生成 `<out>/vertical`、`<out>/landscape` 两个工程（只看效果可先不加 `--run`）。
3. `node <skill>/generate.mjs spec.json -o <out> --run`：安装依赖（首次）、构建、首帧海报、混音、渲染、交付检查、隐私扫描、旁白与字幕。约 3–5 分钟 / 版。
4. 审画面：`node capture-stills.mjs evidence/stills 3 11 17 ...`（在工程目录里），再 `node <skill>/scripts/contact-sheet.mjs evidence/stills evidence/sheet.png`，用 Read 看拼图；成片用 `contact-sheet.mjs --video renders/final-narrated-sub.mp4 out.png 14 28 41`。
5. 改文案 / 素材：改 spec 后重新 `generate.mjs ... --run`；同一个 `-o` 目录会原地更新，保留 `node_modules`。

## spec 速查

镜头 `kind`：`title`（开场，必须是第一个）、`cards`（平台 / 功能卡片）、`terminal`（终端，可带 `qr` 二维码和 `phone` 手机截图）、`screenshot`（浏览器或手机截图 + 高亮环）、`end`（收尾，必须是最后一个）。
每个镜头必填：`id`、`kind`、`seconds`（偶数，≥4）、`headlineEn`、`headline`、`description`、`narration`。

规则：
- 镜头时长必须是**偶数秒**（配乐 120 BPM，一小节 2 秒，切镜落在小节线上）。
- 旁白要在镜头内说完：4 秒约 14 字，6 秒约 20 字，10 秒约 34 字；超出会有 warning。
- 说明文字控制在 30 字内；中文标题里少放长英文。
- 终端行以 `> ` 开头表示选中项（蓝色 ❯），`ok ` 开头表示完成行（绿色 ✓），`# ` 开头表示灰色说明。
- 旁白文本会发到微软在线 TTS，只写产品文案，不写账号、仓库地址；`privacy_terms` 命中会直接报错。

## 配乐

`templates/music/` 是配乐模板库，spec 里 `"music": "<风格>"` 选择（清单见该目录 `README.md`）：`soft-marimba`（默认，有旁白时最合适）、`douyin-bounce`（抖音卡点）、`ode-to-joy`（贝多芬《欢乐颂》）。新风格存成新文件并登记 README。音乐脚本统一读 `plan.json` 的时长，不要写死。

## 交付时说清楚

- 自动检查（有音轨、时长与尺寸、音效点位在节拍上）通过 ≠ 好听；声音、字幕要自己听、看一遍。
- 哪些画面是真实截图，哪些是示意（二维码、占位图）。
- 没覆盖的平台和功能（spec 的 `notCovered`）。
- 人声是 TTS 合成，不是真人录音。
- 混音只做归一化（-16 LUFS）再降 5 dB，没有压低配乐；音量用 `FINAL_GAIN_DB=-3 bash scripts/pipeline.sh <dir>` 调整。

## 已踩过的坑

| 现象 | 原因 / 解法 |
|---|---|
| 中文显示乱码 | 脚本统一按 UTF-8 读写，无需额外设置 |
| 开场全空白 / 首帧空底色 | 需要 `public/poster.png`；`--run` 会自动重拍。手动改开场后要重拍再 build |
| 终端命令超出窗口 | 等宽字体下每行约 50 个字符，缩短命令或拆行 |
| 某镜头 “nearly still” | `screenshot` 镜头已带缓推；`terminal` 镜头多放几个 pane |
| 竖版字幕被切 | 字幕是 ASS，PlayRes 与视频同尺寸，不要改回 SRT |
| 配乐后段没声音 | 配乐时长读 plan.json；改了镜头时长要重新生成配乐 |
| 改 `DUR` 把脚本清空 | 不要先 `open(f,'w')` 再读同一文件 |
