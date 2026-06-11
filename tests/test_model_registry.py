"""Tests for the unified model registry."""

import pytest

from content_understand.models.registry import (
    create_content_model,
    has_content_model,
    list_content_models,
    list_backends,
)
from content_understand.models.base import ContentModel
from content_understand.capabilities import Modality
from content_understand.config import BackendConfig


class TestRegistry:
    """Test the model registry functions."""

    def test_list_backends_returns_dict(self):
        """list_backends() returns a dict with 'content' key mapping to backend names."""
        backends = list_backends()
        assert isinstance(backends, dict)
        assert "content" in backends

    def test_list_backends_content_key(self):
        backends = list_backends()
        names = backends["content"]
        assert "gemma4" in names
        assert "qwen_omni" in names
        assert "mimo" in names
        assert "openai_compat" in names
        assert "local_server" in names
        assert "claude" in names
        assert "gemini" in names

    def test_has_content_model_known(self):
        assert has_content_model("gemma4") is True
        assert has_content_model("mimo") is True
        assert has_content_model("openai_compat") is True

    def test_has_content_model_unknown(self):
        assert has_content_model("nonexistent_backend") is False

    def test_list_content_models_returns_list(self):
        """list_content_models() returns a sorted list of backend name strings."""
        models = list_content_models()
        assert isinstance(models, list)
        assert len(models) >= 5  # at least gemma4, qwen_omni, mimo, openai_compat, claude, gemini
        assert "gemma4" in models
        assert "mimo" in models

    def test_list_content_models_sorted(self):
        models = list_content_models()
        assert models == sorted(models)

    def test_create_content_model_returns_content_model(self):
        """Verify create_content_model returns a ContentModel subclass."""
        bc = BackendConfig(
            type="openai_compat",
            api_base="http://localhost:11434/v1",
            model="test",
        )
        model = create_content_model("openai_compat", bc)
        assert isinstance(model, ContentModel)
        assert hasattr(model, "capabilities")
        assert hasattr(model, "understand")

    def test_create_content_model_unknown_raises(self):
        """Unknown backend should raise ValueError."""
        bc = BackendConfig(type="openai_compat", model="test")
        with pytest.raises((ValueError, KeyError)):
            create_content_model("nonexistent", bc)

    def test_create_content_model_resolves_by_model_name(self):
        """When model name matches a pattern, it should resolve to that backend."""
        bc = BackendConfig(
            type="local_server",
            api_base="http://localhost:11434/v1",
            model="gemma4:12b-it-qat",
        )
        # model name "gemma4" should resolve to "gemma4" backend, not "local_server"
        model = create_content_model("local_server", bc)
        assert isinstance(model, ContentModel)


class TestContentModelInterface:
    """Test that registered models implement ContentModel correctly."""

    @pytest.fixture
    def openai_model(self):
        bc = BackendConfig(
            type="openai_compat",
            api_base="http://localhost:11434/v1",
            model="test",
        )
        return create_content_model("openai_compat", bc)

    def test_has_capabilities(self, openai_model):
        caps = openai_model.capabilities()
        assert caps is not None
        assert hasattr(caps, "accepts")

    def test_capabilities_accepts_modality(self, openai_model):
        caps = openai_model.capabilities()
        assert isinstance(caps.accepts, Modality)
        assert caps.accepts != 0  # At least one modality

    def test_capabilities_have_preferred_input(self, openai_model):
        caps = openai_model.capabilities()
        assert hasattr(caps, "preferred_input")
        assert isinstance(caps.preferred_input, Modality)
