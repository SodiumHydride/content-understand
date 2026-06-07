# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for content-understand sidecar.

Bundles sidecar/server.py + content_understand/ + engine/ + all pip deps
into a single executable.

Usage:
    pyinstaller sidecar.spec --noconfirm --distpath sidecar-dist

Output: sidecar-dist/sidecar (or sidecar.exe on Windows)
"""

import os
import sys
from pathlib import Path

block_cipher = None
root = os.path.abspath('.')

a = Analysis(
    [os.path.join(root, 'sidecar', 'server.py')],
    pathex=[root],
    binaries=[],
    datas=[
        # Bundle content_understand package
        (os.path.join(root, 'content_understand'), 'content_understand'),
        # Bundle engine package
        (os.path.join(root, 'engine'), 'engine'),
        # Bundle presets
        (os.path.join(root, 'engine', 'runtime', 'presets.json'), os.path.join('engine', 'runtime')),
    ],
    hiddenimports=[
        'uvicorn',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'fastapi',
        'pydantic',
        'requests',
        'tenacity',
        'yt_dlp',
        'trafilatura',
        'fitz',  # PyMuPDF
        'huggingface_hub',
        'psutil',
        'engine.runtime.presets',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'matplotlib',
        'scipy',
        'numpy',
        'pandas',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='sidecar',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,  # Keep console for logging
    disable_windowed_traceback=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='sidecar',
)
