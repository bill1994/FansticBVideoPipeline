# 新机器准备（SETUP）

> **这份文档解决一件事：换一台电脑，从零到能跑。**
> 它不解释管线做什么（看 `README.md`），只回答「缺什么、怎么装、怎么确认装好了」。
>
> 对应计划书 **D7.4**。2026-10-18 在第二台机器上实际走了一遍，本文是那次的实际步骤。

---

## 0. 最短路径

```bash
git clone <repo> && cd VideoPipeline
npm install
npm run doctor                                  # 先看缺什么（不应有 fail）
node --experimental-strip-types tools/setup-whisper.mts base
npm run doctor                                  # 再确认一次
```

`doctor` 通过后，**不需要真实素材**就能跑通端到端 demo（见 §5）。

---

## 1. Node.js

要求 **22.19+ 或 24+**（Remotion 官方硬要求，低版本会在渲染期炸）。

```bash
node -v
```

---

## 2. 依赖

```bash
npm install
```

Remotion 锁在 `4.0.534`（`--save-exact`，**禁 `^`**）。
它每 2–3 天发一版，用 `^` 必然漂移。

---

## 3. ffmpeg

`align` 抽音轨、`perceive` 抽帧与镜头切分都依赖它。**必须能被 PATH 找到**（代码里 `spawnSync('ffmpeg')`）。

**Windows**

```powershell
winget install --id Gyan.FFmpeg -e
```

装完 **重开终端**。winget 改的是用户环境变量，当前已开的进程读不到 —— 这是最容易误判成"装了但没用"的一步。

也可用 `choco install ffmpeg`，或手工解压后把 `bin` 加进 PATH。

**macOS / Linux**

```bash
brew install ffmpeg        # macOS
sudo apt install ffmpeg    # Debian/Ubuntu
```

验证：

```bash
ffmpeg -version
ffprobe -version
```

> ⚠️ 历史坑：某些安装方式下 Node 的 `spawnSync('ffmpeg')` 会报 `EBUSY`（bash 里却正常）。
> 那是特定安装方式的问题，**不是项目 bug**；换 gyan.dev 的构建后未复现。
> 兜底：手工 `ffmpeg -y -i raw.mp4 -vn -ac 1 -ar 16000 -f wav audio.wav` 后再跑后续阶段。

---

## 4. whisper.cpp 与模型

```bash
node --experimental-strip-types tools/setup-whisper.mts [base|small|...]
```

- 装到 `<仓库根>/whisper.cpp`，**不需要 cmake / Python**（Windows 走预编译二进制）。
- 模型从 huggingface 下，失败会自动切 `hf-mirror`。
- 下载走 `curl -C -` **断点续传**：半途断掉不会从头再来。

**🔴 模型名有两个默认值，必须对齐**

| 位置 | 默认 | 说明 |
|---|---|---|
| `tools/setup-whisper.mts` | `base`（148MB） | 安装脚本的默认参数 |
| `src/stages/builtin-align.ts` | `small`（488MB） | **运行时**读取的默认模型 |

也就是说：用默认命令装了 `base`，跑 `align` 时会找不到 `ggml-small.bin`。
二选一：

```bash
# A. 装 small（与运行时默认一致，质量更好）
node --experimental-strip-types tools/setup-whisper.mts small

# B. 保留 base，显式告诉运行时
export WHISPER_MODEL=base          # Git Bash
$env:WHISPER_MODEL = "base"        # PowerShell
```

> `npm run doctor` 会检查这一项，不一致时报 ⚠️。

**放在别处**：设 `WHISPER_CPP_PATH` 指向含二进制与 `ggml-*.bin` 的目录。
二进制名按版本不同（`main.exe` / `whisper-cli.exe`），doctor 两个都认。

---

## 5. perceive 模型（可选）

`02-perceive` 的 `face` 通道用 YuNet（`onnxruntime-node`）。
模型放在 `perceive-models/`（**已 gitignore**，换机需重下），或用 `PERCEIVE_MODEL` 指定路径。

