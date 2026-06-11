"""Tests for auto-link recommendations (BM25-based)."""

import json
import pytest
from engine.index.auto_link import get_recommendations
from engine.index.db import upsert_page, upsert_tags_for_page, upsert_link


class TestGetRecommendations:
    """Test the BM25-based recommendation engine."""

    def test_basic_recommendations(self, db_conn, sample_pages):
        recs = get_recommendations(db_conn, "video/python-tutorial", limit=3)
        assert isinstance(recs, list)
        assert len(recs) <= 3

    def test_excludes_self(self, db_conn, sample_pages):
        recs = get_recommendations(db_conn, "video/python-tutorial", limit=10)
        slugs = [r["slug"] for r in recs]
        assert "video/python-tutorial" not in slugs

    def test_excludes_already_linked(self, db_conn, sample_pages):
        """video/python-tutorial is linked to article/machine-learning-intro."""
        recs = get_recommendations(db_conn, "video/python-tutorial", limit=10)
        slugs = [r["slug"] for r in recs]
        assert "article/machine-learning-intro" not in slugs

    def test_returns_score_and_reason(self, db_conn, sample_pages):
        recs = get_recommendations(db_conn, "video/python-tutorial", limit=5)
        for rec in recs:
            assert "slug" in rec
            assert "title" in rec
            assert "score" in rec
            assert "reason" in rec
            assert rec["score"] >= 0

    def test_empty_vault(self, db_conn):
        recs = get_recommendations(db_conn, "nonexistent", limit=5)
        assert recs == []

    def test_nonexistent_slug(self, db_conn, sample_pages):
        recs = get_recommendations(db_conn, "nonexistent/slug", limit=5)
        assert recs == []

    def test_limit_respected(self, db_conn, sample_pages):
        recs = get_recommendations(db_conn, "video/python-tutorial", limit=1)
        assert len(recs) <= 1
