import re
from typing import Any, Dict
from engine.plugins.manager import BasePlugin

class AutoTagPlugin(BasePlugin):
    """Builtin plugin that analyzes the note content and automatically adds relevant tags."""

    def name(self) -> str:
        return "AutoTagPlugin"

    def on_post_understand(self, result: Dict[str, Any]) -> Dict[str, Any]:
        tags = result.get("tags", [])
        if not isinstance(tags, list):
            tags = list(tags)
            
        summary = result.get("summary", "")
        title = result.get("title", "")
        content = (title + " " + summary).lower()
        
        # Simple keyword-based auto tagging dictionary
        rules = {
            "ai": ["人工智能", "ai", "llm", "large language model", "gpt", "claude", "gemini", "prompt"],
            "programming": ["编程", "代码", "python", "javascript", "typescript", "rust", "c++", "developer"],
            "productivity": ["效率", "时间管理", "工作流", "notion", "obsidian", "knowledge", "知识库"],
            "science": ["科学", "物理", "化学", "生物", "研究", "论文", "research", "paper"],
            "design": ["设计", "ui", "ux", "visual", "aesthetic", "css", "styling", "layout"],
            "video": ["视频", "bilibili", "youtube", "vlog", "clip", "movie"]
        }
        
        added = False
        for tag, keywords in rules.items():
            if tag in tags:
                continue
            for kw in keywords:
                if kw in content:
                    tags.append(tag)
                    added = True
                    break
                    
        if added:
            result["tags"] = tags
            
        return result