缺它**不会阻断全流程**：无脸镜头走 `broll` 显著性通道（零模型）。
doctor 只报 ⚠️ 不报 ❌。

---

## 6. 环境变量

全部可选，样例见 **`.env.example`**。⚠️ 项目**不加载 `.env` 文件**（没有 dotenv 依赖），
变量要由 shell 注入。

| 变量 | 作用 | 默认 |
|---|---|---|
| `WHISPER_CPP_PATH` | whisper.cpp 目录 | `<仓库根>/whisper.cpp` |
| `WHISPER_MODEL` | 模型名 | `small` |
| `ALIGNER_CMD` | 外部对齐器（配了就盖过内置） | — |
| `PERCEIVER_CMD` | 外部感知器（配了就盖过内置） | — |
| `PERCEIVE_MODEL` | YuNet onnx 路径 | `perceive-models/…official.onnx` |
| `PERCEIVE_DEBUG` | `1` 打印 ffmpeg 抽帧调试 | — |

---

## 7. 验证

**① 自检**

```bash
npm run doctor
```

7 项检查，全部 ✅ 才算就绪（⚠️ 可接受，❌ 必须处理）。每条 ❌ 后面都跟着 `↳` 的具体做法。

**② 单测**

```bash
npm run typecheck && npm test
```

**③ 端到端 demo（无需真实素材）**

```bash
npm run pipeline -- storyboard --job demo --jobs-dir examples
npm run pipeline -- validate   --job demo --jobs-dir examples
npm run pipeline -- render     --job demo --jobs-dir examples --dry-run
```

`validate` 的预期输出：`checked=18 项 + 2 条起草原生约束, warning=2`（两条都是 `W-F6-01`）。
⚠️ 这个预期**只在用仓库里已有的 `examples/demo` 快照时成立**；重跑 `storyboard` 会重算烘焙，结果可能不同（见 `PROGRESS.md` 的雷区）。

---

## 8. 真素材全流程

```bash
npm run pipeline -- init       --job my-job
# 把视频与 SRT 放进 jobs/my-job/00-input/，填好 source.json（video / srt / fps / durationInFrames）
npm run pipeline -- align      --job my-job      # whisper small：约 14 分钟
npm run pipeline -- perceive   --job my-job
npm run pipeline -- storyboard --job my-job
npm run pipeline -- validate   --job my-job
npm run pipeline -- render     --job my-job      # 6667 帧 1080p60：约 20–22 分钟
```

---

## 9. 已知坑（按踩到的频率排序）

| 坑 | 现象 | 做法 |
|---|---|---|
| **阶段目录是不可变快照** | 改了对齐/感知代码，重跑却「沿用」旧产物，白等十几分钟 | 加 `--force` |
| **长任务管道接 `tail`** | 渲染失败时只剩「渲染失败」四个字，错误被吞 | 重定向到日志文件再 `grep`，别用 `\| tail` |
| **PATH 改了但没生效** | 刚装的 ffmpeg 仍报 command not found | 重开终端；winget 只改环境变量 |
| **whisper 模型名不匹配** | `align` 报找不到 `ggml-xxx.bin` | 见 §4，`WHISPER_MODEL` 对齐 |
| **下载中断重头来** | 141MB 的模型下到 38MB 超时，重试从 0 开始 | 用 `curl -C -`（setup 脚本已内置） |
| **渲染全黑但不报错** | 视频「挂载失败」与「素材开头本来就黑」看起来一样 | 抽单像素判断：容器底 `0,0,0` / 占位底 `16,20,24` / 真实画面是别的值 |

---

## 10. 换机后还剩什么手工活

- `perceive-models/` 与 `whisper.cpp/` **都不入库**（体积大、可重下）⇒ 必须重下。
- `jobs/` 入库时只有 `.gitkeep` ⇒ 历史 job 不会跟过来，要么重跑，要么手工拷。
- 素材（mp4 / srt）本身也不入库（`.gitignore` 里有 `*.mp4` / `*.srt`）。
