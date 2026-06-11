"""Shared fixtures for content-understand tests."""

import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import MagicMock

import pytest


@pytest.fixture
def tmp_vault(tmp_path):
    """Create a temporary vault directory with .content-app structure."""
    vault = tmp_path / "vault"
    (vault / ".content-app").mkdir(parents=True)
    return vault


@pytest.fixture
def db_conn(tmp_vault):
    """Create an in-memory-like SQLite connection with the full schema."""
    from engine.index.db import open_db, close_db, _connections

    conn = open_db(tmp_vault)
    yield conn
    # Cleanup: close and remove from pool
    db_path = str(tmp_vault / ".content-app" / "index.db")
    _connections.pop(db_path, None)
    try:
        conn.close()
    except Exception:
        pass


@pytest.fixture
def sample_pages(db_conn):
    """Insert sample pages into the database for testing."""
    pages = [
        {
            "slug": "video/python-tutorial",
            "path": "video/python-tutorial.md",
            "title": "Python Tutorial for Beginners",
            "type": "video",
            "platform": "youtube",
            "url": "https://youtube.com/watch?v=abc123",
            "summary": "A comprehensive Python tutorial covering basics to advanced topics.",
            "tags": '["python", "programming", "tutorial"]',
            "body": "This video covers Python basics including variables, functions, classes, and decorators. "
                    "The instructor demonstrates how to build a web application using Flask.",
            "created": "2024-01-15T10:00:00",
            "updated": "2024-01-15T10:00:00",
            "body_hash": "abc123",
            "file_mtime": 1705312800.0,
        },
        {
            "slug": "article/machine-learning-intro",
            "path": "article/machine-learning-intro.md",
            "title": "Introduction to Machine Learning",
            "type": "article",
            "platform": "web",
            "url": "https://example.com/ml-intro",
            "summary": "An introduction to machine learning concepts and algorithms.",
            "tags": '["ai", "machine-learning", "python"]',
            "body": "Machine learning is a subset of artificial intelligence that focuses on building systems "
                    "that learn from data. Common algorithms include linear regression, decision trees, and neural networks.",
            "created": "2024-02-20T14:30:00",
            "updated": "2024-02-20T14:30:00",
            "body_hash": "def456",
            "file_mtime": 1708438200.0,
        },
        {
            "slug": "audio/podcast-ai-ethics",
            "path": "audio/podcast-ai-ethics.md",
            "title": "AI Ethics Podcast Discussion",
            "type": "audio",
            "platform": "local",
            "url": "",
            "summary": "A podcast discussing ethical considerations in AI development.",
            "tags": '["ai", "ethics", "podcast"]',
            "body": "In this episode, the hosts discuss the ethical implications of large language models, "
                    "including bias, privacy, and the impact on employment.",
            "created": "2024-03-10T09:00:00",
            "updated": "2024-03-10T09:00:00",
            "body_hash": "ghi789",
            "file_mtime": 1710058800.0,
        },
    ]

    from engine.index.db import upsert_page, upsert_tags_for_page, upsert_link

    for page in pages:
        upsert_page(db_conn, page)
        tags = page["tags"]
        import json
        upsert_tags_for_page(db_conn, page["slug"], json.loads(tags))

    # Add some links
    upsert_link(db_conn, "video/python-tutorial", "article/machine-learning-intro", "related")
    upsert_link(db_conn, "article/machine-learning-intro", "audio/podcast-ai-ethics", "mentioned")

    return pages


@pytest.fixture
def mock_backend_config():
    """Create a mock BackendConfig for model testing."""
    from engine.understand.config import BackendConfig
    return BackendConfig(
        type="openai_compat",
        api_base="http://localhost:11434/v1",
        api_keys=["test-key"],
        model="test-model",
        timeout=30,
    )


@pytest.fixture
def mock_content_config(mock_backend_config):
    """Create a mock ContentConfig for pipeline testing."""
    from engine.understand.config import ContentConfig
    return ContentConfig(
        backends={"openai_compat": mock_backend_config},
        video_backend="openai_compat",
        image_backend="openai_compat",
        audio_backend="openai_compat",
        article_backend="openai_compat",
        output_language="zh",
    )
