"""Build a minimal Hostinger /app update; preserve existing server protections."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json
root = Path(__file__).resolve().parents[1]
files = ['index.php', 'sw.js', 'manifest.webmanifest', 'config/supabase.php']
files += [str(p.relative_to(root)) for p in sorted((root / 'assets').iterdir()) if p.suffix in {'.js', '.css', '.png'}]
output = root / 'artifacts' / 'shine-time-frontend.zip'
output.parent.mkdir(exist_ok=True)
manifest = {}
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for name in files:
        data = (root / name).read_bytes()
        manifest[name] = hashlib.sha256(data).hexdigest()
        archive.writestr(name, data)
(root / 'artifacts' / 'frontend-checksums.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Packaged {len(files)} frontend files: {output.name}')
