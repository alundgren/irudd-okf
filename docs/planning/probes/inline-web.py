"""Inline the probe's generated JavaScript before SEA packaging."""
from pathlib import Path
import re

page = Path("web-dist/index.html")
html = page.read_text()
html = re.sub(
    r'<script[^>]+src="([^"]+)"[^>]*></script>',
    lambda match: '<script type="module">'
    + (page.parent / match.group(1).lstrip('/')).read_text().replace('</script', '<\\/script')
    + '</script>',
    html,
)
page.write_text(html)
