"""MiMo article understanding backend — text-only analysis."""

from __future__ import annotations

import logging

from content_understand._keys import KeyRotator, rotate_request
from content_understand.defaults import MIMO_DEFAULT_MODEL_PRO
from content_understand.models.article_base import ArticleModel

logger = logging.getLogger(__name__)

_DEFAULT_ARTICLE_PROMPT = """请详细分析以下文章内容，输出结构化摘要。

标题：{title}
来源：{url}

文章内容：
```
{text}
```

请按以下结构输出：

## 要点
- 列出文章的核心要点（3-8 条）

## 详细内容
- 按论点或主题分段展开说明
- 每段的核心观点和支撑论据

## 关键数据与引用
- 文中提到的关键数据、统计、引用（如有）

## 作者立场
- 作者的主要观点或立场
- 论证逻辑

## 标签
- 给出 5-10 个相关标签，格式：#标签1 #标签2 ...

## 总结
- 用 2-3 句话总结文章主旨和核心价值"""


class MimoArticleModel(ArticleModel):
    """MiMo article understanding via text-only API.

    Uses mimo-v2.5-pro for text analysis (no vision needed).
    """

    def __init__(self, config) -> None:
        self.api_base = config.api_base
        self.rotator = KeyRotator(config.api_keys or [])
        self.model_name = config.model or MIMO_DEFAULT_MODEL_PRO
        self.max_tokens = config.max_tokens
        self.timeout = config.timeout or 120

    def _post(self, body: dict, timeout: int, label: str) -> str:
        return rotate_request(
            self.api_base, body, self.rotator, timeout, f"article-mimo:{label}"
        )

    def understand_article(
        self,
        text: str,
        title: str = "",
        url: str = "",
        prompt: str = "",
        timeout: int = 120,
    ) -> str:
        max_chars = 60000
        if len(text) > max_chars:
            text = text[:max_chars] + "\n\n[... text truncated ...]"

        if not prompt:
            prompt = _DEFAULT_ARTICLE_PROMPT.format(
                title=title, url=url, text=text
            )

        body = {
            "model": self.model_name,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": self.max_tokens,
        }

        return self._post(body, timeout or self.timeout, "article")
