import importlib.util
import logging
import sys
import threading
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

class BasePlugin(ABC):
    """Abstract base class for all sodium-engine plugins."""

    @abstractmethod
    def name(self) -> str:
        """Return the unique name of the plugin."""
        pass

    def on_pre_understand(self, url_or_path: str, config: Dict[str, Any]) -> Dict[str, Any]:
        """Hook called before understanding starts.

        Allows plugins to modify config (e.g. change model, add prompt instructions).
        Return modified config.
        """
        return config

    def on_post_understand(self, result: Dict[str, Any]) -> Dict[str, Any]:
        """Hook called right after content understanding completes, before writing markdown.

        Allows plugins to modify result dict (e.g. enrich tags, filter summary, add metadata).
        """
        return result

    def on_post_write(self, path: Path, result: Dict[str, Any]) -> None:
        """Hook called after markdown is written to vault.

        For side effects: notifications, webhooks, external indexing.
        """

    def on_post_index(self, slug: str, result: Dict[str, Any]) -> None:
        """Hook called after the page is indexed in SQLite.

        For side effects: updating external search indexes.
        """


class PluginManager:
    """Dynamic loader and manager for Python plugins."""

    _ALL_HOOKS = ("on_pre_understand", "on_post_understand", "on_post_write", "on_post_index")

    def __init__(self, plugins_dirs: List[Path] = None):
        self.plugins_dirs = plugins_dirs or []
        self.plugins: List[BasePlugin] = []
        self._loaded = False
        self._lock = threading.Lock()

    def load_plugins(self) -> None:
        """Scan plugins directories and dynamically import python plugin modules."""
        with self._lock:
            if self._loaded:
                return

            self.plugins = []
            for directory in self.plugins_dirs:
                if not directory.exists() or not directory.is_dir():
                    continue

                logger.info("Scanning directory for plugins: %s", directory)
                for file_path in directory.glob("*.py"):
                    if file_path.name.startswith("_"):
                        continue
                    try:
                        module_name = f"engine.plugins.loaded.{file_path.parent.name}.{file_path.stem}"
                        spec = importlib.util.spec_from_file_location(module_name, file_path)
                        if spec and spec.loader:
                            module = importlib.util.module_from_spec(spec)
                            sys.modules[module_name] = module
                            spec.loader.exec_module(module)

                            # Look for BasePlugin subclasses
                            plugin_instances = []
                            for attr_name in dir(module):
                                attr = getattr(module, attr_name)
                                if (
                                    isinstance(attr, type)
                                    and attr is not BasePlugin
                                    and issubclass(attr, BasePlugin)
                                ):
                                    plugin_instances.append(attr())

                            if plugin_instances:
                                for pi in plugin_instances:
                                    logger.info("Loaded class-based plugin: %s", pi.name())
                                    self.plugins.append(pi)
                            else:
                                # Fallback: check if the module defines any hook functions directly
                                available = [h for h in self._ALL_HOOKS if hasattr(module, h)]
                                if available:
                                    self.plugins.append(self._build_func_plugin(file_path.stem, module, available))
                                    logger.info("Loaded function-based plugin: %s (hooks: %s)", file_path.stem, available)

                    except Exception as e:
                        logger.error("Failed to load plugin %s: %s", file_path, e)

            self._loaded = True

    @staticmethod
    def _build_func_plugin(stem: str, module, available_hooks: List[str]) -> BasePlugin:
        """Create a BasePlugin subclass that delegates to module-level functions."""

        class FuncPlugin(BasePlugin):
            def name(self) -> str:
                return stem

            def on_pre_understand(self, url_or_path: str, config: Dict[str, Any]) -> Dict[str, Any]:
                if "on_pre_understand" not in available_hooks:
                    return config
                try:
                    return module.on_pre_understand(url_or_path, config)
                except Exception as e:
                    logger.error("Plugin %s on_pre_understand failed: %s", stem, e)
                    return config

            def on_post_understand(self, res: Dict[str, Any]) -> Dict[str, Any]:
                if "on_post_understand" not in available_hooks:
                    return res
                try:
                    return module.on_post_understand(res)
                except Exception as e:
                    logger.error("Plugin %s on_post_understand failed: %s", stem, e)
                    return res

            def on_post_write(self, path: Path, result: Dict[str, Any]) -> None:
                if "on_post_write" not in available_hooks:
                    return
                try:
                    module.on_post_write(path, result)
                except Exception as e:
                    logger.error("Plugin %s on_post_write failed: %s", stem, e)

            def on_post_index(self, slug: str, result: Dict[str, Any]) -> None:
                if "on_post_index" not in available_hooks:
                    return
                try:
                    module.on_post_index(slug, result)
                except Exception as e:
                    logger.error("Plugin %s on_post_index failed: %s", stem, e)

        instance = FuncPlugin()
        instance._available_hooks = set(available_hooks)
        return instance

    def reload(self) -> None:
        """Reset and reload all plugins from disk."""
        with self._lock:
            self._loaded = False
            self.plugins = []
        self.load_plugins()
        logger.info("Reloaded %d plugin(s)", len(self.plugins))

    def list_plugins(self) -> List[Dict[str, Any]]:
        """Return info about loaded plugins: name and available hooks."""
        self.load_plugins()
        out = []
        for plugin in self.plugins:
            available = getattr(plugin, '_available_hooks', None)
            if available is not None:
                hooks = [h for h in self._ALL_HOOKS if h in available]
            else:
                hooks = []
                for hook_name in self._ALL_HOOKS:
                    method = getattr(plugin, hook_name, None)
                    if method is not None:
                        base_method = getattr(BasePlugin, hook_name)
                        if method.__func__ is not base_method:
                            hooks.append(hook_name)
            out.append({"name": plugin.name(), "hooks": hooks})
        return out

    def run_pre_understand(self, url_or_path: str, config: Dict[str, Any]) -> Dict[str, Any]:
        """Run on_pre_understand hooks across all plugins, passing config through."""
        self.load_plugins()
        current = config
        for plugin in self.plugins:
            try:
                logger.info("Running pre_understand hook: %s", plugin.name())
                current = plugin.on_pre_understand(url_or_path, current)
            except Exception as e:
                logger.error("Plugin %s pre_understand threw: %s", plugin.name(), e)
        return current

    def run_post_understand(self, result: Dict[str, Any]) -> Dict[str, Any]:
        """Pass result through all loaded plugins sequentially (pipeline filter pattern)."""
        self.load_plugins()
        current_result = result
        for plugin in self.plugins:
            try:
                logger.info("Running post_understand hook: %s", plugin.name())
                current_result = plugin.on_post_understand(current_result)
            except Exception as e:
                logger.error("Plugin %s post_understand threw: %s", plugin.name(), e)
        return current_result

    def run_post_write(self, path: Path, result: Dict[str, Any]) -> None:
        """Run on_post_write hooks across all plugins."""
        self.load_plugins()
        for plugin in self.plugins:
            try:
                logger.info("Running post_write hook: %s", plugin.name())
                plugin.on_post_write(path, result)
            except Exception as e:
                logger.error("Plugin %s post_write threw: %s", plugin.name(), e)

    def run_post_index(self, slug: str, result: Dict[str, Any]) -> None:
        """Run on_post_index hooks across all plugins."""
        self.load_plugins()
        for plugin in self.plugins:
            try:
                logger.info("Running post_index hook: %s", plugin.name())
                plugin.on_post_index(slug, result)
            except Exception as e:
                logger.error("Plugin %s post_index threw: %s", plugin.name(), e)


# Singleton plugin manager initialized with paths
_manager = None

def get_plugin_manager() -> PluginManager:
    """Return the global PluginManager singleton, configuring standard search paths."""
    global _manager
    if _manager is None:
        from engine.paths import vault_dir
        vp = vault_dir()
        
        # We load plugins from:
        # 1. <vault>/.content-app/plugins
        # 2. engine/plugins/builtin
        paths = [
            vp / ".content-app" / "plugins",
            Path(__file__).parent / "builtin"
        ]
        _manager = PluginManager(paths)
    return _manager
