"""Tests for the plugin manager."""

import threading

from engine.plugins.manager import PluginManager


class TestPluginManager:
    """Test plugin manager thread safety and hook detection."""

    def test_reload_is_callable(self):
        pm = PluginManager([])
        pm.reload()  # Should not raise
        assert pm.plugins == []

    def test_list_plugins_empty(self):
        pm = PluginManager([])
        result = pm.list_plugins()
        assert result == []

    def test_thread_safe_reload(self):
        """Verify reload doesn't crash under concurrent access."""
        pm = PluginManager([])
        errors = []

        def try_reload():
            try:
                pm.reload()
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=try_reload) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert errors == []
