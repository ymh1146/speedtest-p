# 测试配置
CHK_SZ = 8388608  # 分块大小 (8MB)
BUF_SZ = 131072   # 缓冲区大小 (128KB)
WS_INT = 0.1      # WebSocket 更新间隔 (秒)
DL_MAX = int(0.3 * 1024 * 1024 * 1024)  # 下载测试最大大小 (0.3GB)
UP_MAX = int(0.1 * 1024 * 1024 * 1024)  # 上传测试最大大小 (0.1GB)

# 历史记录配置
MAX_REC = 20  # 最大记录数
REC_F = 'speed_records.json'  # 记录文件名