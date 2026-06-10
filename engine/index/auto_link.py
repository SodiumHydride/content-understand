import collections
import json
import math
import re
import jieba
from typing import Any, Dict, List

def get_recommendations(conn, slug: str, limit: int = 5) -> List[Dict[str, Any]]:
    """Calculate smart note recommendation links based on TF-IDF text similarity,
    shared tags, and direct title mentions.
    """
    # 1. Fetch the target page
    target = conn.execute(
        "SELECT slug, title, body, tags FROM pages WHERE slug = ?", (slug,)
    ).fetchone()
    if not target:
        return []
    
    target_slug, target_title, target_body, target_tags_json = target
    try:
        target_tags = set(json.loads(target_tags_json))
    except Exception:
        target_tags = set()
        
    # 2. Fetch all other pages
    all_pages = conn.execute(
        "SELECT slug, title, body, tags FROM pages WHERE slug != ?", (slug,)
    ).fetchall()
    if not all_pages:
        return []
        
    # Tokenize helper
    def tokenize(text: str) -> List[str]:
        # Clean markdown characters
        clean = re.sub(r'[#\-\*\[\]\(\)\`\n\r\t]', ' ', text)
        words = jieba.cut(clean)
        return [w.strip() for w in words if len(w.strip()) > 1]
        
    # Tokenize all pages
    doc_tokens = {}
    doc_tags = {}
    doc_titles = {}
    
    # Target doc tokens
    target_tokens = tokenize(target_title + " " + target_body)
    target_tf = collections.Counter(target_tokens)
    
    for row in all_pages:
        p_slug, p_title, p_body, p_tags_json = row
        p_text = p_title + " " + p_body
        tokens = tokenize(p_text)
        doc_tokens[p_slug] = tokens
        doc_titles[p_slug] = p_title
        try:
            doc_tags[p_slug] = set(json.loads(p_tags_json))
        except Exception:
            doc_tags[p_slug] = set()
            
    # Calculate IDF
    all_slugs = list(doc_tokens.keys())
    num_docs = len(all_slugs) + 1  # include target doc
    
    vocab = set(target_tokens)
    for tokens in doc_tokens.values():
        vocab.update(tokens)
        
    doc_freq = collections.defaultdict(int)
    # Count document frequency
    for w in target_tf:
        doc_freq[w] += 1
    for tokens in doc_tokens.values():
        for w in set(tokens):
            doc_freq[w] += 1
            
    idf = {}
    for w in vocab:
        idf[w] = math.log((num_docs + 1) / (doc_freq[w] + 1)) + 1
        
    # TF-IDF vector for target
    target_vector = {w: tf * idf[w] for w, tf in target_tf.items()}
    target_norm = math.sqrt(sum(v*v for v in target_vector.values()))
    
    recommendations = []
    
    for p_slug in all_slugs:
        tokens = doc_tokens[p_slug]
        p_tf = collections.Counter(tokens)
        p_vector = {w: tf * idf[w] for w, tf in p_tf.items() if w in target_vector}
        
        # Cosine similarity
        dot_product = sum(target_vector[w] * p_vector.get(w, 0) for w in target_vector)
        p_norm = math.sqrt(sum((tf * idf[w])**2 for w, tf in p_tf.items()))
        
        sim = 0.0
        if target_norm > 0 and p_norm > 0:
            sim = dot_product / (target_norm * p_norm)
            
        # Additional weights
        # A. Shared tags bonus (+0.15 per shared tag)
        shared_tags = target_tags.intersection(doc_tags[p_slug])
        sim += 0.15 * len(shared_tags)
        
        # B. Direct title mention bonus (+0.3 if other title appears in target body, or vice versa)
        p_title = doc_titles[p_slug]
        if len(p_title) > 1:
            if p_title.lower() in target_body.lower():
                sim += 0.35
            if target_title.lower() in p_body.lower():
                sim += 0.35
                
        # C. Filter out if already linked
        already_linked = conn.execute(
            "SELECT 1 FROM links WHERE (source_slug = ? AND target_slug = ?) OR (source_slug = ? AND target_slug = ?)",
            (slug, p_slug, p_slug, slug)
        ).fetchone()
        
        if not already_linked and sim > 0:
            recommendations.append({
                "slug": p_slug,
                "title": p_title,
                "score": sim,
                "reason": "tag" if shared_tags else "similarity"
            })
            
    # Sort by score desc
    recommendations.sort(key=lambda x: x["score"], reverse=True)
    return recommendations[:limit]
