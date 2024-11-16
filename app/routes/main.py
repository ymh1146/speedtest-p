from flask import render_template, jsonify, request, Response, stream_with_context
from datetime import datetime, timedelta
import os
import time
import json
from app import app, sock
from app.services.speed_test import SpTest
from app.services.system_info import get_sys, get_ip, get_location
from app.utils.file_handlers import sav_rec, ld_recs
from app.config import CHK_SZ, BUF_SZ, WS_INT, DL_MAX, UP_MAX
import requests
from collections import defaultdict
from time import perf_counter

sp_test = SpTest()
ip_test_records = defaultdict(list)


def can_test(ip, test_type=None):
    now = datetime.now()
    minute_ago = now - timedelta(minutes=1)

    ip_test_records[ip] = [
        rec for rec in ip_test_records[ip] if rec["time"] > minute_ago
    ]

    current_records = ip_test_records[ip]

    if current_records:
        latest_record = current_records[-1]
        if latest_record["time"] > minute_ago:

            if test_type == "download" and latest_record["type"] == "download":
                return True

            if test_type == "upload" and latest_record["type"] == "upload":
                return True

            if test_type != latest_record["type"]:
                return True

    if len(current_records) >= 6:
        return False

    ip_test_records[ip].append({"time": now, "type": test_type})
    return True


def get_real_ip():

    headers_to_check = [
        "X-Forwarded-For",
        "X-Real-IP",
        "CF-Connecting-IP",
        "True-Client-IP",
    ]

    for header in headers_to_check:
        ip = request.headers.get(header)
        if ip:

            ip = ip.split(",")[0].strip()

            if is_valid_public_ipv4(ip):
                return ip

    ip = request.remote_addr
    if is_valid_public_ipv4(ip):
        return ip

    try:
        sess = requests.Session()
        sess.verify = False
        hdrs = {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept-Language": "zh-CN,zh;q=0.9",
        }

        try:
            res = sess.get(
                "https://whois.pconline.com.cn/ipJson.jsp?json=true",
                headers=hdrs,
                timeout=2,
            )
            if res.ok:
                data = res.json()
                if data and "ip" in data and data.get("err") != "noprovince":
                    ip = data["ip"]
                    if is_valid_public_ipv4(ip):
                        return ip
        except:
            pass

        try:
            res = sess.get("https://api.vore.top/api/IPdata", headers=hdrs, timeout=2)
            if res.ok:
                data = res.json()
                if data and data.get("code") == 200:
                    ip = data.get("ipinfo", {}).get("text", "")
                    if is_valid_public_ipv4(ip):
                        return ip
        except:
            pass

        try:
            res = sess.get("https://api.ipify.org?format=json", headers=hdrs, timeout=2)
            if res.ok:
                data = res.json()
                ip = data.get("ip", "")
                if is_valid_public_ipv4(ip):
                    return ip
        except:
            pass

        try:
            res = sess.get("https://api.ip.sb/ip", headers=hdrs, timeout=2)
            if res.ok:
                ip = res.text.strip()
                if is_valid_public_ipv4(ip):
                    return ip
        except:
            pass

    except Exception as e:
        print(f"获取IP失败: {e}")

    return None


def is_valid_public_ipv4(ip):
    if not ip:
        return False
    try:

        if "." not in ip or ":" in ip:
            return False

        parts = [int(part) for part in ip.split(".")]
        if len(parts) != 4:
            return False

        if parts[0] == 10:
            return False
        if parts[0] == 172 and (16 <= parts[1] <= 31):
            return False
        if parts[0] == 192 and parts[1] == 168:
            return False
        if parts[0] == 127:
            return False

        return all(0 <= part <= 255 for part in parts)
    except:
        return False


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/get_info")
def get_info():
    cli_ip = get_real_ip() or request.remote_addr
    try:
        sys_info = get_sys()
        loc_info = (
            get_location(cli_ip)
            if cli_ip != "未知"
            else {"country": "未知", "region": "未知", "city": "未知"}
        )
        return jsonify(
            {"system_info": sys_info, "client_info": loc_info, "client_ip": cli_ip}
        )
    except Exception as e:
        print(f"Error in get_info route: {e}")

        if not sys_info:
            sys_info = {
                "ip": "获取失败",
                "os": "获取失败",
                "cpu": "获取失败",
                "mem_total": "0 GB",
                "mem_used": "0 GB",
                "dsk_total": "0 GB",
                "dsk_used": "0 GB",
            }
        return (
            jsonify(
                {
                    "system_info": sys_info,
                    "client_info": {
                        "country": "未知",
                        "region": "未知",
                        "city": "未知",
                    },
                    "client_ip": cli_ip,
                }
            ),
            200,
        )


@app.route("/get_records")
def get_recs():
    recs = ld_recs()
    return jsonify(recs)


