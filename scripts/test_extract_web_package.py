"""验证解包脚本的安全边界、完整预检和资源预算。"""

import io
from pathlib import Path
import runpy
import tarfile
import tempfile
import unittest
from unittest.mock import patch

EXTRACT = runpy.run_path(str(Path(__file__).with_name("extract-web-package.py")))


class ExtractPackageTests(unittest.TestCase):
    """以真实归档验证输出，使用成员元数据覆盖大包预算边界。"""

    def setUp(self):
        """为每个场景建立独立的归档与输出目录。"""
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.archive = self.root / "web.tar.gz"
        self.destination = self.root / "site"

    def write_archive(self, members):
        """将指定成员写入真实 gzip 归档。"""
        with tarfile.open(self.archive, "w:gz") as archive:
            for member, contents in members:
                archive.addfile(member, io.BytesIO(contents))

    def test_regular_files_and_directories(self):
        """目录、普通文件及规范化相对路径保持原始内容。"""
        directory = tarfile.TarInfo("assets")
        directory.type = tarfile.DIRTYPE
        file = tarfile.TarInfo("./assets/main.js")
        file.size = 4
        self.write_archive([(directory, b""), (file, b"data")])
        EXTRACT["extract_package"](self.archive, self.destination)
        self.assertEqual((self.destination / "assets/main.js").read_bytes(), b"data")
        self.assertEqual(self.destination.stat().st_mode & 0o777, 0o700)

    def test_invalid_paths_before_creating_output(self):
        """先读到合法成员也必须拒绝后续越界路径，且不创建输出。"""
        for name in ("../outside", "/absolute", "nested/../../outside", "nested\\outside"):
            with self.subTest(name=name):
                self.write_archive([(tarfile.TarInfo("valid"), b""), (tarfile.TarInfo(name), b"")])
                with self.assertRaisesRegex(ValueError, "不允许的路径或文件类型"):
                    EXTRACT["extract_package"](self.archive, self.destination)
                self.assertFalse(self.destination.exists())

    def test_rejects_non_static_member_types(self):
        """拒绝符号链接、硬链接、设备和 FIFO。"""
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE,
                     tarfile.BLKTYPE, tarfile.FIFOTYPE):
            with self.subTest(kind=kind):
                member = tarfile.TarInfo("unsafe")
                member.type = kind
                with self.assertRaisesRegex(ValueError, "不允许的路径或文件类型"):
                    EXTRACT["validate_member"](member)

    def test_rejects_sparse_regular_metadata(self):
        """普通文件和 GNU 稀疏文件带解析后的稀疏映射均被拒绝。"""
        for kind in (tarfile.REGTYPE, tarfile.GNUTYPE_SPARSE):
            member = tarfile.TarInfo("sparse")
            member.type = kind
            member.sparse = []
            with self.assertRaisesRegex(ValueError, "不允许的路径或文件类型"):
                EXTRACT["validate_member"](member)

    def test_duplicate_normalized_paths(self):
        """同名、点路径和重复斜杠规范化后均判为重复。"""
        for name in ("assets/main.js", "./assets/main.js", "assets//main.js"):
            with self.subTest(name=name):
                self.write_archive([(tarfile.TarInfo("assets/main.js"), b""),
                                    (tarfile.TarInfo(name), b"")])
                with self.assertRaisesRegex(ValueError, "重复路径"):
                    EXTRACT["extract_package"](self.archive, self.destination)
                self.assertFalse(self.destination.exists())

    def test_size_budget_boundary(self):
        """累计恰好 512 MiB 通过，增加一个字节失败且不写入文件。"""
        first = tarfile.TarInfo("first")
        first.size = EXTRACT["MAX_SIZE"] - 1
        second = tarfile.TarInfo("second")
        second.size = 1
        self.assertEqual(EXTRACT["validated_members"]([first, second]), [first, second])
        second.size = 2
        with self.assertRaisesRegex(ValueError, "解压大小或文件数量超过上限"):
            EXTRACT["validated_members"]([first, second])

    def test_count_budget_boundary(self):
        """真实数量上限为十万，以缩小预算验证相同边界算法。"""
        self.assertEqual(EXTRACT["MAX_MEMBERS"], 100000)
        members = [tarfile.TarInfo(str(index)) for index in range(3)]
        with patch.dict(EXTRACT["validated_members"].__globals__, MAX_MEMBERS=2):
            self.assertEqual(EXTRACT["validated_members"](members[:2]), members[:2])
            with self.assertRaisesRegex(ValueError, "解压大小或文件数量超过上限"):
                EXTRACT["validated_members"](members)

    def test_existing_destination_and_corrupt_archive_propagate(self):
        """不覆盖已有目录，并保留损坏归档的原始异常。"""
        self.write_archive([])
        self.destination.mkdir()
        with self.assertRaises(FileExistsError):
            EXTRACT["extract_package"](self.archive, self.destination)
        self.archive.write_bytes(b"invalid gzip")
        with self.assertRaises(tarfile.ReadError):
            EXTRACT["extract_package"](self.archive, self.root / "missing")
        self.assertFalse((self.root / "missing").exists())


if __name__ == "__main__":
    unittest.main()
