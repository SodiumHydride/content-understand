"""Detect RAM / GPU for preset recommendation."""

from __future__ import annotations

import platform
import shutil
import subprocess
from dataclasses import asdict, dataclass


@dataclass
class HardwareProfile:
    os_name: str
    arch: str
    ram_gb: float
    vram_gb: float
    gpu_vendor: str  # apple | nvidia | amd | unknown | none
    gpu_name: str
    cpu_only: bool
    apple_unified_memory: bool

    def to_dict(self) -> dict:
        return asdict(self)


def probe_hardware() -> HardwareProfile:
    os_name = platform.system().lower()
    arch = platform.machine().lower()
    ram_gb = _ram_gb()

    vram_gb = 0.0
    gpu_vendor = "none"
    gpu_name = ""
    apple_unified = os_name == "darwin" and arch in ("arm64", "aarch64")

    if apple_unified:
        gpu_vendor = "apple"
        gpu_name = _mac_chip_name()
        vram_gb = ram_gb  # unified memory budget
    else:
        nvidia = _nvidia_vram()
        if nvidia[0] > 0:
            vram_gb, gpu_name = nvidia
            gpu_vendor = "nvidia"
        elif shutil.which("rocm-smi"):
            gpu_vendor = "amd"
            gpu_name = "amd (rocm detected)"
            amd_vram = _amd_vram()
            if amd_vram > 0:
                vram_gb = amd_vram

    cpu_only = gpu_vendor in ("none", "unknown") and vram_gb <= 0
    if apple_unified:
        cpu_only = False

    return HardwareProfile(
        os_name=os_name,
        arch=arch,
        ram_gb=ram_gb,
        vram_gb=vram_gb,
        gpu_vendor=gpu_vendor,
        gpu_name=gpu_name,
        cpu_only=cpu_only,
        apple_unified_memory=apple_unified,
    )


def _ram_gb() -> float:
    try:
        import psutil

        return psutil.virtual_memory().total / (1024**3)
    except ImportError:
        pass
    if platform.system() == "Darwin":
        try:
            out = subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True).strip()
            return int(out) / (1024**3)
        except Exception:
            pass
    if platform.system() == "Linux":
        try:
            with open("/proc/meminfo", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("MemTotal:"):
                        kb = int(line.split()[1])
                        return kb / (1024**2)
        except Exception:
            pass
    return 8.0


def _mac_chip_name() -> str:
    try:
        out = subprocess.check_output(
            ["sysctl", "-n", "machdep.cpu.brand_string"], text=True
        ).strip()
        return out or "Apple Silicon"
    except Exception:
        return "Apple Silicon"


def _nvidia_vram() -> tuple[float, str]:
    if not shutil.which("nvidia-smi"):
        return 0.0, ""
    try:
        out = subprocess.check_output(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total",
                "--format=csv,noheader,nounits",
            ],
            text=True,
            timeout=5,
        )
        line = out.strip().splitlines()[0]
        name, mem = [x.strip() for x in line.split(",", 1)]
        return float(mem) / 1024, name
    except Exception:
        return 0.0, ""


def _amd_vram() -> float:
    """Try to detect AMD VRAM via rocm-smi."""
    if not shutil.which("rocm-smi"):
        return 0.0
    try:
        out = subprocess.check_output(
            ["rocm-smi", "--showmeminfo", "vram"],
            text=True,
            timeout=5,
        )
        # Parse "Total Memory" line, format varies by rocm-smi version
        for line in out.splitlines():
            if "Total" in line and ("Memory" in line or "Mem" in line):
                # Extract number (could be in bytes, KB, MB, or GB)
                import re

                nums = re.findall(r"[\d.]+", line)
                if nums:
                    val = float(nums[0])
                    # If > 1000, assume bytes → convert to GB
                    if val > 1_000_000:
                        return val / (1024**3)
                    # If > 10, assume MB → convert to GB
                    if val > 10:
                        return val / 1024
                    # Assume GB
                    return val
    except Exception:
        pass
    return 0.0
