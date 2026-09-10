#!/usr/bin/env python3
"""Build-time rebrand of the Hermes web console (hermes_cli/web_dist).

Hermes "skins" are CLI-only; the web console has a theme system for colours
and fonts but every piece of text is compiled into the SPA. So: rewrite the
text. Only STRING LITERALS are touched (backtick / double / single quoted),
never identifiers — `updateHermes:` keys and `__HERMES_AUTH_REQUIRED__` must
keep working — and lowercase `hermes` (URLs, paths like /opt/data) is left
alone. The sidebar wordmark is a JSX fragment [`Hermes`, <br/>, `Agent`] and
is handled explicitly. Counts are asserted so a base bump that changes the
bundle shape fails the build rather than shipping a half-branded console.

The channel catalogue ("Run Hermes from Telegram DMs…") is served by the
Python side, so the same literal-only rewrite runs over web_server.py too.

The TUI (ui-tui/dist/entry.js) hardcodes the banner tagline and the
" · Nous Research" model line, and banner.py hardcodes the latter for the
classic CLI; both get the same literal-only rewrite. Logo, hero art, colours
and agent_name for the CLI/TUI come from docker/agent/skin.yaml at runtime.

Usage: brand.py <web_dist> <icon.svg> <hermes_cli dir> <ui-tui/dist/entry.js>
(cli.py is resolved as <hermes_cli dir>/../cli.py)
"""
import glob
import re
import shutil
import sys

dist, icon, cli_dir, tui_js = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
server_py = f"{cli_dir}/web_server.py"
banner_py = f"{cli_dir}/banner.py"

# "Nous Research \\xB7 Messenger of the Digital Gods" in the TUI: the org half is
# covered by ORG below, the epithet needs its own line.
TAGLINES = {"Messenger of the Digital Gods": "decentralised, auditable agents"}

WORDMARK = re.compile(r"children:\[`Hermes`,\(0,[A-Za-z_$][\w$]*\.jsx\)\(`br`,\{\}\),`Agent`\]")
STRING = re.compile(r"`[^`]*`|\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'")


# Standalone word only: "X-Hermes-Session-Token", "hermes_home", "HermesLogo"
# are protocol/identifier text and must survive (the first one is how the SPA
# authenticates every API call).
WORD = re.compile(r"(?<![\w-])Hermes(?: Agent)?(?![\w-])")
ORG = re.compile(r"(?<![\w-])Nous Research(?![\w-])")
# Outbound links: the brand site and the Hermes docs go to decenchro.com.
# portal./setup./inference-api. are auth and API infrastructure, not links a
# tenant should follow, so they are deliberately NOT rewritten.
LINK = re.compile(r"https://(?:www\.|hermes-agent\.)?nousresearch\.com(?![\w.-])[^\s\"'`)\\]*")


def relink(s):
    return LINK.sub("https://decenchro.com", s)


def rebrand_literal(m):
    s = m.group(0)
    for old, new in TAGLINES.items():
        s = s.replace(old, new)
    s = relink(s)
    if "Hermes" not in s and "Nous Research" not in s:
        return s
    return WORD.sub("Decenchro", ORG.sub("Decenchro", s))


def rebrand_python(path):
    """Rewrite string tokens only, via the real tokenizer (a regex desyncs on
    apostrophes inside literals). Returns occurrences removed."""
    import io
    import py_compile
    import tokenize

    py = open(path, encoding="utf-8").read()
    before = py.count("Hermes") + py.count("Nous Research")
    out = []
    # f-strings tokenize as FSTRING_MIDDLE pieces on 3.12+, not STRING — the
    # banner title and the "· Nous Research" model line are both f-strings.
    literal_types = {tokenize.STRING, getattr(tokenize, "FSTRING_MIDDLE", -1)}
    for tok in tokenize.generate_tokens(io.StringIO(py).readline):
        if tok.type in literal_types and ("Hermes" in tok.string or "Nous Research" in tok.string or "nousresearch.com" in tok.string):
            out.append(tok._replace(string=WORD.sub("Decenchro", ORG.sub("Decenchro", relink(tok.string)))))
        else:
            out.append(tok)
    py = tokenize.untokenize(out)
    open(path, "w", encoding="utf-8").write(py)
    py_compile.compile(path, doraise=True)
    still = sum(
        len(WORD.findall(t.string)) + len(ORG.findall(t.string)) + len(LINK.findall(t.string))
        for t in tokenize.generate_tokens(io.StringIO(py).readline)
        if t.type in literal_types
    )
    assert still == 0, f"brand: {still} brand words left in {path} strings"
    return before - (py.count("Hermes") + py.count("Nous Research"))


