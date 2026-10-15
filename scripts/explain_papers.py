"""Add plain-English explanations to papers in site/papers.json.

Runs in GitHub Actions after fetch_papers.py. Each paper is explained once
through the OpenRouter API and the result is stored on the paper, so the
app shows it instantly and each paper is only paid for once.

Settings (environment variables):
  OPENROUTER_API_KEY  required; without it the script does nothing
  OPENROUTER_MODEL    which model to use (default below)
  EXPLAIN_MAX         most papers to explain per run (default 40)
"""

import http.client
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FEED_FILE = ROOT / "site" / "papers.json"

API_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "anthropic/claude-haiku-4.5"
DEFAULT_MAX = 40

SYSTEM_PROMPT = """You explain new music-technology research to a curious musician who is learning the field. They play and produce music but have no background in machine learning or signal processing.

You get a paper's title and abstract. Explain only what the abstract supports. Do not invent results, numbers or claims, and do not hype. If the abstract is vague about something, say less rather than guess.

Reply with a single JSON object and nothing else, using exactly these keys:
{
  "tldr": "One sentence, under 25 words: what the paper does.",
  "plain": "Two to four sentences in everyday language: the problem, the idea, and what they found.",
  "why": "One or two sentences on why it matters to musicians, producers or instrument makers.",
  "terms": [{"term": "a technical term from the abstract", "meaning": "a short plain definition"}]
}
Include up to three terms, choosing the ones a newcomer is least likely to know."""


class StopRun(Exception):
    """An error that will repeat for every paper, such as a bad key."""


def call_openrouter(api_key, model, paper):
    body = json.dumps({
        "model": model,
        "max_tokens": 700,
        "temperature": 0.3,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Title: {paper['title']}\n\nAbstract: {paper['summary']}"},
        ],
    }).encode("utf-8")
    request = urllib.request.Request(API_URL, data=body, headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "X-Title": "Signal Path",
    })
    with urllib.request.urlopen(request, timeout=90) as response:
        data = json.loads(response.read().decode("utf-8"))
    if "error" in data:
        raise RuntimeError(data["error"].get("message", data["error"]))
    return data["choices"][0]["message"]["content"]


def parse_explanation(text):
    """Pull the JSON object out of the reply and check its shape."""
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("reply had no JSON object")
    data = json.loads(text[start:end + 1])
    explanation = {key: str(data.get(key, "")).strip() for key in ("tldr", "plain", "why")}
    if not explanation["tldr"] or not explanation["plain"]:
        raise ValueError("reply was missing tldr or plain")
    terms = []
    for item in data.get("terms") or []:
        if isinstance(item, dict) and item.get("term") and item.get("meaning"):
            terms.append({"term": str(item["term"]).strip(), "meaning": str(item["meaning"]).strip()})
    explanation["terms"] = terms[:3]
    return explanation


def explain(api_key, model, paper):
    for attempt in range(2):
        try:
            return parse_explanation(call_openrouter(api_key, model, paper))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")[:300]
            if error.code in (401, 402, 403):
                raise StopRun(f"OpenRouter returned {error.code}: {detail}")
            if error.code == 400 and "model" in detail.lower():
                raise StopRun(f"OpenRouter rejected the model '{model}': {detail}")
            print(f"  HTTP {error.code} on attempt {attempt + 1}: {detail}", file=sys.stderr)
            time.sleep(10 if error.code == 429 else 3)
        # OSError covers dropped connections and timeouts; HTTPException covers
        # a response cut off partway through.
        except (ValueError, KeyError, RuntimeError, OSError, http.client.HTTPException) as error:
            print(f"  failed on attempt {attempt + 1}: {error}", file=sys.stderr)
            time.sleep(3)
    return None


def main():
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        print("OPENROUTER_API_KEY is not set; skipping explanations.")
        return
    model = os.environ.get("OPENROUTER_MODEL", "").strip() or DEFAULT_MODEL
    limit = int(os.environ.get("EXPLAIN_MAX", "").strip() or DEFAULT_MAX)

    feed = json.loads(FEED_FILE.read_text())
    todo = [p for p in feed.get("papers", []) if not p.get("explain")][:limit]
    print(f"Explaining {len(todo)} papers with {model}.")

    done = 0
    try:
        for paper in todo:
            result = explain(api_key, model, paper)
            if result:
                result["model"] = model
                paper["explain"] = result
                done += 1
                # Save as we go so an unexpected error never loses paid-for work.
                FEED_FILE.write_text(json.dumps(feed, ensure_ascii=False, indent=1) + "\n")
                print(f"  ok  {paper['id']}")
            else:
                print(f"  skipped {paper['id']}")
    except StopRun as error:
        print(f"Stopping early: {error}", file=sys.stderr)
    print(f"Added {done} explanations.")


if __name__ == "__main__":
    main()
