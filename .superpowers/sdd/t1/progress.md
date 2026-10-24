# SDD ledger — plan: 会话内计划「第一梯队」（2026-10-24，用户四项裁决后拟定）

分支 codex/t1-calibration。任务：T1 density 降级 warning / T2 reweigh-coverage-min 考古 / T3 #17 分档升 error / T4 救 real30 / T5 数据定线。

Pre-flight: T1 与 T3 都动 validate 层，串行执行；T2 只读随时插队；T4 阻塞 T5。
Task 1: complete (d98d2a2..bf7c9ec, tests: npm test -> 732/732 pass; typecheck exit 0; placeholders --check OK)
Task 2: complete (bf7c9ec..df892a6, tests: vitest placeholders -> 12/12 pass; 考古只读 + 文档)
Task 3: complete (df892a6..144c5a4, tests: npm test -> 737/737 pass; typecheck exit 0)
