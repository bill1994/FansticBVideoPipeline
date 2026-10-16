"""
align-check-yunet.py — 阶段 A 逐框对齐对比（报告 §5.4 step 4 验收判据）

对比：
  - Node 侧输出   perceive-models/yunet-lena-result.json   （tools/probe-yunet.mts 产出）
  - OpenCV 参照   perceive-models/opencv-lena-result.json  （tools/ref-opencv-yunet.py 产出）

判据（报告口径）：「同一图内匹配框的中心/尺寸误差 ≤ 数像素、检出数一致（允许 ≤1 框抖动）」
本脚本取容差 TOL_PX = 5px（「数像素」的实现口径）。

运行（隔离 venv）：
  C:/Users/63088/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/align-check-yunet.py
"""
import json

NODE = 'perceive-models/yunet-lena-result.json'
REF = 'perceive-models/opencv-lena-result.json'
TOL_PX = 5.0

node = json.load(open(NODE, encoding='utf-8'))
ref = json.load(open(REF, encoding='utf-8'))
nf, rf = node['faces'], ref['faces']

print(f"Node 检出: {len(nf)} 框   |   OpenCV 参照: {len(rf)} 框")

# 按 score 降序配对（两实现均按分数输出，理论上同序）
nf = sorted(nf, key=lambda x: -x['score'])
rf = sorted(rf, key=lambda x: -x['score'])

ok = abs(len(nf) - len(rf)) <= 1 and len(nf) > 0
if len(nf) != len(rf):
    print(f"⚠️ 检出数不一致（差 {abs(len(nf) - len(rf))} 框）——按最小集配对比较")

for i in range(min(len(nf), len(rf))):
    a, b = nf[i], rf[i]
    dcx = (a['x1'] + a['w'] / 2) - (b['x1'] + b['w'] / 2)
    dcy = (a['y1'] + a['h'] / 2) - (b['y1'] + b['h'] / 2)
    dw = a['w'] - b['w']
    dh = a['h'] - b['h']
    ds = a['score'] - b['score']
    print(f"\n框#{i + 1}:")
    print(f"  Node   : x1={a['x1']:.2f} y1={a['y1']:.2f} w={a['w']:.2f} h={a['h']:.2f} score={a['score']:.4f}")
    print(f"  OpenCV : x1={b['x1']:.2f} y1={b['y1']:.2f} w={b['w']:.2f} h={b['h']:.2f} score={b['score']:.4f}")
    print(f"  差     : 中心=({dcx:+.2f},{dcy:+.2f})px  尺寸=(w{dw:+.2f}, h{dh:+.2f})px  score={ds:+.4f}")
    kp_max = 0.0
    for n in range(5):
        kx = a['kps'][2 * n] - b['kps'][2 * n]
        ky = a['kps'][2 * n + 1] - b['kps'][2 * n + 1]
        kp_max = max(kp_max, abs(kx), abs(ky))
        print(f"  kp{n + 1}   : ({kx:+.2f},{ky:+.2f})px")
    print(f"  → kp 最大偏差: {kp_max:.2f}px")
    if max(abs(dcx), abs(dcy), abs(dw), abs(dh), kp_max) > TOL_PX:
        ok = False

print()
if ok and len(nf) == len(rf):
    print(f"✅ PASS —— 检出数一致且逐框（含 5 关键点）误差 ≤ {TOL_PX:.0f}px")
elif ok:
    print(f"⚠️ 边缘 PASS —— 检出数差 ≤1 框且配对框误差 ≤ {TOL_PX:.0f}px（符合报告「允许 ≤1 框抖动」）")
else:
    print(f"❌ FAIL —— 存在超差（容差 {TOL_PX:.0f}px）或检出数不一致，需排查预处理/解码")
