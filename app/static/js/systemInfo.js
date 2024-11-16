class SysInfo {
    constructor() {
        this.ldInfo().catch(err => {
            console.error('加载系统信息失败:', err);
            this.setErr();
        });
    }
    async ldInfo() {
        try {
            const res = await fetch('/get_info');
            if (!res.ok) throw new Error('获取系统信息失败');
            const data = await res.json();
            this.updSrv(data.system_info);
            this.updCli({
                ip: data.client_ip,
                os: this.getClientOS(),
                browser: this.getClientBrowser(),
                country: data.client_info.country || '未知',
                region: data.client_info.region || '未知',
                city: data.client_info.city || '未知'
            });
        } catch (err) {
            throw err;
        }
    }
    getClientOS() {
        const ua = navigator.userAgent;
        if (ua.indexOf("Win") !== -1) return "Windows";
        if (ua.indexOf("Mac") !== -1) return "MacOS";
        if (ua.indexOf("X11") !== -1) return "UNIX";
        if (ua.indexOf("Linux") !== -1) return "Linux";
        if (ua.indexOf("Android") !== -1) return "Android";
        if (ua.indexOf("iPhone") !== -1) return "iOS";
        return "未知";
    }
    getClientBrowser() {
        const ua = navigator.userAgent;
        if (ua.indexOf("Chrome") !== -1) return "Chrome";
        if (ua.indexOf("Firefox") !== -1) return "Firefox";
        if (ua.indexOf("Safari") !== -1) return "Safari";
        if (ua.indexOf("Edge") !== -1) return "Edge";
        if (ua.indexOf("MSIE") !== -1 || ua.indexOf("Trident/") !== -1) return "IE";
        return "未知";
    }
    updSrv(info) {
        document.getElementById('serverIP').textContent = info.ip;
        document.getElementById('serverOS').textContent = info.os;
        document.getElementById('serverCPU').textContent = info.cpu;
        document.getElementById('serverMemory').textContent = 
            `${info.mem_used} / ${info.mem_total}`;
        document.getElementById('serverDisk').textContent = 
            `${info.dsk_used} / ${info.dsk_total}`;
    }
    updCli(info) {
        document.getElementById('clientIP').textContent = info.ip;
        document.getElementById('clientOS').textContent = info.os;
        document.getElementById('clientCountry').textContent = info.country;
        document.getElementById('clientRegion').textContent = info.region;
        document.getElementById('clientCity').textContent = info.city;
    }
    setErr() {
        const ids = [
            'serverIP', 'serverOS', 'serverCPU', 'serverMemory', 'serverDisk',
            'clientIP', 'clientOS', 'clientCountry', 'clientRegion', 'clientCity'
        ];
        ids.forEach(id => {
            document.getElementById(id).textContent = '获取失败';
        });
    }
}
document.addEventListener('DOMContentLoaded', () => {
    window.sysInfo = new SysInfo();
});