"""Fetch recent music-technology papers from arXiv and write site/papers.json.

Runs daily in GitHub Actions. Uses only the Python standard library.
New papers are merged with the existing file so the feed keeps a rolling
window of recent work even when arXiv returns a short page.
"""

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_FILE = ROOT / "site" / "papers.json"

API_URL = "https://export.arxiv.org/api/query"
QUERY = "cat:cs.SD OR cat:eess.AS"
MAX_RESULTS = 300
KEEP_DAYS = 45
MAX_PAPERS = 300

NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "arxiv": "http://arxiv.org/schemas/atom",
}

# A paper must mention one of these to count as music technology.
# cs.SD and eess.AS also carry a lot of speech research, which this filters out.
MUSIC_TERMS = [
    "music", "musical", "song", "singing", "singer", "melod", "chord",
    "harmon", "instrument", "piano", "guitar", "drum", "violin", "synthesizer",
    "synthesiser", "timbre", "rhythm", "tempo", "beat tracking", "midi",
    "symbolic", "composer", "audio effect", "spatial audio", "binaural",
    "ambisonic", "room impulse", "nime", "remix", "mixing", "mastering",
    "sound design", "wavetable", "lyrics",
]

TOPIC_TERMS = {
    "gen": ["generat", "text-to-music", "text-to-audio", "diffusion",
            "accompaniment", "composition", "continuation", "language model"],
    "sep": ["source separation", "separation", "stem", "demix", "unmix"],
    "mir": ["transcription", "information retrieval", "beat tracking",
            "chord recognition", "key estimation", "tagging", "pitch estimation",
            "f0", "melody extraction", "cover song", "onset", "tempo estimation",
            "classification", "structure analysis", "alignment"],
    "syn": ["synthes", "dsp", "audio effect", "oscillator", "timbre transfer",
            "wavetable", "reverb", "distortion", "virtual analog",
            "differentiable", "filter design", "modular"],
    "spa": ["spatial", "binaural", "ambisonic", "hrtf", "room acoustic",
            "room impulse", "immersive", "loudspeaker array"],
    "hci": ["interface", "interaction", "live performance", "musician",
            "user study", "controller", "gesture", "digital musical instrument",
            "nime", "co-creat", "creativity support", "real-time"],
    "rep": ["representation", "embedding", "self-supervised", "codec",
            "tokeniz", "contrastive", "pretrain", "pre-train",
            "foundation model"],
}


def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()


def is_music(text):
    return any(term in text for term in MUSIC_TERMS)


def topics_for(text):
    return [tid for tid, terms in TOPIC_TERMS.items()
            if any(term in text for term in terms)]


def parse_feed(xml_text):
    root = ET.fromstring(xml_text)
    papers = []
    for entry in root.findall("atom:entry", NS):
        raw_id = clean(entry.findtext("atom:id", "", NS))
        arxiv_id = re.sub(r"v\d+$", "", raw_id.rsplit("/abs/", 1)[-1])
        if not arxiv_id:
            continue
        title = clean(entry.findtext("atom:title", "", NS))
        summary = clean(entry.findtext("atom:summary", "", NS))
        text = f"{title} {summary}".lower()
        if not is_music(text):
            continue
        authors = [clean(a.findtext("atom:name", "", NS))
                   for a in entry.findall("atom:author", NS)]
        primary = entry.find("arxiv:primary_category", NS)
        papers.append({
            "id": arxiv_id,
            "title": title,
            "authors": authors,
            "published": clean(entry.findtext("atom:published", "", NS))[:10],
            "category": primary.get("term") if primary is not None else "",
            "topics": topics_for(text),
            "summary": summary,
            "url": f"https://arxiv.org/abs/{arxiv_id}",
            "pdf": f"https://arxiv.org/pdf/{arxiv_id}",
        })
    return papers


def download():
    params = urllib.parse.urlencode({
        "search_query": QUERY,
        "sortBy": "submittedDate",
        "sortOrder": "descending",
        "start": 0,
        "max_results": MAX_RESULTS,
    })
    request = urllib.request.Request(
        f"{API_URL}?{params}",
        headers={"User-Agent": "signal-path-feed/1.0 (GitHub Actions)"},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read().decode("utf-8")
        except Exception as error:  # network errors, timeouts, 5xx
            print(f"arXiv request failed (attempt {attempt + 1}): {error}",
                  file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    return None


def load_existing():
    try:
        return json.loads(OUT_FILE.read_text()).get("papers", [])
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def merge(new, old, today):
    cutoff = (today - timedelta(days=KEEP_DAYS)).isoformat()
    by_id = {p["id"]: p for p in old}
    for paper in new:
        # Keep explanations already generated for this paper.
        if "explain" in by_id.get(paper["id"], {}):
            paper["explain"] = by_id[paper["id"]]["explain"]
        by_id[paper["id"]] = paper
    kept = [p for p in by_id.values() if p.get("published", "") >= cutoff]
    kept.sort(key=lambda p: (p.get("published", ""), p["id"]), reverse=True)
    return kept[:MAX_PAPERS]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", help="Read the arXiv Atom feed from a file instead of the network")
    args = parser.parse_args()

    xml_text = Path(args.input).read_text() if args.input else download()
    if xml_text is None:
        print("Keeping the existing feed because arXiv could not be reached.")
        return

    new = parse_feed(xml_text)
    old = load_existing()
    if not new and old:
        print("arXiv returned no music papers; keeping the existing feed.")
        return

    papers = merge(new, old, date.today())
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps({
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "papers": papers,
    }, ensure_ascii=False, indent=1) + "\n")
    print(f"Fetched {len(new)} music papers; feed now holds {len(papers)}.")


if __name__ == "__main__":
    main()
