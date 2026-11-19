"""Build the corpus from Project Gutenberg's RDF feed.

    python tools/fetch.py            # use a cached archive if present
    python tools/fetch.py --refresh  # re-download the archive

Why the RDF tarball rather than the gutendex API: gutendex serves 32 books per page
with no page_size option, and deep pages take 12 to 20 seconds, so the full 79k
corpus is 2,472 requests and hours of wall clock. The RDF feed is ONE request that
carries the same numbers - verified against gutendex on three books, exact match -
plus the author dates, which the API only exposes per book.

THE KEY FACT ABOUT THE DOWNLOAD FIGURE, verified against Gutenberg's own
documentation rather than assumed: `pgterms:downloads` is "the approximate number of
downloads in the last 30 days (updated daily)". It is NOT cumulative since upload.
That matters twice over:
  - it is a measure of CURRENT readership, so "still read" is literally true, and
  - there is no confound from how long a file has been online, which a cumulative
    count would have had and which would have needed disclosing on the page.
The cost is that a 30-day window is noisy and seasonal (set texts spike in term
time), which is why `data/history.csv` keeps a weekly snapshot.
"""

import argparse
import csv
import html
import io
import re
import sys
import tarfile
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE = ROOT / ".cache"
HOSTS = ("https://www.gutenberg.org", "https://gutenberg.pglaf.org")
CATALOG = "/cache/epub/feeds/pg_catalog.csv"
FEED = "/cache/epub/feeds/rdf-files.tar.bz2"
UA = {"User-Agent": "lindy-curve/1.0 (+https://charlietrenorden.com)"}

ID = re.compile(r"pg(\d+)\.rdf$")
DOWNLOADS = re.compile(r"<pgterms:downloads[^>]*>(\d+)</pgterms:downloads>")
TITLE = re.compile(r"<dcterms:title>(.*?)</dcterms:title>", re.S)
TYPE = re.compile(r"<rdf:value>(\w+)</rdf:value>")
LANG = re.compile(r"<dcterms:language>.*?<rdf:value[^>]*>([\w-]+)</rdf:value>", re.S)
# ONLY the creator. The record also lists editors, translators and illustrators as
# agents, and taking "the first agent with dates" filed Aesop - whose own entry carries
# no dates - under his 1916 editor, putting a 6th-century-BC text among the moderns.
CREATOR = re.compile(r"<dcterms:creator>(.*?)</dcterms:creator>", re.S)
AGENT = re.compile(r"<pgterms:agent[^>]*>(.*?)</pgterms:agent>", re.S)
NAME = re.compile(r"<pgterms:name>(.*?)</pgterms:name>", re.S)
BIRTH = re.compile(r"<pgterms:birthdate[^>]*>(-?\d+)</pgterms:birthdate>")
DEATH = re.compile(r"<pgterms:deathdate[^>]*>(-?\d+)</pgterms:deathdate>")


def clean(t):
    """Unescape entities, collapse whitespace, normalise separator dashes.

    The unescape is not cosmetic: titles carry a literal `&#13;` where Gutenberg has a
    line break inside the field, so without it the site would render
    "The Odyssey&#13; Rendered into English prose".
    """
    t = html.unescape(t or "")
    t = re.sub(r"\s+", " ", t).strip()
    return t.replace("—", " - ").replace("–", "-").replace("  ", " ")


def date_work(birth, death):
    """Best available date for a TEXT, given only its AUTHOR's dates.

    Gutenberg publishes no composition or first-publication date - `dcterms:issued` is
    when Gutenberg released the file, not when the work was written. So the author is
    the only handle, and every date here is a proxy.

    Death alone is a poor choice: it is a true upper bound on when the author could have
    written, but for a long-lived author it understates the work's age badly. E. M.
    Forster wrote A Room with a View in 1908 and died in 1970, so death-dating makes a
    117-year-old book look 56 years old. Capping at birth + 50 pulls that to 1929, which
    is still wrong but wrong by 21 years instead of 62, and it removes a systematic bias
    that would otherwise compress the whole age axis toward the present.
    """
    if birth is not None and death is not None:
        return min(death, birth + 50)
    if death is not None:
        return death
    return birth + 40


# Library of Congress class letters, grouped into something a reader recognises.
# The RDF feed does not carry LoCC, so this comes from the separate catalogue CSV -
# one extra request, joined on the Gutenberg id.
LOC_GROUPS = [("P", "lit"), ("B", "phil"), ("Q", "sci"), ("D", "hist"),
              ("E", "hist"), ("F", "hist"), ("H", "social"), ("J", "social"),
              ("K", "social"), ("L", "social"), ("T", "sci"), ("R", "sci"),
              ("S", "sci"), ("G", "hist"), ("M", "arts"), ("N", "arts"),
              ("A", "ref"), ("C", "hist"), ("U", "hist"), ("V", "hist"),
              ("Z", "ref")]


