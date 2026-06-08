from __future__ import annotations

import logging
import os
import platform
import signal
import subprocess
import time

logger = logging.getLogger(__name__)

_IS_WINDOWS = platform.system() == "Windows"


def find_process_on_port(port: int) -> int | None:
    """Find PID of process listening on given port.

    Returns None if no process found or on error.
    """
    try:
        if _IS_WINDOWS:
            result = subprocess.run(
                ["netstat", "-ano"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            for line in result.stdout.splitlines():
                parts = line.split()
                if len(parts) >= 5 and parts[0] == "TCP" and parts[3] == "LISTENING":
                    # Format: TCP  0.0.0.0:PORT  0.0.0.0:0  LISTENING  PID
                    local = parts[1]
                    if local.endswith(f":{port}"):
                        return int(parts[4])
        else:
            # -sTCP:LISTEN ensures we only get the process LISTENING on the port,
            # not processes with established connections TO the port
            result = subprocess.run(
                ["lsof", "-i", f":{port}", "-sTCP:LISTEN", "-t"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.stdout.strip():
                return int(result.stdout.strip().splitlines()[0])
    except Exception as e:
        logger.debug("find_process_on_port(%d) failed: %s", port, e)
    return None


def kill_process_by_pid(pid: int, timeout: float = 3.0) -> bool:
    """Kill a process by PID. Returns True if successfully killed."""
    try:
        if _IS_WINDOWS:
            # TerminateProcess via taskkill
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                capture_output=True,
                timeout=int(timeout),
            )
            # Verify it's gone
            return not is_pid_alive(pid)
        else:
            # Phase 1: SIGTERM
            os.kill(pid, signal.SIGTERM)
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                if not is_pid_alive(pid):
                    return True
                time.sleep(0.1)

            # Phase 2: SIGKILL
            logger.debug("SIGTERM timed out for PID %d, sending SIGKILL", pid)
            os.kill(pid, signal.SIGKILL)
            # SIGKILL is immediate on most systems, but give the kernel a moment
            # to clean up the process (especially if it was doing heavy I/O)
            for _ in range(10):
                time.sleep(0.1)
                if not is_pid_alive(pid):
                    return True
            return False
    except Exception as e:
        logger.debug("kill_process_by_pid(%d) failed: %s", pid, e)
        return False


def cleanup_stale_port(port: int) -> bool:
    """Try to free a port by finding and killing the process on it.

    Returns True if port was freed, False otherwise.
    """
    pid = find_process_on_port(port)
    if pid is None:
        logger.debug("No process found on port %d", port)
        return True  # Port is already free

    logger.info("Found PID %d on port %d, killing...", pid, port)
    if kill_process_by_pid(pid):
        # Verify port is actually free now
        if find_process_on_port(port) is None:
            logger.info("Port %d freed successfully", port)
            return True
    logger.warning("Failed to free port %d", port)
    return False


def write_pid_file(path: str) -> None:
    """Write current process PID to file."""
    try:
        with open(path, "w") as f:
            f.write(str(os.getpid()))
        logger.debug("Wrote PID %d to %s", os.getpid(), path)
    except Exception as e:
        logger.debug("write_pid_file(%s) failed: %s", path, e)


def read_pid_file(path: str) -> int | None:
    """Read PID from file. Returns None if file doesn't exist or is invalid."""
    try:
        with open(path) as f:
            return int(f.read().strip())
    except Exception:
        return None


def is_pid_alive(pid: int) -> bool:
    """Check if a process with given PID exists."""
    try:
        if _IS_WINDOWS:
            result = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            return str(pid) in result.stdout
        else:
            os.kill(pid, 0)
            return True
    except ProcessLookupError:
        return False
    except PermissionError:
        # Process exists but we lack permission to signal it
        return True
    except Exception:
        return False


def cleanup_stale_pid_file(path: str) -> bool:
    """Read PID file, check if process is alive.

    If dead, remove file and return True (cleaned up).
    If alive or file missing, return False.
    """
    pid = read_pid_file(path)
    if pid is None:
        return False

    if is_pid_alive(pid):
        logger.debug("PID %d from %s is still alive", pid, path)
        return False

    logger.info("Removing stale PID file %s (PID %d)", path, pid)
    try:
        os.remove(path)
    except Exception as e:
        logger.debug("Failed to remove PID file %s: %s", path, e)
    return True
