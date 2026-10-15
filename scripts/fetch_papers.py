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

# Terms match whole words; a trailing * matches any ending ("melod*" finds
# "melody" and "melodic", and "tempo" no longer matches inside "temporal").

# Any one of these marks a paper as music technology.
MUSIC_TERMS = [
    "music*", "musician*", "song", "songs", "songwriting", "singing", "singer*",
    "melod*", "chord*", "harmony", "harmonies", "harmoniz*", "harmonis*",
    "polyphon*", "piano*", "guitar*", "drum", "drums", "drummer*", "violin*",
    "orchestra*", "instrumental", "musical instrument*", "midi", "lyrics",
    "tempo", "rhythm*", "beat tracking", "nime", "dj", "remix*", "mastering",
    "daw", "audio plugin*", "vst*", "sound design", "synth", "synths",
    "wavetable*",
]

# These count only in papers that aren't about speech: "timbre" and
# "synthesizer" also show up in text-to-speech research.
WEAK_MUSIC_TERMS = [
    "synthesizer*", "synthesiser*", "timbre", "spatial audio", "ambisonic*",
    "binaural", "hrtf*", "head-related", "room impulse", "room acoustic*",
    "foley", "audio effect*", "reverb*", "mixing",
]

SPEECH_TERMS = [
    "speech", "speaker*", "spoken", "tts", "text-to-speech", "asr",
    "voice conversion", "dialogue*", "conversational", "stutter*", "accent*",
    "paralinguistic", "diarization",
]

TOPIC_TERMS = {
    "gen": ["generat*", "text-to-music", "text-to-audio", "diffusion",
            "accompaniment", "composition*", "continuation"],
    "sep": ["source separation", "separation", "stem", "stems", "demix*",
            "unmix*"],
    "mir": ["transcription", "transcribe*", "information retrieval",
            "beat tracking", "chord recognition", "key estimation", "tagging",
            "pitch estimation", "multi-pitch", "f0", "melody extraction",
            "cover song*", "onset*", "tempo estimation", "genre*",
            "music classification", "instrument recognition",
            "structure analysis"],
    "syn": ["synthes*", "dsp", "digital signal processing", "audio effect*",
            "oscillator*", "timbre transfer", "wavetable*", "reverb*",
            "distortion", "virtual analog", "differentiable", "filter design",
            "modular", "vst*", "audio plugin*", "foley"],
    "spa": ["spatial", "binaural", "ambisonic*", "hrtf*", "head-related",
            "room acoustic*", "room impulse", "immersive",
            "loudspeaker array*"],
    "hci": ["interface*", "human-computer interaction", "interactive",
            "live performance", "musician*", "user study", "controller*",
            "gesture*", "digital musical instrument*", "nime", "co-creat*",
            "creativity support"],
    "rep": ["representation*", "embedding*", "self-supervised", "codec*",
            "tokeniz*", "tokenis*", "contrastive", "pretrain*", "pre-train*",
            "foundation model*"],
}


def pattern(terms):
    parts = [re.escape(t[:-1]) + r"\w*" if t.endswith("*") else re.escape(t)
             for t in terms]
    return re.compile(r"\b(?:" + "|".join(parts) + r")\b")


MUSIC_RE = pattern(MUSIC_TERMS)
WEAK_MUSIC_RE = pattern(WEAK_MUSIC_TERMS)
SPEECH_RE = pattern(SPEECH_TERMS)
TOPIC_RES = {tid: pattern(terms) for tid, terms in TOPIC_TERMS.items()}


def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()


def is_music(text):
    if MUSIC_RE.search(text):
        return True
    return bool(WEAK_MUSIC_RE.search(text)) and not SPEECH_RE.search(text)


def topics_for(text):
    return [tid for tid, regex in TOPIC_RES.items() if regex.search(text)]


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
    kept = []
    for paper in by_id.values():
        if paper.get("published", "") < cutoff:
            continue
        # Re-check older papers too, so filter changes apply to the whole feed.
        text = f"{paper['title']} {paper['summary']}".lower()
        if not is_music(text):
            continue
        paper["topics"] = topics_for(text)
        kept.append(paper)
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
