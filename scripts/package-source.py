from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parent.parent
output = root.parent / 'Shine_Time_Rebuild_Checkpoint.zip'
excluded = {'.git', 'node_modules', 'artifacts', '.temp', '.superpowers'}
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root)
        if path.is_file() and not any(part in excluded for part in relative.parts) and not path.name.startswith('.env'):
            archive.write(path, 'shine-platform/' + relative.as_posix())
    archive.writestr('CHECKPOINT.txt', 'Verified development source. Production acceptance is still open. See shine-platform/docs/STATUS.md and deployment/README.md.\n')
print(output)
