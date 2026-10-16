"""
ref-opencv-yunet.py — 阶段 A「参照实现」脚本（**仅验证用，非运行时依赖**）

用途：用 OpenCV FaceDetectorYN 跑与 Node 探针（tools/probe-yunet.mts）同一张图、
      同一模型、同一参数，输出框 + 5 关键点 JSON，供逐框对齐（报告 §5.4 step 4）。

运行（隔离 venv）：
  C:/Users/63088/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/ref-opencv-yunet.py

对齐对照物：perceive-models/yunet-lena-result.json（Node 侧输出）
"""
import json

import cv2

MODEL = 'perceive-models/face_detection_yunet_2026may-official.onnx'
IMG = 'perceive-models/test-lena.jpg'
OUT = 'perceive-models/opencv-lena-result.json'

# 与 Node 探针一致的参数（opencv_zoo demo 默认）
SCORE_THRESHOLD = 0.9
NMS_THRESHOLD = 0.3
TOP_K = 5000

img = cv2.imread(IMG)  # BGR
h, w = img.shape[:2]
print(f'image {w}x{h}')

detector = cv2.FaceDetectorYN.create(MODEL, '', (w, h), SCORE_THRESHOLD, NMS_THRESHOLD, TOP_K)
_, faces = detector.detect(img)

# faces[i]: [x, y, w, h, re_x, re_y, le_x, le_y, nt_x, nt_y, rcm_x, rcm_y, lcm_x, lcm_y, score]
result = {
    'model': MODEL,
    'image': IMG,
    'imageSize': [w, h],
    'scoreThreshold': SCORE_THRESHOLD,
    'nmsThreshold': NMS_THRESHOLD,
    'count': 0 if faces is None else int(len(faces)),
    'faces': [],
}
if faces is not None:
    for f in faces:
        result['faces'].append(
            {
                'x1': float(f[0]),
                'y1': float(f[1]),
                'w': float(f[2]),
                'h': float(f[3]),
                'score': float(f[14]),
                'kps': [float(v) for v in f[4:14]],
            }
        )

with open(OUT, 'w', encoding='utf-8') as fp:
    json.dump(result, fp, indent=2, ensure_ascii=False)

print('faces:', result['count'])
for f in result['faces']:
    print(' ', f)
print('→', OUT)
