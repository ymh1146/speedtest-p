import platform
import psutil
import requests
import urllib3
import warnings
from datetime import datetime, timedelta
import socket

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
warnings.filterwarnings("ignore", message="Unverified HTTPS request")
ip_cache = {"cli": {"data": None, "exp": None}, "srv": {"data": None, "exp": None}}

_system_info_cache = {"data": None, "expires": None}


def is_v4(ip):
    return ip and "." in ip and ":" not in ip


def get_cache(key):
    cache = ip_cache[key]
    if cache["data"] and cache["exp"] and datetime.now() < cache["exp"]:
        return cache["data"]
    return None


def set_cache(key, data, mins=5):
    ip_cache[key] = {"data": data, "exp": datetime.now() + timedelta(minutes=mins)}


def get_ip(is_cli=False):
    if is_cli:
        return {"ip": "", "country": "", "region": "", "city": ""}

    key = "srv"
    cached = get_cache(key)
    if cached:
        return cached

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
                timeout=1,
            )
            if res.ok:
                data = res.json()
                if data and "err" not in data:
                    result = {
                        "ip": data.get("ip", ""),
                        "country": (
                            "中国"
                            if data.get("addr", "").startswith("中国")
                            else data.get("addr", "未知")
                        ),
                        "region": data.get("pro", "未知"),
                        "city": data.get("city", "未知"),
                    }
                    if is_v4(result["ip"]):
                        set_cache(key, result)
                        return result
        except:
            pass

        try:
            res = sess.get("https://api.vore.top/api/IPdata", headers=hdrs, timeout=1)
            if res.ok:
                data = res.json()
                if data and data.get("code") == 200:
                    ipdata = data.get("ipdata", {})
                    result = {
                        "ip": data.get("ipinfo", {}).get("text", ""),
                        "country": ipdata.get("info1", "未知"),
                        "region": ipdata.get("info2", "未知"),
                        "city": ipdata.get("info3", "未知"),
                    }
                    if is_v4(result["ip"]):
                        set_cache(key, result)
                        return result
        except:
            pass

        try:
            res = sess.get("https://api.ipify.org?format=json", headers=hdrs, timeout=1)
            if res.ok:
                data = res.json()
                ip = data.get("ip", "")
                if is_v4(ip):
                    loc = get_location(ip)
                    result = {
                        "ip": ip,
                        "country": loc.get("country", "未知"),
                        "region": loc.get("region", "未知"),
                        "city": loc.get("city", "未知"),
                    }
                    set_cache(key, result)
                    return result
        except:
            pass

        try:
            hdrs["Accept"] = "application/json"
            res = sess.get("https://api.ip.sb/geoip", headers=hdrs, timeout=1)
            if res.ok:
                data = res.json()
                result = {
                    "ip": data.get("ip", ""),
                    "country": data.get("country", "未知"),
                    "region": data.get("region", "未知"),
                    "city": data.get("city", "未知"),
                }
                if is_v4(result["ip"]):
                    set_cache(key, result)
                    return result
        except:
            pass

    except Exception as e:
        print(f"获取IP信息失败: {e}")

    def_res = {"ip": "未知", "country": "未知", "region": "未知", "city": "未知"}
    set_cache(key, def_res, mins=1)
    return def_res


def get_sys():
    global _system_info_cache
    now = datetime.now()

    if (
        _system_info_cache["data"] is not None
        and _system_info_cache["expires"] is not None
        and now < _system_info_cache["expires"]
    ):
        return _system_info_cache["data"]

    try:
        if platform.system() == "Linux":
            try:
                with open("/proc/cpuinfo") as f:
                    for line in f:
                        if line.startswith("model name"):
                            cpu = line.split(":")[1].strip()
                            break
                    else:
                        cpu = platform.processor() or platform.machine()
            except:
                cpu = platform.processor() or platform.machine()
        else:
            cpu = platform.processor() or platform.machine()

        mem = psutil.virtual_memory()
        dsk = psutil.disk_usage("/")

        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            server_ip = s.getsockname()[0]
            s.close()
        except:
            server_ip = "127.0.0.1"

        info = {
            "ip": server_ip,
            "os": f"{platform.system()} {platform.release()}",
            "cpu": cpu,
            "mem_total": f"{mem.total / (1024**3):.1f} GB",
            "mem_used": f"{mem.used / (1024**3):.1f} GB",
            "dsk_total": f"{dsk.total / (1024**3):.1f} GB",
            "dsk_used": f"{dsk.used / (1024**3):.1f} GB",
        }

        _system_info_cache["data"] = info
        _system_info_cache["expires"] = now + timedelta(hours=24)

        return info
    except Exception as e:
        print(f"获取系统信息失败: {e}")
        return {
            "ip": "获取失败",
            "os": "获取失败",
            "cpu": "获取失败",
            "mem_total": "0 GB",
            "mem_used": "0 GB",
            "dsk_total": "0 GB",
            "dsk_used": "0 GB",
        }


def get_location(ip):
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
                f"https://whois.pconline.com.cn/ipJson.jsp?json=true&ip={ip}",
                headers=hdrs,
                timeout=2,
            )
            if res.ok:
                data = res.json()
                if data and "err" != "noprovince":
                    return {
                        "country": "中国",
                        "region": data.get("pro", "未知"),
                        "city": data.get("city", "未知"),
                    }
        except:
            pass

        try:
            res = sess.get(
                f"https://api.vore.top/api/IPdata?ip={ip}", headers=hdrs, timeout=2
            )
            if res.ok:
                data = res.json()
                if data and data.get("code") == 200:
                    ipdata = data.get("ipdata", {})
                    return {
                        "country": (
                            "中国"
                            if data.get("ipinfo", {}).get("cnip")
                            else ipdata.get("info1", "未知")
                        ),
                        "region": ipdata.get("info1", "未知"),
                        "city": ipdata.get("info2", "未知"),
                    }
        except:
            pass

        try:
            hdrs["Accept"] = "application/json"
            res = sess.get(f"https://api.ip.sb/geoip/{ip}", headers=hdrs, timeout=2)
            if res.ok:
                data = res.json()
                return {
                    "country": data.get("country", "未知"),
                    "region": data.get("region", "未知"),
                    "city": data.get("city", "未知"),
                }
        except:
            pass

    except Exception as e:
        print(f"获取位置信息失败: {e}")

    return {"country": "未知", "region": "未知", "city": "未知"}
