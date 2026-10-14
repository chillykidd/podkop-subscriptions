"""Build the portable, independently installable OpenWrt add-on bundle."""
from pathlib import Path
import tarfile
import hashlib

root = Path(__file__).resolve().parents[1]
output = root / "dist" / "podkop-subscriptions-0.2.2.tar.gz"
output.parent.mkdir(exist_ok=True)
with tarfile.open(output, "w:gz", format=tarfile.PAX_FORMAT) as archive:
    files = [*sorted((root / "addon").rglob("*")), root / "install.sh",
             root / "uninstall.sh", root / "LICENSE"]
    for path in files:
        if not path.is_file():
            continue
        relative = path.relative_to(root).as_posix()
        info = archive.gettarinfo(str(path), "podkop-subscriptions-0.2.2/" + relative)
        info.uid = info.gid = 0
        info.uname = info.gname = "root"
        info.mtime = 0
        info.mode = 0o755 if path.suffix == ".sh" or relative.endswith(("usr/libexec/rpcd/podkop-subscriptions", "etc/init.d/podkop-subscriptions")) else 0o644
        with path.open("rb") as stream:
            archive.addfile(info, stream)
print(output)
checksum = output.parent / 'SHA256SUMS'
checksum.write_text(hashlib.sha256(output.read_bytes()).hexdigest() + '  ' + output.name + '\n', encoding='ascii', newline='\n')
print(checksum)
