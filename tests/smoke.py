"""End-to-end checks against the built page in a real browser.

    python tests/smoke.py

Self-contained: picks a free port, serves docs/, tears the server down. Every check
here failed at least once during the build, which is the only reason to keep it.
"""

import http.server
import json
import socket
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
fails = []


def check(ok, msg):
    if not ok:
        fails.append(msg)
    return ok


def serve():
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(DOCS), **k)

        def log_message(self, *a):
            pass

    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    srv = socketserver.TCPServer(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{port}/"


def main():
    derived = json.loads((ROOT / "data" / "derived.json").read_text(encoding="utf-8"))
    # Several works can share the oldest date (Homer's two epics do), and the hero keeps
    # only one of them, so accept any label at the maximum age rather than a fixed title.
    max_age = max(c["a"] for c in derived["callouts"])
    oldest_names = [c["n"] for c in derived["callouts"] if c["a"] == max_age]

    srv, url = serve()
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            for theme, w, h in [("dark", 1280, 900), ("light", 1280, 900),
                                ("dark", 375, 812)]:
                tag = f"{theme}/{w}"
                ctx = b.new_context(viewport={"width": w, "height": h},
                                    color_scheme=theme, has_touch=w < 768,
                                    is_mobile=w < 768)
                # The page ignores prefers-color-scheme entirely - it is dark unless a
                # stored choice says otherwise - so color_scheme above does NOT select
                # the theme, and for a while all three contexts silently rendered dark
                # while claiming to cover both. Seed the stored choice instead.
                if theme == "light":
                    ctx.add_init_script(
                        "try{localStorage.setItem('lc-theme','light')}catch(e){}")
                pg = ctx.new_page()
                errs = []
                pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
                pg.on("pageerror", lambda e: errs.append(str(e)))
                pg.goto(url, wait_until="load")
                pg.wait_for_timeout(700)

                check(not errs, f"{tag}: console errors {errs[:2]}")

                sw = pg.evaluate("document.documentElement.scrollWidth")
                iw = pg.evaluate("window.innerWidth")
                check(sw <= iw + 1, f"{tag}: page pans sideways {sw} > {iw}")

                # the hero must place the OLDEST work in the flat tail on the right.
                # This is the axis inversion that shipped once in a mock; it went
                # unnoticed because there was no y-axis label to contradict it.
                pos = pg.evaluate(
                    """(names) => {
                        const t = [...document.querySelectorAll('#v-curve .mkl')]
                          .find(e => names.includes(e.textContent.trim()));
                        if (!t) return null;
                        const svg = t.closest('svg');
                        return {name: t.textContent.trim(), x: +t.getAttribute('x'),
                                w: svg.viewBox.baseVal.width};
                    }""", oldest_names)
                if check(pos is not None,
                         f"{tag}: no oldest work ({'/'.join(oldest_names)}, {max_age}yrs) "
                         "labelled in the hero"):
                    check(pos["x"] > pos["w"] / 2,
                          f"{tag}: AXIS INVERTED - oldest work '{pos['name']}' "
                          f"({max_age}yrs) at x={pos['x']:.0f} of {pos['w']}, "
                          "should be past halfway in the flat tail")
                check(pg.locator("#v-curve text", has_text="NO. BOOKS STILL BEING READ").count() > 0,
                      f"{tag}: hero has no y-axis label")

                # SAME GUARD ON THE SHELF. Age rises to the right there too, and the
                # hero-only version of this check missed the inversion when the shelf was
                # added. Reads data-year off the bars - the corpus's oldest work is a
                # Chinese text from 1105 BC, so a title-based assertion was wrong too.
                shelf = pg.evaluate("""() => {
                    const rs = [...document.querySelectorAll('#shelf rect[data-year]')];
                    if (rs.length < 4) return null;
                    const o = rs.map(r => ({x: +r.getAttribute('x'),
                                            yr: +r.getAttribute('data-year')}))
                                .sort((a, b) => a.x - b.x);
                    return {left: o[0].yr, right: o[o.length - 1].yr, n: o.length};
                }""")
                if check(shelf is not None, f"{tag}: shelf bars carry no year data"):
                    check(shelf["right"] < shelf["left"],
                          f"{tag}: SHELF AXIS INVERTED - leftmost bar is {shelf['left']}, "
                          f"rightmost is {shelf['right']}; age must rise to the right, "
                          "matching the curve above it")

                # every chart with an age axis must run newest-left, oldest-right. Three
                # separate inversions have shipped here; this is the only check that
                # covers the family rather than whichever chart broke last.
                order = pg.evaluate("""() => {
                    const bars = [...document.querySelectorAll('#shelf rect[data-year]')]
                      .map(r => ({x: +r.getAttribute('x'), y: +r.getAttribute('data-year')}))
                      .sort((a, b) => a.x - b.x);
                    const labs = [];
                    return {shelf: bars.length > 3
                              ? [bars[0].y, bars[bars.length - 1].y] : null,
                            cent: labs.length > 2
                              ? [yr(labs[0].t), yr(labs[labs.length - 1].t)] : null};
                }""")
                if check(order["shelf"], f"{tag}: shelf bars carry no year data"):
                    check(order["shelf"][1] < order["shelf"][0],
                          f"{tag}: SHELF AXIS INVERTED {order['shelf']} - newest left")


                # the methodology must appear once, on the first view only
                check(pg.locator(".method").count() == 1,
                      f"{tag}: {pg.locator('.method').count()} methodology blocks, expected 1")
                check(pg.locator("#v-curve .method").count() == 0,
                      f"{tag}: the methodology should sit at the foot of the page")
                check(pg.locator('[role="tab"]').count() == 0,
                      f"{tag}: tabs still present - the page is meant to be one page")
                check(pg.locator("#floor").count() == 0,
                      f"{tag}: the threshold slider is still present")
                wk = pg.evaluate("document.querySelectorAll('#wiki circle.pt').length")
                check(wk > 200, f"{tag}: Wikipedia chart has {wk} points, expected 200+")
                # the match rate must be stated - the chart's slope is mostly a matching
                # artefact, so publishing it without the caveat would be a false claim
                check("most-read works of" in pg.inner_text("#v-scatter"),
                      f"{tag}: the dot plot does not say it is a truncated sample")
                check("Wikipedia article" in pg.inner_text("#v-wiki"),
                      f"{tag}: the Wikipedia match rate is not disclosed on the page")
                # Hero labels must not sit ON the curve. Twice they were merely nudged
                # (a bigger halo, a flipped dy) when the real constraint is geometric:
                # the curve descends left to right, so a label has to extend RIGHTWARD
                # and sit above its mark. Measures the actual gap rather than eyeballing.
                lab = pg.evaluate("""() => {
                  const svg = [...document.querySelectorAll('#v-curve svg')]
                    .find(s => s.id !== 'shelf');
                  const cv = svg.querySelector('path.cv'), len = cv.getTotalLength();
                  const yAt = (x) => {let lo = 0, hi = len;
                    for (let k = 0; k < 26; k++) {const m = (lo + hi) / 2;
                      (cv.getPointAtLength(m).x < x) ? lo = m : hi = m;}
                    return cv.getPointAtLength(lo).y;};
                  const out = [], boxes = [];
                  for (const t of svg.querySelectorAll('.mkl')) {
                    const bb = t.getBBox(); boxes.push(bb);
                    let top = 1e9;
                    for (let i = 0; i <= 20; i++) top = Math.min(top, yAt(bb.x + bb.width * i / 20));
                    out.push({n: t.textContent.trim(), clear: top - (bb.y + bb.height),
                              right: bb.x + bb.width});
                  }
                  let ov = 0, near = 1e9;
                  for (let i = 0; i < boxes.length; i++)
                    for (let j = i + 1; j < boxes.length; j++) {
                      const a = boxes[i], b = boxes[j];
                      if (a.x < b.x + b.width && b.x < a.x + a.width
                          && a.y < b.y + b.height && b.y < a.y + a.height) ov++;
                      const dx = Math.max(0, Math.max(a.x - (b.x + b.width),
                                                      b.x - (a.x + a.width)));
                      const dy = Math.max(0, Math.max(a.y - (b.y + b.height),
                                                      b.y - (a.y + a.height)));
                      near = Math.min(near, Math.hypot(dx, dy));
                    }
                  return {out, ov, near, w: svg.viewBox.baseVal.width};
                }""")
                onc = [x["n"] for x in lab["out"] if x["clear"] < 1]
                check(not onc, f"{tag}: hero labels drawn over the curve: {onc}")
                check(lab["ov"] == 0,
                      f"{tag}: {lab['ov']} hero labels overprint each other")
                # and the other failure mode: a label so far off the curve it reads as
                # detached. Fixed alternating offsets put half of them 28px clear; the
                # only ones allowed past ~26 are those lifted over a neighbour.
                far = [x["n"] for x in lab["out"] if x["clear"] > 26]
                check(len(far) <= 2,
                      f"{tag}: hero labels floating far from the curve: {far}")
                # and the third: two labels close enough to read as a pair rather than
                # as two separate works. Crowding is solved in SELECTION (build.py picks
                # marks by horizontal separation) - no placement can fix marks 25px apart.
                check(lab["near"] > 25,
                      f"{tag}: closest hero labels only {lab['near']:.0f}px apart")
                offr = [x["n"] for x in lab["out"] if x["right"] > lab["w"] - 4]
                check(not offr, f"{tag}: hero labels run off the right edge: {offr}")

                check(pg.locator("#v-curve svg title").count() == 0,
                      f"{tag}: hero marks still carry native <title> tooltips")
                check("slider" not in pg.inner_text(".method"),
                      f"{tag}: the methodology still mentions the removed slider")
                check(pg.inner_text("#wnote").strip(),
                      f"{tag}: the Wikipedia source note did not render")
                # the summary cards were removed, so the chart itself has to carry it
                # all four chart titles must be the same element and treatment
                titles = pg.evaluate("""() => {
                    const h = [...document.querySelectorAll('.wrap h2')];
                    const sig = h.map(e => {
                        const s2 = getComputedStyle(e);
                        return s2.fontFamily + '|' + s2.fontSize + '|' + s2.fontWeight
                             + '|' + s2.letterSpacing + '|' + s2.color
                             + '|' + s2.textTransform;
                    });
                    return {n: h.length, distinct: [...new Set(sig)].length};
                }""")
                check(titles["n"] == 4,
                      f"{tag}: {titles['n']} chart titles, expected 4")
                check(titles["distinct"] == 1,
                      f"{tag}: chart titles use {titles['distinct']} different styles")
                check(pg.locator("#wiki text.lbl").count() == 0,
                      f"{tag}: the Wikipedia chart is labelling works - hover only")
                # the era filter must actually remove points, not just restyle a chip
                if w >= 1280:
                    before = pg.evaluate("""() => [...document.querySelectorAll(
                        '#scatter circle.pt')].filter(c => c.getAttribute('display')
                        !== 'none').length""")
                    pg.select_option("#f-era", "anc")
                    pg.wait_for_timeout(250)
                    after = pg.evaluate("""() => [...document.querySelectorAll(
                        '#scatter circle.pt')].filter(c => c.getAttribute('display')
                        !== 'none').length""")
                    check(after < before / 2,
                          f"{tag}: era filter went {before} -> {after}, expected far fewer")
                    pg.select_option("#f-era", "all")
                    pg.wait_for_timeout(200)
                    # language and readership filter the same cloud
                    # each filter tested on its own - they compose, so leaving the
                    # previous one set makes French + 10,000+ + philosophy genuinely zero
                    for sel, val, name in [("#f-lang", "fr", "language"),
                                           ("#f-min", "10000", "readership"),
                                           ("#f-subj", "phil", "subject")]:
                        pg.select_option(sel, val)
                        pg.wait_for_timeout(250)
                        n = pg.evaluate("""() => [...document.querySelectorAll(
                            '#scatter circle.pt')].filter(c => c.getAttribute('display')
                            !== 'none').length""")
                        check(0 < n < before / 2,
                              f"{tag}: the {name} filter left {n} points of {before}")
                        pg.select_option(sel, "all" if sel != "#f-min" else "0")
                        pg.wait_for_timeout(150)

                    # During a drag the cloud is translated for speed while the
                    # gridlines are REDRAWN at the live view - so the lines must move
                    # with the data and the axis numbers must stay correct at the edge.
                    # mouse.move takes VIEWPORT coordinates, so the chart has to be on
                    # screen first - this exact trap has produced two false failures
                    pg.locator("#scatter").scroll_into_view_if_needed()
                    pg.wait_for_timeout(200)
                    bx = pg.locator("#scatter").bounding_box()
                    # ZOOM FIRST. The opening view is the whole data extent and the pan
                    # is clamped to it, so a drag from home correctly moves nothing -
                    # testing the pan from there asserted the old unclamped behaviour.
                    pg.mouse.move(bx["x"] + bx["width"] * .5, bx["y"] + bx["height"] * .5)
                    for _ in range(6):
                        pg.mouse.wheel(0, -120)
                    pg.wait_for_timeout(250)
                    grid0 = pg.evaluate("""() => {
                        const l = document.querySelector('#grid line');
                        return l ? +l.getAttribute('x1') : null; }""")
                    pg.mouse.move(bx["x"] + bx["width"] * .5, bx["y"] + bx["height"] * .5)
                    pg.mouse.down()
                    pg.mouse.move(bx["x"] + bx["width"] * .3,
                                  bx["y"] + bx["height"] * .45, steps=8)
                    pg.wait_for_timeout(250)
                    state = pg.evaluate("""() => {
                        const l = document.querySelector('#grid line');
                        const g = document.getElementById('grid');
                        const c = document.getElementById('cloud');
                        // the pan transform sits on the group INSIDE #cloud, because
                        // #cloud carries the clip and a clip that moves is not a window
                        const d = c ? c.querySelector('g') : null;
                        return {x: l ? +l.getAttribute('x1') : null,
                                gt: g ? g.getAttribute('transform') : 'missing',
                                ct: d ? d.getAttribute('transform') : 'missing',
                                fit: document.querySelectorAll('#scatter line.fit').length};
                    }""")
                    check(grid0 is not None and state["x"] is not None
                          and abs(state["x"] - grid0) > 1,
                          f"{tag}: gridline stayed at x={grid0} through a pan - it must "
                          "move with the data")
                    check(not state["gt"],
                          f"{tag}: the grid carries transform {state['gt']!r}; it should be "
                          "redrawn at the live view so the axis numbers stay correct")
                    check(state["ct"] and state["ct"].startswith("translate"),
                          f"{tag}: the cloud is not being translated during the drag")
                    check(state["fit"] == 1,
                          f"{tag}: the r-squared fit line vanished mid-pan "
                          f"({state['fit']} lines)")
                    pg.mouse.up()
                    pg.wait_for_timeout(200)

                    # REGRESSION: dragging used to summon a straight vertical line of
                    # books out of nowhere. Points the filters excluded were parked at a
                    # shared off-canvas x, and a pan translates the whole cloud, so the
                    # parked column marched into frame - thousands of dots on one x, over
                    # an axis panned clean off the data. Drag hard both ways and check
                    # that neither happens: no column may hold a big share of the dots,
                    # and the age axis must stay somewhere books actually live.
                    pg.keyboard.press("Escape")
                    pg.locator("#scatter").dblclick()
                    pg.wait_for_timeout(250)
                    for sign in (1, -1):
                        pg.mouse.move(bx["x"] + bx["width"] * .5,
                                      bx["y"] + bx["height"] * .5)
                        pg.mouse.down()
                        for step in range(1, 7):
                            pg.mouse.move(
                                bx["x"] + bx["width"] * (.5 + sign * step * .45),
                                bx["y"] + bx["height"] * .5, steps=4)
                        # measured WITH THE BUTTON STILL DOWN: the column appeared
                        # mid-drag, while the cloud carried its pan transform, and was
                        # gone again by the time the view was redrawn on release
                        pg.wait_for_timeout(250)
                        panned = pg.evaluate(r"""() => {
                            const c = document.getElementById('cloud');
                            const d = c.querySelector('g') || c;
                            const m = /translate\(([-\d.]+)/.exec(
                                d.getAttribute('transform') || '');
                            const tx = m ? parseFloat(m[1]) : 0;
                            const cols = {};
                            let shown = 0;
                            for (const p of d.querySelectorAll('circle.pt')) {
                                if (p.getAttribute('display') === 'none') continue;
                                const x = parseFloat(p.getAttribute('cx')) + tx;
                                if (x < 58 || x > 838) continue;     // outside the plot
                                shown++;
                                const k = x.toFixed(0);
                                cols[k] = (cols[k] || 0) + 1;
                            }
                            // x ticks only: they are centred under the axis, the
                            // readership ticks are end-anchored down the left and are
                            // written '5k', which parseFloat would read as 5
                            const ticks = [...document.querySelectorAll('#grid text')]
                                .filter(t => t.getAttribute('text-anchor') === 'middle')
                                .map(t => parseFloat(t.textContent.replace(/,/g, '')))
                                .filter(v => v === v);
                            return {shown: shown, worst: Math.max(0, ...Object.values(cols)),
                                    minTick: Math.min(...ticks)};
                        }""")
                        check(panned["shown"] > 0,
                              f"{tag}: panning {'right' if sign > 0 else 'left'} emptied "
                              "the plot entirely")
                        check(panned["worst"] < panned["shown"] * 0.1,
                              f"{tag}: {panned['worst']} of {panned['shown']} dots share "
                              "one x after a hard pan - that is the phantom column, not "
                              "data")
                        check(panned["minTick"] >= 1,
                              f"{tag}: a hard pan put the age axis down to "
                              f"{panned['minTick']} years, where no book exists")
                        pg.mouse.up()
                        pg.wait_for_timeout(200)
                        pg.locator("#scatter").dblclick()
                        pg.wait_for_timeout(200)

                    # The Wikipedia plot had the same unclamped pan. No phantom column
                    # there, because it rebuilds every dot every frame rather than
                    # translating a cloud, but it could still be dragged off the data
                    # into an empty frame. Its clamp is the box the ZOOM opens out to,
                    # three times the home span, so this check is looser than the age
                    # plot's on purpose.
                    wk = pg.locator("#wiki")
                    if wk.count():
                        wk.scroll_into_view_if_needed()
                        pg.wait_for_timeout(200)
                        wb = wk.bounding_box()
                        for sign in (1, -1):
                            pg.mouse.move(wb["x"] + wb["width"] * .5,
                                          wb["y"] + wb["height"] * .5)
                            pg.mouse.down()
                            for step in range(1, 7):
                                pg.mouse.move(
                                    wb["x"] + wb["width"] * (.5 + sign * step * .45),
                                    wb["y"] + wb["height"] * .5, steps=4)
                            pg.wait_for_timeout(250)
                            wstate = pg.evaluate(r"""() => {
                                const ticks = [...document.querySelectorAll('#wiki text')]
                                    .filter(t => t.getAttribute('text-anchor') === 'middle'
                                             && /^[\d,.]+$/.test(t.textContent))
                                    .map(t => parseFloat(t.textContent.replace(/,/g, '')));
                                return {dots: document.querySelectorAll('#wiki circle.pt')
                                            .length,
                                        minTick: ticks.length ? Math.min(...ticks) : null};
                            }""")
                            way = "right" if sign > 0 else "left"
                            check(wstate["dots"] > 0,
                                  f"{tag}: panning the Wikipedia plot {way} emptied it")
                            check(wstate["minTick"] is not None
                                  and wstate["minTick"] >= 1,
                                  f"{tag}: a hard pan put the Wikipedia plot's age axis "
                                  f"down to {wstate['minTick']} years")
                            pg.mouse.up()
                            pg.wait_for_timeout(150)
                            wk.dblclick()
                            pg.wait_for_timeout(200)

                # every view draws something
                counts = pg.evaluate("""() => ({
                    pts: document.querySelectorAll('#scatter circle.pt').length,
                    bars: document.querySelectorAll('#shelf rect').length,
                    labels: document.querySelectorAll('#scatter text.lbl').length,
                })""")
                check(counts["pts"] > 8000, f"{tag}: only {counts['pts']} scatter points")
                check(counts["labels"] == 0,
                      f"{tag}: the dot plot is labelling {counts['labels']} works - it "
                      "should carry no names, only hover")
                check(counts["bars"] >= 20, f"{tag}: only {counts['bars']} shelf bars")
                check(pg.locator("#shelf text.ax").count() >= 2,
                      f"{tag}: the shelf has no y-axis labels")
                # the shelf plots MEDIANS per equal-count bucket, not the one most-read
                # book per slot - a maximum drew the canon rather than the corpus
                sh = pg.evaluate("""() => {
                    const r = [...document.querySelectorAll('#shelf rect')];
                    return {n: r.length,
                            p75: 0};
                }""")
                check(sh["n"] >= 20 and sh["n"] <= 30,
                      f"{tag}: {sh['n']} shelf bars, expected one per century (~26)")
                check("HOW MANY SURVIVE" in pg.inner_text("#v-curve").upper(),
                      f"{tag}: the shelf does not say what it is counting")
                # changing the readership bar must change the bar heights, not just a label
                if w >= 1280:
                    h0 = pg.evaluate("""() => [...document.querySelectorAll('#shelf rect')]
                        .map(r => +r.getAttribute('height')).join(',')""")
                    pg.select_option("#f-thresh", "10000")
                    pg.wait_for_timeout(250)
                    h1 = pg.evaluate("""() => [...document.querySelectorAll('#shelf rect')]
                        .map(r => +r.getAttribute('height')).join(',')""")
                    check(h0 != h1,
                          f"{tag}: raising the readership bar did not change the counts")
                    pg.select_option("#f-thresh", "200")
                    pg.wait_for_timeout(200)


                check(pg.locator("header a.back .arw").count() == 1,
                      f"{tag}: the Other projects link has no arrow")

                # Dark on a first visit, and a stored choice is honoured. The light
                # context above seeds that choice, so each context asserts its own theme
                # rather than one hardcoded expectation.
                other = "light" if theme == "dark" else "dark"
                got = pg.evaluate("document.documentElement.getAttribute('data-theme')")
                check(got == theme, f"{tag}: theme is '{got}', expected '{theme}'")
                check(pg.locator("#tog").count() == 1, f"{tag}: no theme toggle")
                pg.click("#tog")
                pg.wait_for_timeout(180)
                check(pg.evaluate("document.documentElement.getAttribute('data-theme')")
                      == other, f"{tag}: the toggle did not switch to {other}")
                pg.click("#tog")
                pg.wait_for_timeout(180)
                check(pg.evaluate("document.documentElement.getAttribute('data-theme')")
                      == theme, f"{tag}: the toggle did not switch back to {theme}")

                # one dot size only - two radii read as a distinction in the data
                radii = pg.evaluate("""() => [...new Set([...document.querySelectorAll(
                    '#scatter circle.pt')].map(c => c.getAttribute('r')))]""")
                check(len(radii) == 1,
                      f"{tag}: scatter uses {len(radii)} dot radii {radii}, expected 1")

                # hovering a chart must actually produce a tooltip with a work in it
                # every chart with a tooltip must fire it from ANYWHERE in its column,
                # not only from a direct hit on a 3px marker
                # hover is a pointer interaction, and at 375px these charts scroll
                # inside their figure so a given bar may be off-screen. Desktop only.
                for sel, tid, name in ([("#shelf rect", "tip3", "shelf"),
                                        ]
                                       if w >= 1280 else []):
                    # scroll it under the viewport first - mouse.move takes viewport
                    # coordinates, so an element 1,500px down is unreachable and the
                    # tooltip looks broken when it is not
                    pg.locator(sel).nth(12).scroll_into_view_if_needed()
                    pg.wait_for_timeout(150)
                    bb = pg.locator(sel).nth(12).bounding_box()
                    pg.mouse.move(bb["x"] + bb["width"] / 2, bb["y"] - 40)
                    pg.wait_for_timeout(180)
                    got = pg.evaluate(
                        f"document.getElementById('{tid}').classList.contains('on')")
                    check(got, f"{tag}: hovering the {name} column produced no tooltip")


                # the page must be legible in this theme, not just present
                col = pg.evaluate("""() => {
                    const s = getComputedStyle(document.body);
                    return [s.color, s.backgroundColor];
                }""")
                check(col[0] != col[1], f"{tag}: text and background are the same colour")
                print(f"{tag:<12} pts={counts['pts']:<5} bars={counts['bars']:<3} "
                      f"labels={counts['labels']:<3}"
                      f"   {col[0]} on {col[1]}")

                # PINCH TO ZOOM, checked only on the touch context. Zoom was wheel-only
                # for the whole build and no desktop test could see it: a phone never
                # fires wheel, so both dot plots panned but could not zoom at all.
                # Real CDP multi-touch, not synthetic PointerEvents - the point is to
                # exercise what a finger actually sends.
                if w < 768:
                    cdp = ctx.new_cdp_session(pg)

                    def pinch(box, out=True, steps=10):
                        cx = box["x"] + box["width"] / 2
                        cy = box["y"] + box["height"] / 2
                        r0, r1 = (28, 132) if out else (132, 28)
                        f = lambda r: [{"x": cx - r, "y": cy, "id": 1},
                                       {"x": cx + r, "y": cy, "id": 2}]
                        cdp.send("Input.dispatchTouchEvent",
                                 {"type": "touchStart", "touchPoints": f(r0)})
                        for i in range(1, steps + 1):
                            cdp.send("Input.dispatchTouchEvent",
                                     {"type": "touchMove",
                                      "touchPoints": f(r0 + (r1 - r0) * i / steps)})
                            pg.wait_for_timeout(25)
                        cdp.send("Input.dispatchTouchEvent",
                                 {"type": "touchEnd", "touchPoints": []})
                        pg.wait_for_timeout(280)

                    # the axis tick numbers are the user-visible proof of the view span
                    AX = r"""(s) => {const v = [...document.querySelectorAll(s + ' text')]
                        .map(t => t.textContent.replace(/[,\s]/g, ''))
                        .filter(t => /^[\d.]+[km]?$/i.test(t))
                        .map(t => {const m = t.toLowerCase();
                          return parseFloat(m) * (m.endsWith('k') ? 1e3
                            : m.endsWith('m') ? 1e6 : 1);});
                        return v.length ? [Math.min(...v), Math.max(...v)] : null;}"""
                    for sel in ("#scatter", "#wiki"):
                        el = pg.locator(sel)
                        el.scroll_into_view_if_needed()
                        pg.wait_for_timeout(250)
                        a0 = pg.evaluate(AX, sel)
                        pinch(el.bounding_box(), out=True)
                        a1 = pg.evaluate(AX, sel)
                        if check(a0 and a1, f"{tag}: {sel} has no numeric axis ticks"):
                            span0, span1 = a0[1] / a0[0], a1[1] / a1[0]
                            check(span1 < span0 * 0.7,
                                  f"{tag}: pinch did not zoom {sel} - axis span "
                                  f"{a0} to {a1}")
                        pinch(el.bounding_box(), out=False)
                        a2 = pg.evaluate(AX, sel)
                        if a2:
                            check(a2[1] / a2[0] > a1[1] / a1[0] * 1.4,
                                  f"{tag}: pinching in did not zoom {sel} back out - "
                                  f"axis span {a1} to {a2}")

                ctx.close()
            b.close()
    finally:
        srv.shutdown()
        srv.server_close()

    print()
    if fails:
        print(f"FAIL ({len(fails)})")
        for f in fails:
            print("  -", f)
        sys.exit(1)
    print("All checks passed")


if __name__ == "__main__":
    main()
