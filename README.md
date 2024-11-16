# SpeedTest-P

一个基于 Python + Flask 的服务器to用户的网络速度测试工具。

## 环境要求

- Python 3.7+
- Flask 3.0.0+
- 其他依赖见 requirements.txt

## 快速开始

1. 克隆仓库

``` bash
git clone https://github.com/ymh1146/speedtest-p.git
cd speedtest-p
pip install -r requirements.txt
python app.py
```
2. 访问
```
http://localhost:5000
```
## 配置说明

配置文件位于 `app/config.py`：

- CHK_SZ: 分块大小 (默认 8MB)
- DL_MAX: 下载测试大小 (默认 300MB)
- UP_MAX: 上传测试大小 (默认 100MB)
- MAX_REC: 最大历史记录数 (默认 20)

## 许可证

MIT License @ [heilo.cn](https://heilo.cn)
