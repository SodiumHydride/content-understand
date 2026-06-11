"""Per-job Janus queues for SSE streaming progress events."""

from __future__ import annotations

import janus
import logging

logger = logging.getLogger(__name__)

_queues: dict[str, janus.Queue] = {}


def create_job_queue(job_id: str) -> janus.Queue:
    q: janus.Queue = janus.Queue()
    _queues[job_id] = q
    return q


def get_job_queue(job_id: str) -> janus.Queue | None:
    return _queues.get(job_id)


def remove_job_queue(job_id: str) -> None:
    q = _queues.pop(job_id, None)
    if q is not None:
        try:
            q.shutdown(immediate=True)
        except Exception:
            logger.debug("Queue shutdown failed for job %s (may already be closed)", job_id)


def shutdown_all() -> None:
    """Shut down all active queues and clear the registry."""
    for q in _queues.values():
        try:
            q.shutdown(immediate=True)
        except Exception:
            logger.debug("Queue shutdown failed during cleanup (may already be closed)")
    _queues.clear()


def emit_progress(job_id: str, event: str, data: str) -> None:
    q = _queues.get(job_id)
    if q is None:
        return
    try:
        q.sync_q.put_nowait({"event": event, "data": data})
    except Exception:
        logger.debug("emit_progress failed for job %s (queue may be shut down)", job_id)


def emit_done(job_id: str) -> None:
    q = _queues.get(job_id)
    if q is None:
        return
    try:
        q.sync_q.put_nowait(None)
    except Exception:
        logger.debug("emit_done failed for job %s (queue may be shut down)", job_id)
