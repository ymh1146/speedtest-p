# SpeedTest-P

一个基于 Python + Flask 的服务器to用户的网络速度测试工具。

## 环境要求

- Python 3.7+
- Flask 3.0.0+
- 其他依赖见 requirements.txt

## 快速开始

1. 克隆仓库

```bash
git clone https://github.com/ymh1146/speedtest-p.git
cd speedtest-p
pip install -r requirements.txt
python run.py
```

2. 访问

```
http://localhost:5000
```

## 配置说明

配置文件位于 `app/config.py`：

* CHK_SZ = 2097152 *// *分块大小 (2MB) 不建议超过2MB，超过2MB手机端上传有几率失败*
* BUF_SZ = 131072 *// 缓冲区大小 (128KB)*
* DL_MAX = int(0.3 1024 1024 1024)  *// 下载测试最大大小 (0.3GB)*
* UP_MAX = int(0.1 1024 1024 1024) *// 上传测试最大大小 (0.1GB)**

历史记录配置

* MAX_REC = 20 *// 最大记录数*
* REC_F = 'speed_records.json' *// 记录文件名*

## 更新日志

### v1.0.2 (2024-11-17)

- 移除WebSocket依赖
- ~~- 使用HTTP/2进行测试~~  要报错还是用1.1
- 优化移动设备兼容性
- 修复上传卡死问题
- 优化配置系统

## 许可证

MIT License @ [heilo.cn](https://heilo.cn)
