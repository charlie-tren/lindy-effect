"""Render docs/og.png, the 1200x630 card that LinkedIn and WhatsApp unfurl.

    python tools/og.py

Built from the live page's own hero curve and palette so the card looks like the site
rather than like a generic banner. Run after build.py; the page references og.png in its
meta tags, so without this a shared link shows a broken image.
"""

import json
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
W, H = 1200, 630


def main():
    page_html = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")
    # the hero figure gained an id and a tooltip div, which broke the old anchored
    # pattern - match the svg by its aria-label instead, which is what identifies it
    hero = re.search(r'(<svg viewBox="0 0 960 \d+" role="img" '
                     r'aria-label="The classic Lindy curve.*?</svg>)',
                     page_html, re.S)
    if not hero:
        raise SystemExit("could not find the hero svg in docs/index.html")
    derived = json.loads((ROOT / "data" / "derived.json").read_text(encoding="utf-8"))
    works = f"{derived['corpus']['works']:,}"
    rho_all = next(s["rho"] for s in derived["states"] if s["floor"] == 0)

    card = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
:root{{--ground:#100D0A;--ink:#EDE3CE;--dim:#A08F72;--faint:#6E6049;--rule:#3B3125;
--gilt:#C9A961;--ox:#B4453A;
--body:Georgia,"Palatino Linotype",serif;--disp:"Arial Narrow",Helvetica,sans-serif;
--mono:"Courier New",monospace}}
*{{box-sizing:border-box}}
body{{margin:0;width:{W}px;height:{H}px;background:var(--ground);color:var(--ink);
font-family:var(--body);display:flex;flex-direction:column;padding:44px 52px 38px}}
.top{{display:flex;align-items:baseline;justify-content:space-between;
border-bottom:1px solid var(--rule);padding-bottom:16px}}
.wm{{font-size:52px;font-variant:small-caps;letter-spacing:.075em;line-height:1}}
.host{{font:400 15px var(--mono);color:var(--dim);letter-spacing:.06em}}
.mid{{flex:1;display:flex;gap:40px;align-items:center;padding-top:10px}}
.chart{{flex:1;min-width:0}}
.chart svg{{width:100%;height:auto;display:block}}
.say{{width:330px;display:flex;flex-direction:column;gap:14px}}
.q{{font-size:27px;line-height:1.25}}
.q b{{color:var(--gilt);font-weight:400}}
.num{{display:flex;align-items:baseline;gap:12px}}
.num span:first-child{{font-size:44px;color:var(--ox);
font-variant-numeric:tabular-nums;line-height:1}}
.num span:last-child{{font:700 12px var(--disp);letter-spacing:.13em;
text-transform:uppercase;color:var(--dim);line-height:1.35}}
.foot{{font:700 12px var(--disp);letter-spacing:.16em;text-transform:uppercase;
color:var(--faint);border-top:1px solid var(--rule);padding-top:14px}}
.axl{{font:700 9px var(--disp);letter-spacing:.16em;fill:var(--dim)}}
.ax{{font:400 10px var(--mono);fill:var(--dim)}}
.g{{stroke:var(--rule);stroke-width:1}}
.cv{{fill:none;stroke:var(--gilt);stroke-width:2.6}}
.cvf{{fill:var(--gilt);opacity:.10}}
.mk{{fill:var(--ox)}}
.mkl{{font:400 11.5px var(--body);fill:var(--ink)}}
.note{{font:italic 400 13px var(--body);fill:var(--dim)}}
.lead{{stroke:var(--dim);stroke-width:1}}
</style></head><body>
<div class="top"><span class="wm">The Lindy Effect</span>
<span class="host">charlietrenorden.com</span></div>
<div class="mid">
  <div class="chart">{hero.group(1)}</div>
  <div class="say">
    <div class="q">Does an old book <b>stay</b> read?</div>
    <div class="num"><span>{rho_all:+.3f}</span>
      <span>correlation between<br>age and readers</span></div>
    <div class="q" style="font-size:17px;color:var(--dim);line-height:1.45">
      {works} works, and age predicts almost nothing.</div>
  </div>
</div>
<div class="foot">Project Gutenberg &#183; downloads in the last 30 days</div>
</body></html>"""

    dest = ROOT / "docs" / "og.png"
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_context(viewport={"width": W, "height": H},
                           device_scale_factor=1).new_page()
        pg.set_content(card, wait_until="load")
        pg.wait_for_timeout(500)
        pg.screenshot(path=str(dest))
        b.close()

    print(f"wrote docs/og.png  {dest.stat().st_size / 1024:.0f}KB  {W}x{H}")
    print(f"  headline rho {rho_all:+.3f} over the whole corpus")


if __name__ == "__main__":
    main()
