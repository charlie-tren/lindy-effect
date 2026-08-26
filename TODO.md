# The Lindy Effect - TODO

Deferred work for the Lindy Effect (charlietrenorden.com/lindy-effect/). The site is live.

## Extend beyond books (moved here from hub-notes 14/08/2026)

Lived in the hub TODO while this was still an idea; it belongs with the build now that
the books version has shipped.

- [ ] **Extend the Lindy screener beyond books - films, songs, other art forms**
      (asked 07/08/2026, after the books version was scoped). The same question asked of
      other media: what is still watched, still listened to, still looked at, and how does
      that decay with age. Do NOT start until the books version ships - it is the template.
      THE DATA IS THE WHOLE PROBLEM, and it is harder than books, because Gutenberg's
      `download_count` is a rare thing: a free, uniform, genuinely behavioural popularity
      signal with no licence attached. Probe before designing anything:
        - **Films.** TMDB has a free keyed API with `vote_count` and `popularity`, plus
          release dates - the closest analogue. Popularity is a rolling proprietary index
          rather than a count, so `vote_count` is the more honest axis. IMDb ratings are
          not licensed for redistribution; check TMDB's attribution terms before publishing.
        - **Songs.** The awkward one. Spotify play counts are not in the public API and
          chart data is heavily licensed. MusicBrainz plus **ListenBrainz** listen counts is
          the free, open, redistributable route, but its user base is small and skewed, so
          say so on the page. Last.fm scrobbles are an alternative with the same caveat.
        - **Art and architecture.** Wikimedia Commons file view counts, or Wikipedia
          pageviews via the free REST API. Pageviews are a decent cross-medium currency and
          would actually let a single chart hold books, films and songs on one axis - worth
          considering as the unifying signal rather than four incomparable ones.
      **The survivorship problem is much worse here.** Gutenberg at least holds obscure
      survivors; TMDB and streaming catalogues are curated, so the dead are missing even more
      completely. And recorded music only goes back ~120 years, so there is no deep-time
      axis at all - a Lindy curve over a century is a different and weaker claim.
      Sequencing thought: rather than four separate pages, the interesting version is ONE
      explorer with a medium toggle on a shared pageviews axis. That reuses the whole books
      build and makes the cross-medium comparison the actual product.

## The smoke suite cannot go green on a laptop (found 26/08/2026)

- [ ] **Let `tests/smoke.py` ignore the analytics beacons' CORS errors when it is not
      running against the live origin.** Since the Cloudflare Web Analytics beacon landed
      (`ed96b24`), every local run reports `FAIL (3)` - one per theme/width - because
      `cloudflareinsights.com` refuses a preflight from `http://127.0.0.1:<random port>`
      and the console-error check catches it. The failure is real in the sense that the
      request really fails, and entirely uninformative: it fails identically on a clean
      checkout and on broken code.
      **Why it matters more than it looks.** A suite that always prints FAIL is a suite
      whose output nobody reads, so the next genuine regression arrives inside a number
      that was already red. The chart-pan fix on 26/08 needed a baseline run against an
      untouched tree purely to work out which three of the failures were furniture.
      The fix is to filter console errors whose URL is a known third-party beacon host
      when `base` is localhost, and to keep asserting them when it runs against the
      deployed page. Do NOT simply drop the console-error check: it is the only thing
      that would catch a real script error on the page.
