"""Copies email/rsvp-received.html and .txt into apps-script/Code.gs.
Run after editing the email:  python3 scripts/embed-email.py
"""
import json, re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
html = (root / "email/rsvp-received.html").read_text()
html = re.sub(r"<!--.*?-->", "", html, flags=re.S)             # drop notes for editors
html = re.sub(r"\n\s*\n", "\n", html)
txt = (root / "email/rsvp-received.txt").read_text()
subject = re.search(r"^Subject:\s*(.+)$", txt, re.M).group(1).strip()
body = re.sub(r"^(Subject|Preheader):.*\n", "", txt, flags=re.M).lstrip()
block = ("// --- ARTIST EMAIL (generated from email/rsvp-received.* by scripts/embed-email.py; edit those files, not this block) ---\n"
         f"var ARTIST_EMAIL_SUBJECT = {json.dumps(subject)};\n"
         f"var ARTIST_EMAIL_TEXT = {json.dumps(body)};\n"
         f"var ARTIST_EMAIL_HTML = {json.dumps(html)};\n"
         "// --- END ARTIST EMAIL ---")
gs = root / "apps-script/Code.gs"
src = gs.read_text()
src = re.sub(r"// --- ARTIST EMAIL.*?// --- END ARTIST EMAIL ---", lambda m: block, src, flags=re.S)
gs.write_text(src)
print("embedded:", subject, "| html", len(html), "chars")
