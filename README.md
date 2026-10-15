# Signal Path

A phone-friendly reader for new research in music and audio technology.

Every day a GitHub Action pulls the newest papers from arXiv's sound and audio
categories (`cs.SD` and `eess.AS`), keeps the ones about music technology, tags
them by topic and publishes the site with GitHub Pages.

## Features

- **Latest**: papers from the last 45 days, grouped by day
- **Start here**: landmark papers with plain-English summaries
- **Saved**: your reading list, stored on your device
- **Explain this paper**: a plain-English summary, why it matters and key
  terms, generated once per paper through OpenRouter
- Topic filters: AI generation, source separation, transcription & MIR,
  synthesis & DSP, spatial audio, instruments & interaction, audio representations
- Search across titles, abstracts and authors

## How it fits together

| Path | What it does |
| --- | --- |
| `site/index.html` | The app (plain HTML, CSS and JavaScript) |
| `site/papers.json` | The feed data, rewritten by the daily update |
| `scripts/fetch_papers.py` | Fetches, filters and tags papers from the arXiv API |
| `scripts/explain_papers.py` | Adds plain-English explanations through OpenRouter |
| `.github/workflows/update-feed.yml` | Runs the fetch daily and deploys the site |

## One-time setup

1. In the repository, open **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Open **Actions → Update feed and publish site → Run workflow**.

The site then appears at `https://<your-username>.github.io/<repo-name>/` and
refreshes every day. On iPhone, open it in Safari and use
**Share → Add to Home Screen** to get an app icon.

## Turning on explanations

1. Create an API key at [openrouter.ai/keys](https://openrouter.ai/keys) and
   add some credit.
2. In the repository, open **Settings → Secrets and variables → Actions**.
3. On the **Secrets** tab, add a secret named `OPENROUTER_API_KEY` with the key.
4. Run the workflow from the **Actions** tab, or wait for the next daily run.

Each run explains up to 40 papers that don't have an explanation yet, so the
first few runs catch up on the backlog. Two optional settings go on the
**Variables** tab of the same page:

| Variable | Default | What it does |
| --- | --- | --- |
| `OPENROUTER_MODEL` | `anthropic/claude-haiku-4.5` | Any model ID from [openrouter.ai/models](https://openrouter.ai/models) |
| `EXPLAIN_MAX` | `40` | Most papers explained per run |

Without the secret, the feed updates as usual and the button doesn't appear.

## Running the fetch locally

```sh
python3 scripts/fetch_papers.py
```

To change which papers count as music technology, or how topics are assigned,
edit `MUSIC_TERMS` and `TOPIC_TERMS` in `scripts/fetch_papers.py`.
