# The Lindy Effect

Every book on Project Gutenberg, by age against how much it is being read right now.
Live at **https://charlietrenorden.com/lindy-effect/**

The Lindy effect says that for things which do not perish, age is evidence of staying
power. Books are the cleanest available test, because Gutenberg publishes a download count
per text. This measures it on 67,488 works.

## The finding

**Age barely predicts how much a surviving book is read.** Spearman(age, downloads) over
the whole corpus is **+0.110**, and on the 10,000 most-read works the fitted slope is
-0.054 with an r-squared of 0.0008. Whichever way it is cut, the relationship is close to
nothing.

The one place a real gradient shows is a **survival count** - how many books from each
century are still read above a threshold. At 1,000 a month, 50% of the works from Homer's
era clear it against 9.1% from the 1900s. That is the strongest Lindy-shaped signal here,
and it is also where the survivorship problem bites hardest: Gutenberg only holds the
ancient books somebody chose to digitise.

## Why the numbers move around

61.5% of the corpus sits in a narrow band between 300 and 600 downloads a month - 51,520
mostly obscure works, far too uniform to be human readership, and Gutenberg does not
document what it is. Raising a floor through that band swings the correlation from +0.110
to -0.104 and back across zero. **Any single correlation quoted from this dataset is a
choice of threshold**, which is why the page leads with charts rather than a number.

The Wikipedia cross-check was meant to escape that and does not. As the matched sample
grew from 159 to 355 works the two measures DIVERGED - Wikipedia's slope climbed from
+0.075 to +0.329 while Gutenberg's on the same books drifted to +0.086, and the match rate
fell from 43% to 36%. Only canonical works have an article, so that chart concentrates the
survivorship bias rather than avoiding it. It stays on the page as an illustration of the
problem.

## Layout

```
tools/fetch.py       RDF feed + catalogue CSV -> data/corpus.csv
tools/analyse.py     the experiment, printed to stdout - run it and read it
tools/compute.py     corpus.csv -> data/derived.json (+ one dated row in data/history.csv)
tools/wiki.py        Wikipedia pageviews for matchable works -> data/wiki.json
tools/build.py       derived.json + template.html + page.js -> docs/index.html
tools/og.py          the 1200x630 share card
tests/smoke.py       Playwright checks against the built page
```

```bash
python tools/fetch.py && python tools/compute.py && python tools/build.py \
  && python tools/og.py && python tests/smoke.py
```

## Things that bit, so they do not bite again

- **Do not use the gutendex API for the full corpus.** 32 books per page, no `page_size`,
  deep pages take 12 to 20 seconds - 2,472 requests. The RDF tarball is one request with
  the same download numbers (verified equal on three books) plus author dates. Subject
  classes need a second request to `pg_catalog.csv`, joined on the Gutenberg id.
- **`pgterms:downloads` is the last 30 days, not cumulative.** Gutenberg's own docs. That
  removes any advantage from having been online longer, but it is seasonal - hence
  `data/history.csv`.
- **Every age axis runs newest-left, oldest-right.** Three separate inversions shipped here
  before the guard covered the whole chart family rather than whichever one broke last.
  `tests/smoke.py` asserts it on the hero and the century chart.
- **Never decimate a scatter with a threshold.** An early version kept everything above
  1,500 downloads and every 94th below, which drew a hard fake edge across the plot at
  exactly 1,500. It is now the top 10,000 by readership, and the chart says so.
- **A maximum is not an average.** The century chart first plotted the single most-read
  work per age slot, so one outlier set every bar and it drew the canon rather than the
  corpus. It counts books above a threshold now.
- **Verify exit codes without a pipe.** `compute.py` and `og.py` both exited 1 for several
  commits while appearing to work, because the checks were piped through `grep` and the
  pipe's exit code masked them. The weekly job would have failed at those steps.
- **Dates are the author's, not the work's.** `issued` is the upload date, so dates come
  from the author's lifespan capped at birth + 50. Forster wrote A Room with a View in 1908
  and died in 1970; the cap turns a 62-year error into 21.
- **Titles carry entities and em dashes**, and were silently truncated in `compute.py`
  twice - which looked like a tooltip bug both times. Check the data before the view.
- **No `innerHTML`** - a security hook blocks it. Charts use `createElementNS`, text uses
  `textContent`.
- **No native SVG `<title>` elements** on interactive marks: the browser shows its own
  tooltip in the moment before the page script runs. Detail rides on data attributes.
