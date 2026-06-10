"""OpenAI-compatible article understanding backend.

Wraps any OpenAI-compatible chat API for text-only article analysis.
Works with Ollama, llama.cpp, LM Studio, vLLM, etc.
"""

from __future__ import annotations

import logging

from content_understand._keys import KeyRotator, rotate_request
from content_understand.models.article_base import ArticleModel

logger = logging.getLogger(__name__)

_DEFAULT_ARTICLE_PROMPT: dict[str, str] = {
    "zh": """请详细分析以下文章内容，输出结构化摘要。

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

## 标签
- 给出 5-10 个相关标签，格式：#标签1 #标签2 ...

## 总结
- 用 2-3 句话总结文章主旨""",
    "en": """Analyze the following article and output a structured summary.

Title: {title}
Source: {url}

Article content:
```
{text}
```

Output in the following structure:

## Key Points
- List core points (3-8 items)

## Detailed Content
- Expand by argument or theme

## Tags
- Give 5-10 relevant tags, format: #tag1 #tag2 ...

## Conclusion
- Summarize the article's core message in 2-3 sentences""",
}


class OpenAICompatArticleModel(ArticleModel):
    """OpenAI-compatible article understanding via chat completions."""

    def __init__(self, config) -> None:
        self.api_base = config.api_base.rstrip("/")
        self.rotator = KeyRotator(config.api_keys or [])
        self.model_name = config.model or ""
        self.max_tokens = config.max_tokens or 4096
        self.timeout = config.timeout or 120

    def _call_api(self, body: dict, timeout: int) -> str:
        url = f"{self.api_base}/chat/completions"
        return rotate_request(
            url,
            body,
            self.rotator,
            timeout,
            "openai-compat:article",
        )

    def understand_article(
        self,
        text: str,
        title: str = "",
        url: str = "",
        prompt: str = "",
        timeout: int = 120,
        language: str = "zh",
    ) -> str:
        max_chars = 60000
        if len(text) > max_chars:
            text = text[:max_chars] + "\n\n[... text truncated ...]"

        if not prompt:
            template = _DEFAULT_ARTICLE_PROMPT.get(language, _DEFAULT_ARTICLE_PROMPT["zh"])
            prompt = template.format(title=title, url=url, text=text)

        body = {
            "model": self.model_name,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": self.max_tokens,
        }

        return self._call_api(body, timeout or self.timeout)
