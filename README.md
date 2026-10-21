# openvideo-agent

给软件产品自动生成**安装介绍 / 功能宣传视频**：一份文案 + 几张截图（`spec.json`），出竖版（1080×1920，抖音 / 视频号）和横版（1920×1080，B 站 / YouTube）两个成片，带中英双语标题、终端动画、截图高亮、背景音乐、音效卡拍、中文人声旁白和烧录字幕。

也是一个 [Claude Code](https://claude.com/claude-code) skill：克隆到 `~/.claude/skills/openvideo-agent`，对 Claude 说“用截图做个安装介绍视频”即可，`SKILL.md` 里有完整的工作流。

## 快速开始

依赖：Node 22+（在仓库根目录 `npm install`，安装 msedge-tts）、FFmpeg（含 libass）。Windows 需要 Git for Windows（提供 bash）。

```sh
node generate.mjs examples/spec.example.json -o out          # 只生成工程
node generate.mjs examples/spec.example.json -o out --run    # 生成 + 构建 + 渲染 + 配乐 + 旁白字幕
```

成片：`out/vertical/renders/final-narrated-sub.mp4` 和 `out/landscape/renders/final-narrated-sub.mp4`。
`--aspect vertical|landscape` 只出一种。再次运行同一个 `-o` 会原地更新，保留 `node_modules`。

## spec.json

```jsonc
{
  "name": "demo",
  "product": "示例应用 命令行安装",
  "voice": "zh-CN-XiaoxiaoNeural",   // Edge TTS 声音
  "rate": "+5%",
  "music": "soft-marimba",           // templates/music/ 里的风格
  "music_gain": 0.5,
  "privacy_terms": ["内部域名"],       // 出现在 spec 里会直接报错，也会扫描成片代码
  "notCovered": ["macOS 启动方式"],
  "shots": [ ... ]
}
```

每个镜头必填：`id`（小写字母数字连字符）、`kind`、`seconds`（偶数，≥4）、`headlineEn`、`headline`、`description`、`narration`。第一个镜头必须是 `title`，最后一个必须是 `end`。

| kind | 画面 | 专有字段 |
| --- | --- | --- |
| `title` | 开场：标题 + 说明 + 示例通知卡片 | `notice: {title, tag, body}` |
| `cards` | 平台 / 功能卡片列表 | `tag`, `cards: [{title, sub, text, accent}]`, `note`（底部一行终端提示） |
| `terminal` | 终端窗口：命令逐字输入、多屏菜单、完成行，可选二维码和手机截图 | `tag`, `prompt`, `command`, `panes: [[行...], ...]`, `done`, `footer`, `qr: true`, `phone: {image, ring}` |
| `screenshot` | 浏览器或手机截图，缓推 + 高亮环 | `tag`, `image`, `frame: "browser"\|"phone"`, `url`, `ring: {x,y,w,h,color}` |
| `end` | 收尾：标题 + 命令标签 | `chips: [...]` |

- 终端行前缀：`> ` 选中项（蓝色 ❯）、`ok ` 完成行（绿色 ✓）、`# ` 灰色说明。
- 截图 / 手机图用相对 spec 的路径；`ring` 的 x/y/w/h 是占图片宽高的百分比，`color` 可写 `green` 或 `#rrggbb`。
- 音效（打字、完成、弹出、点击、收尾）按镜头动作自动卡在 0.5 秒节拍上。
- 完整例子：`examples/spec.example.json`（截图是占位图，换成你自己的）。

## 目录

```
generate.mjs         spec -> 视频工程（-> 成片）
engine/             构建、渲染、截图引擎（Node）
templates/          数据驱动的镜头视图、竖/横版样式、配乐模板库（templates/music/）
scripts/            混音、交付检查、人声与字幕、拼图、一键流水线
examples/           示例 spec 与占位截图
SKILL.md            Claude Code skill 说明
```

## 渲染并行

`engine/render-film.mjs` 默认用 1 个浏览器页面逐帧截图，输出逐字节可重复。加 `--jobs N` 可以用 N 个页面并行截图（每个页面是独立的 Chromium 进程，Node 主线程只负责调度，不需要 worker_threads）：

- 8 核 CPU 上 26 秒片段的实测：1 页面 42 秒，4 页面 27 秒（约 1.6 倍）。
- 代价：并行结果和单页结果可能有亚像素级的差异（实测 22 帧 PSNR 约 73–88 dB，肉眼难以分辨）。原因是影片里的 GSAP 时间线有部分状态依赖之前的 seek 路径，冷启动页面跳到中途的画面会略有不同。模板里已经把 `tl.to` 改为显式起点的 `fromTo`，但这一处仍需要进一步排查。
- 建议：预览和草稿用 `--jobs 4`；最终交付用默认的 1。

## 配乐模板库

`templates/music/`：`soft-marimba`（轻柔马林巴，默认，不抢人声）、`douyin-bounce`（抖音魔性卡点，切点有上升音效与重击）、`ode-to-joy`（贝多芬《欢乐颂》，公版曲目）。全部由代码合成（`audio-kit.mjs`，无第三方依赖），读 `plan.json` 的时长。新增风格：加一个同接口的 `.mjs` 并登记到 `templates/music/README.md`。

## 注意

- 旁白用 Edge TTS（msedge-tts），文本会发到微软在线 TTS 服务，只写产品文案。
- 混音是 ffmpeg：音乐 + 音效归一化到 -16 LUFS，成片默认再降 5 dB（`FINAL_GAIN_DB` 调整）；旁白混入时自动压低配乐。
- 二维码是示意图案，扫不出内容；没有提供截图的界面都是示意。
- 自动检查通过不代表好听好看，成片请自己看、听一遍。

## 许可与来源

本项目以 MIT 许可证发布，见 [LICENSE](LICENSE)。`engine/` 是构建、渲染与截图引擎（Node），由 `generate.mjs` 调用。
