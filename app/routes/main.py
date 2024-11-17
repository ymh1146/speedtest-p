from flask import render_template, jsonify, request, Response, stream_with_context
from datetime import datetime, timedelta
import os
import json
from app import app
from app.services.system_info import get_sys, get_ip, get_location
from app.utils.file_handlers import sav_rec, ld_recs
from app.config import CHK_SZ, BUF_SZ, DL_MAX, UP_MAX
import requests
from collections import defaultdict
from time import perf_counter
import time

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


@app.route("/ping")
def ping():
    try:
        return jsonify({"status": "ok", "timestamp": time.time()})
    except Exception as e:
        print(f"Ping error: {e}")
        return jsonify({"error": str(e)}), 500


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
    
    if not can_test(client_ip, "download"):
        return jsonify({"error": "请等待一分钟后再次测试"}), 429

    try:
        thread_size = int(DL_MAX / 6) 
        
        range_header = request.headers.get('Range', '')
        if range_header:
            start, end = map(int, range_header.replace('bytes=', '').split('-'))
            chunk_size = min(end - start + 1, thread_size)
        else:
            start = 0
            chunk_size = thread_size
            end = start + chunk_size - 1

        print(f"下载测试 - 线程大小: {thread_size/1024/1024}MB, 块大小: {chunk_size/1024/1024}MB")

        def generate():
            try:
                remaining = chunk_size
                total_sent = 0
                while remaining > 0:
                    current_chunk = min(remaining, max(BUF_SZ, CHK_SZ))
                    chunk = os.urandom(current_chunk)
                    total_sent += current_chunk
                    
                    sent = 0
                    while sent < len(chunk):
                        buffer_chunk = chunk[sent:sent + BUF_SZ]
                        yield buffer_chunk
                        sent += len(buffer_chunk)
                    
                    remaining -= current_chunk
            except Exception as e:
                print(f"数据生成错误: {e}")
                raise

        response = Response(
            stream_with_context(generate()),
            content_type='application/octet-stream',
            direct_passthrough=True,
            headers={'X-Accel-Buffering': 'no'}
        )

        response.headers['Content-Length'] = str(chunk_size)
        response.headers['Content-Range'] = f'bytes {start}-{end}/{chunk_size}'
        response.headers['Accept-Ranges'] = 'bytes'
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        
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
        
        data = request.get_data()
        rcvd = len(data)

        thread_size = int(UP_MAX / 3) 
        
        if rcvd > thread_size:
            print(f"上传数据块过大: {rcvd/1024/1024:.2f}MB > {thread_size/1024/1024:.2f}MB")
            return jsonify({"error": "数据块过大"}), 413
            
        print(f"上传测试 - 接收数据: {rcvd/1024/1024:.2f}MB")
        
        if perf_counter() - st > 10:
            return jsonify({
                "status": "timeout",
                "duration": 10,
                "received": rcvd,
                "speed": (rcvd / (1024 * 1024)) / 10
            })
        
        dur = perf_counter() - st
        sp = (rcvd / (1024 * 1024)) / dur if dur > 0 else 0
        
        return jsonify({
            "status": "ok",
            "duration": round(dur, 2),
            "received": rcvd,
            "speed": round(sp, 2)
        })
        
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


@app.route("/favicon.ico")
def favicon():
    return "", 204


@app.route("/get_test_config")
def get_test_config():
    try:
        return jsonify({
            "chunk_size": CHK_SZ,
            "buffer_size": BUF_SZ,
            "download_max": DL_MAX,
            "upload_max": UP_MAX
        })
    except Exception as e:
        print(f"获取配置失败: {e}")
        return jsonify({  #服务端默认配置
            "error": str(e),
            "chunk_size": 2 * 1024 * 1024,  #块2MB
            "buffer_size": 128 * 1024,        #缓冲128KB
            "download_max": 300 * 1024 * 1024,  #下载300MB
            "upload_max": 100 * 1024 * 1024     #上传100MB
        }), 500
