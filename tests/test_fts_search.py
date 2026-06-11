"""Tests for FTS5 search functionality."""

import json
import pytest
from engine.index.db import sanitize_fts5, fts_search, fts_rebuild, upsert_page, upsert_tags_for_page
from engine.index.search import parse_query, advanced_search, _build_fts_match


@pytest.fixture
def indexed_pages(db_conn, sample_pages):
    """Ensure FTS index is built from sample_pages (content-sync FTS5 has no triggers)."""
    fts_rebuild(db_conn)
    return sample_pages


# -- sanitize_fts5 -----------------------------------------------------------


class TestSanitizeFts5:
    def test_basic_text(self):
        assert sanitize_fts5("hello world") == '"hello world"'

    def test_special_chars(self):
        result = sanitize_fts5("C++ programming")
        assert result == '"C++ programming"'

    def test_parentheses(self):
        result = sanitize_fts5("function(args)")
        assert result == '"function(args)"'

    def test_operators(self):
        result = sanitize_fts5("OR AND NOT NEAR")
        assert result == '"OR AND NOT NEAR"'

    def test_embedded_quotes(self):
        result = sanitize_fts5('say "hello"')
        assert result == '"say ""hello"""'

    def test_null_bytes(self):
        result = sanitize_fts5("hello\x00world")
        assert "\x00" not in result

    def test_empty_string(self):
        result = sanitize_fts5("")
        assert result == '""'


# -- _build_fts_match --------------------------------------------------------


class TestBuildFtsMatch:
    def test_free_text_only(self):
        expr, params = _build_fts_match("python tutorial", [])
        assert len(params) == 1
        assert "python" in expr.lower() or "tutorial" in expr.lower()

    def test_exact_phrase_only(self):
        expr, params = _build_fts_match("", ["exact phrase"])
        assert len(params) == 1
        assert "exact phrase" in expr

    def test_combined(self):
        """This was a bug — multiple params for single MATCH placeholder."""
        expr, params = _build_fts_match("free text", ["exact phrase"])
        assert len(params) == 1, f"Expected 1 param, got {len(params)}"

    def test_multiple_phrases(self):
        expr, params = _build_fts_match("", ["phrase one", "phrase two"])
        assert len(params) == 1

    def test_empty(self):
        expr, params = _build_fts_match("", [])
        assert expr == ""
        assert params == []


# -- parse_query -------------------------------------------------------------


class TestParseQuery:
    def test_plain_text(self):
        f = parse_query("hello world")
        assert f.free_text == "hello world"
        assert f.tags == []
        assert f.types == []

    def test_tag_filter(self):
        f = parse_query("tag:python")
        assert f.tags == ["python"]
        assert f.free_text == ""

    def test_type_filter(self):
        f = parse_query("type:video")
        assert f.types == ["video"]

    def test_combined(self):
        f = parse_query("tag:ai type:article neural networks")
        assert f.tags == ["ai"]
        assert f.types == ["article"]
        assert "neural networks" in f.free_text

    def test_quoted_phrase(self):
        f = parse_query('"exact phrase" tag:python')
        assert f.exact_phrases == ["exact phrase"]
        assert f.tags == ["python"]

    def test_orphan_filter(self):
        f = parse_query("orphan:true")
        assert f.orphan is True


# -- fts_search --------------------------------------------------------------


class TestFtsSearch:
    def test_basic_search(self, db_conn, indexed_pages):
        results = fts_search(db_conn, "Python")
        assert len(results) > 0
        titles = [r["title"] for r in results]
        assert any("Python" in t for t in titles)

    def test_no_results(self, db_conn, indexed_pages):
        results = fts_search(db_conn, "quantum physics xyz")
        assert isinstance(results, list)

    def test_special_chars_no_crash(self, db_conn, indexed_pages):
        """Verify C++ doesn't cause FTS5 syntax error."""
        results = fts_search(db_conn, "C++")
        assert isinstance(results, list)

    def test_operators_no_crash(self, db_conn, indexed_pages):
        """Verify OR/AND/NOT treated as literal text."""
        results = fts_search(db_conn, "OR AND NOT")
        assert isinstance(results, list)


# -- advanced_search ---------------------------------------------------------


class TestAdvancedSearch:
    def test_type_filter(self, db_conn, indexed_pages):
        results = advanced_search(db_conn, "type:video")
        assert all(r["type"] == "video" for r in results)

    def test_tag_filter(self, db_conn, indexed_pages):
        results = advanced_search(db_conn, "tag:python")
        assert len(results) >= 2  # video and article have python tag

    def test_text_with_type(self, db_conn, indexed_pages):
        results = advanced_search(db_conn, "type:article machine learning")
        assert len(results) >= 1
        assert results[0]["type"] == "article"

    def test_empty_query(self, db_conn, indexed_pages):
        results = advanced_search(db_conn, "")
        assert results == []