def subjects():
    """id -> coarse subject group, from Gutenberg's catalogue CSV."""
    raw = open_first(CATALOG, 180).read().decode("utf-8-sig", "replace")
    out = {}
    for row in csv.DictReader(io.StringIO(raw)):
        code = (row.get("LoCC") or "").strip()
        if not code:
            continue
        letter = code[0].upper()
        for pre, grp in LOC_GROUPS:
            if letter == pre:
                try:
                    out[int(row["Text#"])] = grp
                except (ValueError, KeyError):
                    pass
                break
    return out


def open_first(path, timeout):
    """gutenberg.org returned 503 for two days from 17/11/2026; pglaf mirrors it."""
    for i, host in enumerate(HOSTS):
        try:
            return urllib.request.urlopen(urllib.request.Request(host + path, headers=UA),
                                          timeout=timeout)
        except (urllib.error.HTTPError, urllib.error.URLError) as exc:
            if i == len(HOSTS) - 1 or getattr(exc, "code", 500) < 500:
                raise
            print(f"  {host}: {exc}; trying {HOSTS[i + 1]}")


def download(dest):
    dest.parent.mkdir(exist_ok=True)
    with open_first(FEED, 600) as r, open(dest, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        got = 0
        while chunk := r.read(1 << 20):
            f.write(chunk)
            got += len(chunk)
            if total:
                pct = got / total * 100
                print(f"\r  {got / 1e6:6.1f} / {total / 1e6:.1f} MB  {pct:5.1f}%",
                      end="", flush=True)
    print()


def parse(archive):
    """Yield one dict per text. Streaming, because the archive holds ~79k members."""
    kept, skipped = [], {"not_text": 0, "no_date": 0, "no_downloads": 0}
    with tarfile.open(archive, "r|bz2") as tar:
        for i, member in enumerate(tar):
            m = ID.search(member.name)
            if not m:
                continue
            if i % 5000 == 0:
                print(f"\r  parsed {i:,} members, kept {len(kept):,}", end="", flush=True)
            raw = tar.extractfile(member)
            if raw is None:
                continue
            x = raw.read().decode("utf-8", "replace")

            kinds = TYPE.findall(x)
            if "Text" not in kinds:
                skipped["not_text"] += 1
                continue
            dl = DOWNLOADS.search(x)
            if not dl:
                skipped["no_downloads"] += 1
                continue

            # the creator's dates or nothing - never an editor's or translator's
            year = author = None
            creator_blocks = []
            for c in CREATOR.findall(x):
                creator_blocks.extend(AGENT.findall(c))
            for block in creator_blocks:
                b, d = BIRTH.search(block), DEATH.search(block)
                if not (b or d):
                    continue
                by = int(b.group(1)) if b else None
                dy = int(d.group(1)) if d else None
                year = date_work(by, dy)
                nm = NAME.search(block)
                author = clean(nm.group(1)) if nm else "?"
                break
            if year is None:
                skipped["no_date"] += 1
                continue

            t = TITLE.search(x)
            lg = LANG.search(x)
            kept.append({
                "id": int(m.group(1)),
                "year": year,
                "downloads": int(dl.group(1)),
                "title": clean(t.group(1))[:120] if t else "?",
                "author": (author or "?")[:80],
                "lang": lg.group(1) if lg else "?",
            })
    print()
    return kept, skipped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true",
                    help="re-download the archive even if cached")
    args = ap.parse_args()

    archive = CACHE / "rdf-files.tar.bz2"
    if args.refresh or not archive.exists():
        print(f"Downloading {FEED}")
        download(archive)
    else:
        print(f"Using cached {archive.name} ({archive.stat().st_size / 1e6:.1f}MB) "
              "- pass --refresh to re-download")

    print("Fetching the catalogue for subject classes")
    try:
        subj = subjects()
        print(f"  {len(subj):,} works carry a Library of Congress class")
    except Exception as exc:                       # noqa: BLE001
        print(f"  SKIPPED - {type(exc).__name__}: {exc}")
        subj = {}

    print("Parsing")
    rows, skipped = parse(archive)
    for r in rows:
        r["subject"] = subj.get(r["id"], "other")
    if not rows:
        sys.exit("No rows parsed - the feed format may have changed.")

    rows.sort(key=lambda r: -r["downloads"])
    DATA.mkdir(exist_ok=True)
    out = DATA / "corpus.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["id", "year", "downloads", "title",
                                          "author", "lang", "subject"])
        w.writeheader()
        w.writerows(rows)

    print(f"\nwrote {out.relative_to(ROOT)}  {len(rows):,} works  "
          f"{out.stat().st_size / 1e6:.1f}MB")
    print(f"skipped: {skipped}")
    print(f"\noldest 5:")
    for r in sorted(rows, key=lambda r: r["year"])[:5]:
        print(f"  {r['year']:>6}  {r['downloads']:>7,}  {r['author'][:26]:<26} "
              f"{r['title'][:44]}")
    print(f"most downloaded 5:")
    for r in rows[:5]:
        print(f"  {r['year']:>6}  {r['downloads']:>7,}  {r['author'][:26]:<26} "
              f"{r['title'][:44]}")


if __name__ == "__main__":
    main()
