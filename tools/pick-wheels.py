"""pick-wheels.py — 为 pip 离线安装挑选 wheel URL（配套 curl 下载）

背景：本机 OpenSSL 客户端（node / python 的 TLS 栈）对部分镜像的传输不稳定
（`[SSL] record layer failure` / `ERR_SSL_CIPHER_OPERATION_FAILED`），
但 curl（Windows schannel）稳定 ⇒ 采用「curl 下 wheel → pip --no-index 本地安装」离线路线。

用法：
  1. bash 里用 curl 拉各包 simple 页到 .tmp-probe/pypi-pages/<pkg>.html
  2. /d/Miniconda/python.exe .tmp-probe/pick-wheels.py > .tmp-probe/wheel-urls.txt
  3. 按清单 curl 下载到 .tmp-probe/wheels/ → pip install --no-index --find-links .tmp-probe/wheels <pkgs>

挑选规则（CPython 3.13 / win_amd64）：
  - 文件名含 win_amd64 且（含 cp313 或含 abi3）→ 适用
  - 文件名含 none-any（纯 Python 包）→ 适用
  - 其余（其它 Python 版本 / 其它平台）→ 排除
  - 同包多版本：取版本号最大者
"""
import glob
import os
import re


def version_key(filename: str):
    m = re.search(r"-(\d+(?:\.\d+)*)", filename)
    return tuple(int(x) for x in m.group(1).split(".")) if m else (0,)


def pick(html: str):
    links = re.findall(r'href="([^"#]+)', html)
    cands = []
    for link in links:
        if not link.endswith(".whl"):
            continue
        name = link.rsplit("/", 1)[-1]
        if "win_amd64" in name and ("cp313" in name or "abi3" in name):
            cands.append((version_key(name), name, link))
        elif "none-any" in name:
            cands.append((version_key(name), name, link))
    if not cands:
        return None
    cands.sort()
    return cands[-1][2]


def main() -> None:
    for path in sorted(glob.glob(".tmp-probe/pypi-pages/*.html")):
        pkg = os.path.basename(path)[:-5]
        html = open(path, encoding="utf-8", errors="replace").read()
        url = pick(html)
        print(url if url else f"# MISSING {pkg}")


if __name__ == "__main__":
    main()
