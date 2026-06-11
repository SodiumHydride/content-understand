import logging
import requests
from typing import Dict, Any, List
from engine.understand.config import ContentConfig

logger = logging.getLogger(__name__)

def generate_answer(
    config: ContentConfig,
    question: str,
    context: str,
    chat_history: List[Dict[str, str]] = None
) -> str:
    """Send RAG prompt to the active LLM backend based on ContentConfig."""
    chat_history = chat_history or []
    
    # 1. Determine which provider to use
    # We fallback to the article backend as the default LLM provider
    provider_id = config.article_backend or "local_server"
    bc = config.backends.get(provider_id)
    if not bc:
        # Fallback to local Ollama if not set or missing
        provider_id = "local_server"
        bc = config.backends.get("local_server")
        
    if not bc:
        raise RuntimeError("No active LLM provider configured. Please configure a backend in Settings.")

    # 2. Build the system and user prompts
    system_prompt = (
        "You are a personal knowledge assistant with access to the user's note vault.\n\n"
        "Rules:\n"
        "1. Answer based on the provided notes. If the notes lack sufficient info, say so clearly.\n"
        "2. Cite notes using [[wikilinks]] — e.g., [[Note Title]]. Never use markdown links for citations.\n"
        "3. Structure answers with markdown: headings, bullet points, code blocks as appropriate.\n"
        "4. Be concise. Prefer bullet points over paragraphs.\n"
        "5. If multiple notes cover the same topic, synthesize rather than repeating.\n"
        "6. For factual claims, indicate whether they come from notes or general knowledge."
    )
    
    user_prompt = f"Context from notes:\n{context}\n\nQuestion: {question}"

    # Safety: truncate context if extremely long, preserving the question
    if len(user_prompt) > 100_000:
        context_part = f"Context from notes:\n{context}"
        question_part = f"\n\nQuestion: {question}"
        max_context = 100_000 - len(question_part)
        user_prompt = context_part[:max_context] + "\n\n[Context truncated...]" + question_part

    # Try calling the API
    try:
        api_key = bc.api_keys[0] if bc.api_keys else "local"
        model = bc.model or "qwen2.5-coder:7b" # default fallback
        
        # ─── Gemini ───
        if bc.type == "gemini":
            # Gemini models usually look like gemini-1.5-flash
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            headers = {"Content-Type": "application/json"}
            
            # Form contents with history
            contents = []
            for h in chat_history:
                role = "user" if h["role"] == "user" else "model"
                contents.append({"role": role, "parts": [{"text": h["content"]}]})
            
            # Add context instruction and question
            contents.append({"role": "user", "parts": [{"text": f"Instructions: {system_prompt}\n\n{user_prompt}"}]})
            
            payload = {"contents": contents}
            r = requests.post(url, headers=headers, json=payload, timeout=60)
            r.raise_for_status()
            res = r.json()
            return res["candidates"][0]["content"]["parts"][0]["text"]
            
        # ─── Claude (Anthropic) ───
        elif bc.type == "claude":
            url = bc.api_base or "https://api.anthropic.com/v1/messages"
            headers = {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
            }
            
            messages = []
            for h in chat_history:
                messages.append({"role": h["role"], "content": h["content"]})
            messages.append({"role": "user", "content": user_prompt})
            
            payload = {
                "model": model,
                "max_tokens": 4096,
                "system": system_prompt,
                "messages": messages
            }
            r = requests.post(url, headers=headers, json=payload, timeout=60)
            r.raise_for_status()
            res = r.json()
            return res["content"][0]["text"]
            
        # ─── OpenAI Compat & Ollama ───
        else:
            # bc.type is "mimo" or "openai_compat" or local_server
            url = bc.api_base or "https://api.openai.com/v1"
            if not url.endswith("/chat/completions"):
                url = f"{url.rstrip('/')}/chat/completions"
                
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}"
            }
            
            messages = [{"role": "system", "content": system_prompt}]
            for h in chat_history:
                messages.append({"role": h["role"], "content": h["content"]})
            messages.append({"role": "user", "content": user_prompt})
            
            payload = {
                "model": model,
                "messages": messages
            }
            r = requests.post(url, headers=headers, json=payload, timeout=60)
            r.raise_for_status()
            res = r.json()
            return res["choices"][0]["message"]["content"]
            
    except Exception as e:
        logger.error("LLM generation failed for provider %s (%s): %s", provider_id, bc.type, e, exc_info=True)
        raise RuntimeError(f"LLM generation failed: {e}") from e
