import base64
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from create_updater_manifest import build_manifest


class UpdaterManifestTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.signature_path = Path(self.tempdir.name) / "DevStart.AppImage.sig"
        self.signature = base64.b64encode(b"test-only detached signature").decode("ascii")
        self.signature_path.write_text(self.signature, encoding="ascii")

    def tearDown(self):
        self.tempdir.cleanup()

    def build(self, **overrides):
        values = {
            "version": "0.1.2",
            "tag": "v0.1.2",
            "repository": "uthumany/zorin-devstart",
            "appimage_name": "Zorin.DevStart_0.1.2_amd64.AppImage",
            "signature_path": self.signature_path,
        }
        values.update(overrides)
        return build_manifest(**values)

    def test_manifest_targets_appimage_with_inline_signature(self):
        manifest = self.build()
        platform = manifest["platforms"]["linux-x86_64-appimage"]
        self.assertEqual(manifest["version"], "0.1.2")
        self.assertEqual(platform["signature"], self.signature)
        self.assertEqual(
            platform["url"],
            "https://github.com/uthumany/zorin-devstart/releases/download/v0.1.2/Zorin.DevStart_0.1.2_amd64.AppImage",
        )

    def test_rejects_tag_that_does_not_bind_to_version(self):
        with self.assertRaisesRegex(ValueError, "must match app version"):
            self.build(tag="v0.1.3")

    def test_rejects_unexpected_repository_and_unsafe_filename(self):
        with self.assertRaisesRegex(ValueError, "Unexpected release repository"):
            self.build(repository="someone/else")
        with self.assertRaisesRegex(ValueError, "Unsafe or unsupported"):
            self.build(appimage_name="../latest.AppImage")

    def test_rejects_malformed_signature(self):
        self.signature_path.write_text("not a signature", encoding="ascii")
        with self.assertRaisesRegex(ValueError, "not valid base64"):
            self.build()

    def test_output_is_valid_json(self):
        self.assertEqual(json.loads(json.dumps(self.build()))["version"], "0.1.2")


if __name__ == "__main__":
    unittest.main()