total_wordmarks = 0
total_literals = 0
for path in sorted(glob.glob(f"{dist}/assets/*.js")):
    src = open(path, encoding="utf-8").read()
    src, n = WORDMARK.subn("children:[`Decenchro`]", src)
    total_wordmarks += n
    before = src.count("Hermes")
    src = STRING.sub(rebrand_literal, src)
    total_literals += before - src.count("Hermes")
    open(path, "w", encoding="utf-8").write(src)

assert total_wordmarks == 1, f"brand: expected 1 sidebar wordmark, found {total_wordmarks}"
assert total_literals > 100, f"brand: only {total_literals} string replacements — bundle shape changed?"
joined = sum(open(p, encoding="utf-8").read().count("X-Hermes-Session-Token") for p in glob.glob(f"{dist}/assets/*.js"))
assert joined >= 1, "brand: the X-Hermes-Session-Token header literal must survive or every API call 401s"
leftover = sum(open(p, encoding="utf-8").read().count("`Hermes ") for p in glob.glob(f"{dist}/assets/*.js"))
assert leftover == 0, f"brand: {leftover} template literals still start with 'Hermes '"

# Whole-file check for the bundles; Python is checked per string token inside
# rebrand_python (comments legitimately keep upstream URLs).
for path in glob.glob(f"{dist}/assets/*.js") + [tui_js]:
    assert not LINK.search(open(path, encoding="utf-8").read()), f"brand: nousresearch.com link survived in {path}"

index = f"{dist}/index.html"
html = open(index, encoding="utf-8").read()
assert html.count("<title>Hermes Agent - Dashboard</title>") == 1, "brand: <title> anchor missing"
html = html.replace("<title>Hermes Agent - Dashboard</title>", "<title>Decenchro · Agent console</title>")
open(index, "w", encoding="utf-8").write(html)
# index.html links the favicon as image/svg+xml under the .ico name; keep the name.
shutil.copyfile(icon, f"{dist}/favicon.ico")
n_server = rebrand_python(server_py)
assert "X-Hermes-Session-Token" in open(server_py, encoding="utf-8").read(), "brand: server header literal must survive"
n_banner = rebrand_python(banner_py)
assert n_banner >= 3, f"brand: expected the banner title + two ' · Nous Research' lines in banner.py, removed {n_banner}"
# The classic CLI's tiny banner ("- Nous Research") and the "⚕ Hermes" response
# label live here; the caduceus glyph itself stays (it is punctuation, not a name).
n_cli = sum(rebrand_python(f"{cli_dir}/{f}") for f in ("cli_commands_mixin.py", "_startup_fast.py")) + rebrand_python(f"{cli_dir}/../cli.py")

tui = open(tui_js, encoding="utf-8").read()
assert tui.count("Messenger of the Digital Gods") == 2, "brand: TUI tagline anchors moved"
tui_before = tui.count("Nous Research")
# Phrases with a space cannot be identifiers, so plain replace is safe and does
# not depend on the regex tokenizer staying in sync across a 3.6 MB bundle.
for old, new in TAGLINES.items():
    tui = tui.replace(old, new)
tui = relink(tui.replace("Nous Research", "Decenchro").replace("Hermes Agent", "Decenchro"))
tui = STRING.sub(rebrand_literal, tui)
assert "Messenger of the Digital Gods" not in tui, "brand: TUI tagline survived"
assert "Nous Research" not in tui, "brand: TUI credit survived"
open(tui_js, "w", encoding="utf-8").write(tui)
print(f"brand: web_server.py {n_server}, banner.py {n_banner}, cli {n_cli}, tui {tui_before - tui.count('Nous Research')} occurrences rebranded")
print(f"brand: wordmark replaced, {total_literals} string occurrences rebranded, favicon swapped")
