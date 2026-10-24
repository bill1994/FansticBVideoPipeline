# SDD ledger — plan: 会话内计划「第一梯队」（2026-10-24，用户四项裁决后拟定）

分支 codex/t1-calibration。任务：T1 density 降级 warning / T2 reweigh-coverage-min 考古 / T3 #17 分档升 error / T4 救 real30 / T5 数据定线。

Pre-flight: T1 与 T3 都动 validate 层，串行执行；T2 只读随时插队；T4 阻塞 T5。
Task 1: complete (d98d2a2..bf7c9ec, tests: npm test -> 732/732 pass; typecheck exit 0; placeholders --check OK)
Task 2: complete (bf7c9ec..df892a6, tests: vitest placeholders -> 12/12 pass; 考古只读 + 文档)
Task 3: complete (df892a6..144c5a4, tests: npm test -> 737/737 pass; typecheck exit 0)
Final review: self-review (no subagent tool — Agent dispatch blocked twice by platform). Checks: no code consumers assume single #17 code (grep clean); isErrorCode reads spec.level; DOCUMENTED_CHECK_ITEMS=18 baseline green; determinism untouched (mk() unchanged, no clock/random); docs synced across SKILL x2 / SPEC / PROGRESS / wiki x2 / changelog; tier arithmetic verified in tests (22/21字, 53/41字, 1.15-1.5x band, D-B2 no-false-positive).
Task 4: BLOCKED (external) — real30 素材（视频+SRT）不在本机（jobs/* gitignore，全仓仅 examples/demo 占位输入）。环境侧已备齐：winget ffmpeg 0字节 shim 修复（Links 覆盖真实 exe 9.0.2）、doctor fail 0、whisper small 模型后台下载中。素材到位后：jobs/real30/00-input 放 raw.mp4+SRT -> npm run pipeline -- align --job real30（如 EBUSY 则手工抽 wav）。Task 5: BLOCKED by Task 4。
Task 4 appendix: whisper ggml-small.bin 下载完成（465MB，kukini 同款模型），doctor 7 项全绿 fail 0 / warn 0。素材到位即可直接跑 align。
P1-a merge: rebase 零冲突 -> 756/45 全绿 -> ff 合并 main -> review --dry-run 烟测通过 -> demo 06-review 夹具补齐。
