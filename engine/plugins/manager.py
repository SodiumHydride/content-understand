import importlib.util
import logging
import sys
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

    def on_post_understand(self, result: Dict[str, Any]) -> Dict[str, Any]:
        """Hook called right after content understanding completes, before writing markdown.

        Allows plugins to modify result dict (e.g. enrich tags, filter summary, add metadata).
        """
        return result


class PluginManager:
    """Dynamic loader and manager for Python plugins."""

    def __init__(self, plugins_dirs: List[Path] = None):
        self.plugins_dirs = plugins_dirs or []
        self.plugins: List[BasePlugin] = []
        self._loaded = False

    def load_plugins(self) -> None:
        """Scan plugins directories and dynamically import python plugin modules."""
        if self._loaded:
            return
        
        self.plugins = []
        for directory in self.plugins_dirs:
            if not directory.exists() or not directory.is_dir():
                continue
            
            logger.info(f"Scanning directory for plugins: {directory}")
            for file_path in directory.glob("*.py"):
                if file_path.name.startswith("_"):
                    continue
                try:
                    module_name = f"engine.plugins.loaded.{file_path.stem}"
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
                                logger.info(f"Loaded class-based plugin: {pi.name()}")
                                self.plugins.append(pi)
                        else:
                            # Fallback: check if the module defines standard hook functions directly
                            if hasattr(module, "on_post_understand"):
                                class FuncPlugin(BasePlugin):
                                    def name(self) -> str:
                                        return file_path.stem
                                    def on_post_understand(self, res: Dict[str, Any]) -> Dict[str, Any]:
                                        try:
                                            return module.on_post_understand(res)
                                        except Exception as e:
                                            logger.error(f"Plugin function hook failed: {e}")
                                            return res
                                logger.info(f"Loaded function-based plugin: {file_path.stem}")
                                self.plugins.append(FuncPlugin())
                                
                except Exception as e:
                    logger.error(f"Failed to load plugin {file_path}: {e}")
                    
        self._loaded = True

    def run_post_understand(self, result: Dict[str, Any]) -> Dict[str, Any]:
        """Pass result through all loaded plugins sequentially (pipeline filter pattern)."""
        self.load_plugins()
        current_result = result
        for plugin in self.plugins:
            try:
                logger.info(f"Executing post_understand plugin hook: {plugin.name()}")
                current_result = plugin.on_post_understand(current_result)
            except Exception as e:
                logger.error(f"Plugin {plugin.name()} threw exception: {e}")
        return current_result


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