@app.route("/download_test")
def dl_test():
    client_ip = get_real_ip() or request.remote_addr
    print(f"开始下载测试 - IP: {client_ip}")

    if not can_test(client_ip, "download"):
        return jsonify({"error": "请等待一分钟后再次测试"}), 429

    try:

        def generate():
            try:
                sent = 0
                chunk = os.urandom(min(CHK_SZ, 1024 * 1024))

                max_size = int(DL_MAX / 6)
                print(f"生成测试数据 - 块大小: {len(chunk)}, 线程分配大小: {max_size}")

                while sent < max_size:
                    yield chunk
                    sent += len(chunk)
                    if sent % (10 * 1024 * 1024) == 0:
                        print(
                            f"下载进度: {sent}/{max_size} bytes ({(sent/max_size*100):.1f}%)"
                        )

            except Exception as e:
                print(f"数据生成错误: {e}")
                raise

        response = Response(
            stream_with_context(generate()),
            content_type="application/octet-stream",
            direct_passthrough=True,
        )

        response.headers["Content-Length"] = str(int(DL_MAX / 6))
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        print(f"下载测试响应已创建 - Content-Length: {int(DL_MAX / 6)}")
        return response

    except Exception as e:
        print(f"下载测试错误: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/upload_test", methods=["POST"])
def up_test():
    client_ip = get_real_ip() or request.remote_addr
    if not can_test(client_ip, "upload"):
        return jsonify({"error": "请等待一分钟后再次测试"}), 429
    try:
        st = perf_counter()
        chunk_size = min(CHK_SZ, 1024 * 1024)

        max_size = int(UP_MAX / 3)
        rcvd = 0

        while rcvd < max_size:
            try:
                chunk = request.stream.read(chunk_size)
                if not chunk:
                    break
                rcvd += len(chunk)

                if rcvd % (10 * 1024 * 1024) == 0:
                    print(
                        f"上传进度: {rcvd}/{max_size} bytes ({(rcvd/max_size*100):.1f}%)"
                    )

                if perf_counter() - st > 10:
                    break

            except Exception as e:
                print(f"Upload chunk error: {e}")
                break

        dur = perf_counter() - st
        sp = (rcvd / (1024 * 1024)) / dur if dur > 0 else 0

        return jsonify({"dur": round(dur, 2), "rcvd": rcvd, "sp": round(sp, 2)})
    except Exception as e:
        print(f"上传测试错误: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/save_test_results", methods=["POST"])
def save_res():
    try:
        data = request.get_json()
        cli_ip = get_real_ip() or request.remote_addr
        loc_info = (
            get_location(cli_ip)
            if cli_ip != "未知"
            else {"country": "未知", "region": "未知", "city": "未知"}
        )

        rec = {
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "ip": cli_ip,
            "location": {
                "country": loc_info.get("country", "未知"),
                "region": loc_info.get("region", "未知"),
                "city": loc_info.get("city", "未知"),
            },
            "results": {
                "download_avg": round(data.get("download_avg", 0) * 8, 2),
                "download_peak": round(data.get("download_peak", 0) * 8, 2),
                "upload_avg": round(data.get("upload_avg", 0) * 8, 2),
                "upload_peak": round(data.get("upload_peak", 0) * 8, 2),
                "ping_avg": round(data.get("ping_avg", 0), 2),
                "jitter": round(data.get("jitter", 0), 2),
                "download_size": int(DL_MAX / (1024 * 1024)),
                "upload_size": int(UP_MAX / (1024 * 1024)),
            },
        }

        sav_rec(rec)
        return jsonify({"success": True})
    except Exception as e:
        print(f"Error saving test results: {e}")
        return jsonify({"error": str(e)}), 500


@sock.route("/ws")
def ws(ws):
    sp_test = SpTest()
    try:
        sp_test.ws_cons.add(ws)
        while True:
            try:
                msg = ws.receive(timeout=30)
                if msg is None:
                    ws.send(json.dumps({"type": "ping"}))
                    continue
                elif not msg:
                    break
            except Exception as e:
                print(f"WebSocket receive error: {e}")
                break
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        sp_test.ws_cons.discard(ws)


@app.after_request
def add_hdrs(response):
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "connect-src 'self' ws: wss: http://ip-api.com https://ipapi.co "
        "https://whois.pconline.com.cn https://ip.useragentinfo.com; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "font-src 'self' data:;"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    return response


@app.errorhandler(Exception)
def handle_err(error):
    print(f"Error: {error}")
    return jsonify({"error": "Internal server error"}), 500


@app.route("/ping")
def ping():
    try:
        return jsonify({"status": "ok"})
    except Exception as e:
        print(f"Ping error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/get_test_config")
def get_cfg():
    try:
        return jsonify(
            {
                "chunk_size": CHK_SZ,
                "buffer_size": BUF_SZ,
                "update_interval": WS_INT,
                "download_max": DL_MAX,
                "upload_max": UP_MAX,
            }
        )
    except Exception as e:
        print(f"获取配置失败: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/favicon.ico")
def favicon():
    return "", 204
