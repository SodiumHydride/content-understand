"""Tests for output formatting and markdown writing."""

import pytest
from pathlib import Path
from engine.write.markdown import write_result, build_wikilink_instruction


class TestBuildWikilinkInstruction:
    """Test wikilink instruction generation."""

    def test_with_titles_zh(self):
        titles = ["Python Tutorial", "Machine Learning", "AI Ethics"]
        result = build_wikilink_instruction(titles, lang="zh")
        assert result is not None
        assert len(result) > 0
        assert "[[" in result
        assert "wikilink" in result.lower() or "双链" in result

    def test_with_titles_en(self):
        titles = ["Python Tutorial", "Machine Learning"]
        result = build_wikilink_instruction(titles, lang="en")
        assert result is not None
        assert "[[" in result
        assert "wikilink" in result.lower()

    def test_empty_titles(self):
        result = build_wikilink_instruction([], lang="zh")
        assert result == ""

    def test_single_title(self):
        result = build_wikilink_instruction(["Only One"], lang="zh")
        assert "[[Only One]]" not in result  # instruction, not the link itself
        assert "- Only One" in result

    def test_zh_instruction_content(self):
        titles = ["Note A", "Note B"]
        result = build_wikilink_instruction(titles, lang="zh")
        assert "已有笔记" in result
        assert "- Note A" in result
        assert "- Note B" in result

    def test_en_instruction_content(self):
        titles = ["Note A"]
        result = build_wikilink_instruction(titles, lang="en")
        assert "Existing notes" in result
        assert "- Note A" in result

    def test_many_titles_truncated(self):
        """Should limit the number of titles included."""
        titles = [f"Title {i}" for i in range(200)]
        result = build_wikilink_instruction(titles, lang="zh")
        if result:
            # Should not include all 200 titles
            assert result.count("[[") < 200


class TestWriteResult:
    """Test markdown file writing."""

    def test_write_basic_result(self, tmp_vault):
        result = {
            "title": "Test Note",
            "summary": "A test note summary.",
            "tags": ["test", "example"],
            "timeline": "00:00 - Introduction\n01:30 - Main content",
            "key_points": ["Point 1", "Point 2"],
            "detailed_content": "This is the detailed content of the note.",
            "type": "video",
            "url": "https://example.com/video",
            "platform": "youtube",
        }
        path = write_result(tmp_vault, result)
        assert path.exists()
        assert path.suffix == ".md"

        content = path.read_text()
        assert "---" in content  # YAML frontmatter
        assert "Test Note" in content
        assert "test" in content

    def test_write_result_with_chinese(self, tmp_vault):
        result = {
            "title": "中文笔记",
            "summary": "这是一个测试笔记。",
            "tags": ["测试"],
            "detailed_content": "详细内容。",
            "type": "article",
        }
        path = write_result(tmp_vault, result)
        content = path.read_text(encoding="utf-8")
        assert "中文笔记" in content

    def test_write_result_creates_type_directory(self, tmp_vault):
        result = {
            "title": "Audio Note",
            "summary": "Audio summary.",
            "tags": [],
            "detailed_content": "Content.",
            "type": "audio",
        }
        path = write_result(tmp_vault, result)
        assert "audio" in str(path)

    def test_frontmatter_has_required_fields(self, tmp_vault):
        result = {
            "title": "Frontmatter Test",
            "summary": "Summary text.",
            "tags": ["tag1"],
            "type": "video",
            "url": "https://example.com",
            "platform": "youtube",
        }
        path = write_result(tmp_vault, result)
        content = path.read_text()
        assert "title:" in content
        assert "type:" in content
        assert "tags:" in content
        assert "created:" in content
        assert "schema_version: 2" in content

    def test_write_result_no_tags(self, tmp_vault):
        result = {
            "title": "No Tags",
            "summary": "Summary.",
            "tags": [],
            "type": "video",
        }
        path = write_result(tmp_vault, result)
        content = path.read_text()
        assert "No Tags" in content
        # Should still have tags field in frontmatter (default "content")
        assert "tags:" in content

    def test_write_result_with_url(self, tmp_vault):
        result = {
            "title": "URL Test",
            "summary": "Summary.",
            "tags": [],
            "type": "article",
            "url": "https://example.com/article",
            "platform": "web",
        }
        path = write_result(tmp_vault, result)
        content = path.read_text()
        assert "https://example.com/article" in content

    def test_write_result_default_type(self, tmp_vault):
        """When type is missing, should default to 'video'."""
        result = {
            "title": "Default Type",
            "summary": "Summary.",
            "tags": [],
        }
        path = write_result(tmp_vault, result)
        assert "video" in str(path)

    def test_write_result_slugify(self, tmp_vault):
        """Title with special chars should be slugified in filename."""
        result = {
            "title": "Hello World! @#$%",
            "summary": "Summary.",
            "tags": [],
            "type": "video",
        }
        path = write_result(tmp_vault, result)
        # Filename should not contain special chars
        assert "@" not in path.name
        assert "#" not in path.name
        assert path.suffix == ".md"

    def test_write_result_atomic(self, tmp_vault):
        """File should be written atomically (no .tmp left behind)."""
        result = {
            "title": "Atomic Write",
            "summary": "Summary.",
            "tags": [],
            "type": "video",
        }
        path = write_result(tmp_vault, result)
        tmp_files = list(path.parent.glob("*.tmp"))
        assert len(tmp_files) == 0
