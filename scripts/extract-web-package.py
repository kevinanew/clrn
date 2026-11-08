"""在下载摘要校验后解包 H5 Release；只允许静态文件和目录，输出独立站点目录。"""

import pathlib
import sys
import tarfile


MAX_SIZE = 512 * 1024 * 1024
MAX_MEMBERS = 100000


def member_path(member):
    """规范化成员路径，拒绝绝对路径、上级路径和反斜杠。"""
    name = pathlib.PurePosixPath(member.name)
    if name.is_absolute() or ".." in name.parts or "\\" in member.name:
        raise ValueError("构建包含有不允许的路径或文件类型")
    return name


def validate_member(member):
    """只接受非稀疏的普通文件和目录，返回校验后的规范路径。"""
    name = member_path(member)
    if not (member.isfile() or member.isdir()) or member.issparse():
        raise ValueError("构建包含有不允许的路径或文件类型")
    return name


def validated_members(archive):
    """完整校验路径唯一性和资源预算，失败时不创建目标目录。"""
    members = []
    total_size = 0
    names = set()
    for member in archive:
        name = validate_member(member)
        if name in names:
            raise ValueError("构建包含有重复路径")
        names.add(name)
        members.append(member)
        total_size += member.size
        if total_size > MAX_SIZE or len(members) > MAX_MEMBERS:
            raise ValueError("构建包解压大小或文件数量超过上限")
    return members


def extract_package(archive_path, destination):
    """先检查全部归档成员，再向全新目录解包，拒绝链接、越界路径和过大内容。"""
    with tarfile.open(archive_path, "r:gz") as archive:
        members = validated_members(archive)
        destination.mkdir(mode=0o700)
        archive.extractall(destination, members=members, filter="data")


if __name__ == "__main__":
    extract_package(sys.argv[1], pathlib.Path(sys.argv[2]))
