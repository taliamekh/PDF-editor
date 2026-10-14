from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
output = root / 'public' / 'source.zip'
excluded = {'node_modules', 'dist', '.git', '.sites-runtime', '.sites-cache', 'test-output', '.openai'}
with ZipFile(output, 'w', ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root)
        if not path.is_file() or any(part in excluded for part in relative.parts) or path == output or path.suffix == '.log':
            continue
        archive.write(path, 'pdf-text-studio/' + relative.as_posix())
print(f'Corresponding source: {output} ({output.stat().st_size:,} bytes)')
