"""Tests for ContentPipeline routing and content type detection."""

import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch
from content_understand.pipeline import ContentPipeline, _detect_content_type
from content_understand.config import ContentConfig, BackendConfig


class TestContentTypeDetection:
    """Test the _detect_content_type function."""

    def test_video_extensions(self):
        for ext in [".mp4", ".mkv", ".avi", ".mov", ".webm"]:
            assert _detect_content_type(f"video{ext}") == "video", f"Failed for {ext}"

    def test_image_extensions(self):
        for ext in [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]:
            assert _detect_content_type(f"image{ext}") == "image", f"Failed for {ext}"

    def test_audio_extensions(self):
        for ext in [".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac"]:
            assert _detect_content_type(f"audio{ext}") == "audio", f"Failed for {ext}"

    def test_article_extensions(self):
        for ext in [".html", ".htm", ".pdf", ".txt"]:
            assert _detect_content_type(f"article{ext}") == "article", f"Failed for {ext}"

    def test_unknown_returns_unknown(self):
        assert _detect_content_type("file.xyz") == "unknown"


class TestPipelineCreation:
    """Test ContentPipeline initialization."""

    def test_create_with_config(self):
        bc = BackendConfig(type="openai_compat", api_base="http://localhost:11434/v1")
        cfg = ContentConfig(backends={"openai_compat": bc})
        pipeline = ContentPipeline(cfg)
        assert pipeline is not None

    def test_create_with_empty_config(self):
        cfg = ContentConfig()
        pipeline = ContentPipeline(cfg)
        assert pipeline is not None


class TestPipelineResolverChain:
    """Test that the resolver chain is properly built."""

    def test_resolver_chain_has_local_resolver(self):
        cfg = ContentConfig()
        pipeline = ContentPipeline(cfg)
        # The chain should at minimum have LocalFileResolver and DirectURLResolver
        assert len(pipeline.resolver_chain.resolvers) >= 2


class TestSplitTranscript:
    """Test the transcript splitting function for chunked video processing."""

    def test_basic_split(self):
        from content_understand.pipeline import _split_transcript_at_boundaries
        transcript = "First sentence. Second sentence. Third sentence. Fourth sentence."
        chunks = _split_transcript_at_boundaries(transcript, 2)
        assert len(chunks) == 2
        assert all(len(c.strip()) > 0 for c in chunks)

    def test_single_chunk(self):
        from content_understand.pipeline import _split_transcript_at_boundaries
        transcript = "Short text."
        chunks = _split_transcript_at_boundaries(transcript, 1)
        assert len(chunks) == 1
        assert chunks[0] == transcript

    def test_empty_transcript(self):
        from content_understand.pipeline import _split_transcript_at_boundaries
        chunks = _split_transcript_at_boundaries("", 3)
        assert len(chunks) == 1
        assert chunks[0] == ""

    def test_more_chunks_than_sentences(self):
        from content_understand.pipeline import _split_transcript_at_boundaries
        transcript = "One. Two."
        chunks = _split_transcript_at_boundaries(transcript, 5)
        # Should not create more chunks than there are sentences
        assert len(chunks) <= 5
