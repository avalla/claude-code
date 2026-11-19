import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('builder', Path(__file__).parents[1] / 'build-context-memory-marketplace.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class MarketplaceTests(unittest.TestCase):
    def test_package_and_preserve_existing(self):
        with tempfile.TemporaryDirectory(prefix='marketplace with spaces ') as directory:
            output = Path(directory)
            builder.build(output)
            catalog = json.loads((output / '.claude-plugin/marketplace.json').read_text())
            self.assertEqual(catalog['name'], 'avalla-context-memory')
            plugin = output / 'plugins/context-memory'
            self.assertTrue((plugin / 'hooks/history.ts').exists())
            self.assertFalse((plugin / 'tests').exists())
            with self.assertRaises(ValueError):
                builder.build(output)
            self.assertTrue((plugin / 'hooks/register.ts').exists())

    def test_reject_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source'
            (source / '.claude-plugin').mkdir(parents=True)
            (source / 'hooks').mkdir()
            (source / '.claude-plugin/plugin.json').write_text('{}')
            (source / 'README.md').symlink_to('/etc/hosts')
            with self.assertRaises(ValueError):
                builder.build(root / 'output', source)
