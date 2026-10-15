#!/system/bin/sh
# 仅在可 root 的专用模拟器里添加本轮临时 CA；保留系统全部原有证书。
set -eu
certificate="$1"
directory=/data/local/tmp/clrn-visual-certificates
mkdir -p "$directory"
cp /apex/com.android.conscrypt/cacerts/* "$directory/"
cp "$certificate" "$directory/"
chmod 755 "$directory"
chmod 644 "$directory"/*
chown -R 0:0 "$directory"
chcon -R u:object_r:system_file:s0 "$directory"
# Android 14+ 的应用使用 zygote 挂载命名空间中的 Conscrypt 证书目录。
for process in $(pidof zygote zygote64); do
  nsenter --mount="/proc/$process/ns/mnt" -- mount --bind "$directory" /apex/com.android.conscrypt/cacerts
done
