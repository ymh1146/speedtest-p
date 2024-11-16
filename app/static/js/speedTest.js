class SpTest {
    constructor() {
        this.ws = null;
        this.dlSize = null;
        this.upSize = null;
        this.pgTotal = 0;
        this.curTest = null;
        this.config = null;
        this.getCfg().then(() => {
            this.initWs();
            this.initEvt();
            this.updHis();
        }).catch(err => {
            console.error('初始化失败:', err);
        });
    }
    async getCfg() {
        try {
            const res = await fetch('/get_test_config');
            this.config = await res.json();
            this.chunkSize = this.config.chunk_size;
            this.bufferSize = this.config.buffer_size;
            this.updateInterval = this.config.update_interval;
            this.downloadMax = this.config.download_max;
            this.uploadMax = this.config.upload_max;
        } catch (err) {
            console.error('获取配置失败:', err);
            this.chunkSize = 4 * 1024 * 1024;
            this.bufferSize = 64 * 1024;
            this.updateInterval = 0.1;
            this.downloadMax = 300 * 1024 * 1024;
            this.uploadMax = 100 * 1024 * 1024;
        }
    }
    initWs() {
        this.ws = new WebSocket(`ws://${window.location.host}/ws`);
        this.ws.onopen = () => console.log('WebSocket 连接已建立');
        this.ws.onmessage = this.handleMsg.bind(this);
        this.ws.onclose = () => setTimeout(() => this.initWs(), 1000);
        this.ws.onerror = err => console.error('WebSocket 错误:', err);
    }
    initEvt() {
        const btn = document.getElementById('startTest');
        if (btn) {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                try {
                    await this.startTest();
                } finally {
                    btn.disabled = false;
                }
            });
        }
        this.initHisToggle();
    }
    initHisToggle() {
        const togBtn = document.getElementById('historyToggle');
        const hisCnt = document.getElementById('historyContent');
        const togIcon = togBtn.querySelector('.t-ico');

        if (togBtn && hisCnt) {
            togBtn.addEventListener('click', () => {
                if (hisCnt.style.display === 'block') {
                    hisCnt.style.opacity = '0';
                    setTimeout(() => hisCnt.style.display = 'none', 300);
                    togIcon.textContent = '▼';
                } else {
                    hisCnt.style.display = 'block';
                    setTimeout(() => hisCnt.style.opacity = '1', 10);
                    togIcon.textContent = '▲';
                    this.updHis();
                }
            });
        }
    }
    handleMsg(evt) {
        try {
            const data = JSON.parse(evt.data);
            if (data.type === this.curTest) {
                let basePg = data.type === 'download' ? 20 : data.type === 'upload' ? 60 : 0;
                const testPg = (data.prog * 0.4);
                this.pgTotal = basePg + testPg;
                this.updPg(data.type, data.sp * 8, this.pgTotal);
            }
        } catch (err) {
            console.error('处理消息失败:', err);
        }
    }
    async startTest() {
        const tSec = document.querySelector('.t-sec');
        const pgCon = document.querySelector('.pg-con');
        const resCon = document.querySelector('.r-con');
        tSec.style.display = 'block';
        setTimeout(() => tSec.classList.add('show'), 10);
        pgCon.classList.add('show');
        if (resCon) resCon.classList.remove('show');
        this.pgTotal = 0;
        this.updPg(0, '准备开始测试...');
        try {
            const pingRes = await this.runPingTest();
            const dlRes = await this.runDlTest();
            if (dlRes.error) {
                this.showErr(dlRes.error);
                return;
            }
            const upRes = await this.runUpTest();
            if (upRes.error) {
                this.showErr(upRes.error);
                return;
            }
            const res = {...pingRes, ...dlRes, ...upRes};
            await this.saveRes(res);
            await this.updHis();
            pgCon.style.transition = 'opacity 1.5s cubic-bezier(0.4, 0, 0.2, 1)';
            pgCon.style.opacity = '0';
            await new Promise(resolve => setTimeout(resolve, 1500));
            pgCon.style.display = 'none';
            this.showRes(res);
        } catch (err) {
            console.error('测试失败:', err);
            this.showErr(err.message || '测试失败，请重试');
            this.updPg(0, '测试失败');
        }
    }
    updPg(type, speed, progress) {
        const pgFill = document.querySelector('.pg-fill');
        const pgLab = document.querySelector('#progressLabel');
        if (pgFill && pgLab) {
            pgFill.style.width = `${progress}%`;
            if (type === 'download' || type === 'upload') {
                pgLab.textContent = `正在测试${type === 'download' ? '下载' : '上传'}速度: ${speed.toFixed(2)} Mb/s`;
            } else if (type === 'ping') {
                pgLab.textContent = `正在测试Ping速度: ${speed.toFixed(2)} ms`;
            } else {
                pgLab.textContent = `正在测试: ${speed}`;
            }
        }
    }
    async runPingTest() {
        const pings = [];
        const count = 5;
        this.curTest = 'ping';
        
        try {
            for(let i = 0; i < count; i++) {
                const start = performance.now();
                const res = await fetch('/ping');
                const end = performance.now();
                if (!res.ok) throw new Error('Ping测试失败');
                pings.push(end - start);
                this.updPg('ping', pings[pings.length - 1], (i + 1) * 20);
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            
            // 计算平均值和抖动
            const validPings = pings.filter(p => p > 0 && p < 1000);
            const avgPing = validPings.reduce((a, b) => a + b, 0) / validPings.length;
            const jitter = Math.sqrt(
                validPings.map(p => Math.pow(p - avgPing, 2))
                         .reduce((a, b) => a + b, 0) / validPings.length
            );
            
            return {
                ping_avg: Math.round(avgPing),
                jitter: Math.round(jitter)
            };
        } catch (err) {
            console.error('Ping测试失败:', err);
            return { error: 'Ping测试失败' };
        }
    }
    async runDlTest() {
        const streams = 6;
        const sps = [];
        const activeStreams = [];
        this.curTest = 'download';
        let totalReceived = 0;
        let failedStreams = 0;
        const startTime = performance.now();
        let lastUpdate = startTime;
        
        try {
            console.log(`开始下载测试 - 并发数: ${streams}, 每线程大小: ${this.downloadMax/streams}`);
            
            for(let i = 0; i < streams; i++) {
                const streamPromise = (async () => {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 10000);
                    
                    try {
                        console.log(`启动下载流 ${i+1}`);
                        const res = await fetch('/download_test', {
                            signal: controller.signal,
                            headers: {
                                'Cache-Control': 'no-cache',
                                'Pragma': 'no-cache'
                            }
                        });
                        
                        if (!res.ok) {
                            failedStreams++;
                            throw new Error(`下载测试失败: ${res.status}`);
                        }
                        
                        const reader = res.body.getReader();
                        let streamReceived = 0;
                        
                        while(true) {
                            const {done, value} = await reader.read();
                            if(done || performance.now() - startTime > 10000) {
                                console.log(`流 ${i+1} 完成 - 接收: ${streamReceived} bytes`);
                                break;
                            }
                            
                            streamReceived += value.length;
                            totalReceived += value.length;
                            
                            const now = performance.now();
                            if (now - lastUpdate >= 1000) {
                                const duration = (now - startTime) / 1000;
                                const speedMBps = (totalReceived / (1024 * 1024)) / duration;
                                const speedMbps = speedMBps * 8;
                                sps.push(speedMbps);
                                this.updPg('download', speedMbps, (duration / 10) * 100);
                                lastUpdate = now;
                                console.log(`当前速度: ${speedMbps.toFixed(2)} Mb/s (${speedMBps.toFixed(2)} MB/s)`);
                            }
                        }
                    } catch (err) {
                        console.error(`下载流 ${i+1} 错误:`, err);
                        failedStreams++;
                    } finally {
                        clearTimeout(timeoutId);
                    }
                })();
                await new Promise(resolve => setTimeout(resolve, i * 200));
                activeStreams.push(streamPromise);
            }
            
            await Promise.all(activeStreams);
            console.log(`下载测试完成 - 总接收: ${totalReceived} bytes, 失败流: ${failedStreams}`);
            
            if (failedStreams === streams) {
                throw new Error('所有下载流都失败了');
            }
            
            if (totalReceived > 0) {
                const duration = (performance.now() - startTime) / 1000;
                const avgSpeedMBps = (totalReceived / (1024 * 1024)) / duration;
                const avgSpeedMbps = avgSpeedMBps * 8;
                const peakSpeedMbps = Math.max(...sps);
                
                return {
                    download_avg: avgSpeedMBps,
                    download_peak: Math.max(...sps.map(s => s/8))
                };
            }
            
            throw new Error('下载测试失败');
        } catch (err) {
            console.error('下载测试错误:', err);
            return { error: '下载测试失败' };
        }
    }
    async runUpTest() {
        const streams = 3;
        const sps = [];
        const chunkSize = 1024 * 1024;  // 1MB块
        const chunk = new Uint8Array(chunkSize);
        this.curTest = 'upload';
        let totalUploaded = 0;
        let failedStreams = 0;
        const startTime = performance.now();
        let lastUpdate = startTime;
        
        try {
            console.log(`开始上传测试 - 并发数: ${streams}, 每线程大小: ${this.uploadMax/streams}`);
            const activeStreams = [];
            
            for(let i = 0; i < streams; i++) {
                const streamPromise = (async () => {
                    let streamUploaded = 0;
                    const maxStreamSize = this.uploadMax / streams;
                    
                    while(streamUploaded < maxStreamSize && performance.now() - startTime <= 10000) {
                        try {
                            const res = await fetch('/upload_test', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/octet-stream'
                                },
                                body: chunk
                            });
                            
                            if (!res.ok) {
                                failedStreams++;
                                throw new Error('上传测试失败');
                            }
                            
                            streamUploaded += chunkSize;
                            totalUploaded += chunkSize;
                            
                            const now = performance.now();
                            if (now - lastUpdate >= 1000) {
                                const duration = (now - startTime) / 1000;
                                const speedMBps = (totalUploaded / (1024 * 1024)) / duration;
                                const speedMbps = speedMBps * 8;
                                sps.push(speedMbps);
                                this.updPg('upload', speedMbps, (duration / 10) * 100);
                                lastUpdate = now;
                                console.log(`当前速度: ${speedMbps.toFixed(2)} Mb/s (${speedMBps.toFixed(2)} MB/s)`);
                            }
                        } catch (err) {
                            console.error(`上传流 ${i+1} 错误:`, err);
                            failedStreams++;
                            break;
                        }
                    }
                    console.log(`上传流 ${i+1} 完成 - 上传: ${streamUploaded} bytes`);
                })();
                await new Promise(resolve => setTimeout(resolve, i * 200));
                activeStreams.push(streamPromise);
            }
            
            await Promise.all(activeStreams);
            console.log(`上传测试完成 - 总上传: ${totalUploaded} bytes, 失败流: ${failedStreams}`);
            
            if (failedStreams === streams) {
                throw new Error('所有上传流都失败了');
            }
            
            if (totalUploaded > 0) {
                const duration = (performance.now() - startTime) / 1000;
                const avgSpeedMBps = (totalUploaded / (1024 * 1024)) / duration;
                const avgSpeedMbps = avgSpeedMBps * 8;
                const peakSpeedMbps = Math.max(...sps);
                
                return {
                    upload_avg: avgSpeedMBps,
                    upload_peak: Math.max(...sps.map(s => s/8))  // 存MB/s
                };
            }
            
            throw new Error('上传测试失败');
        } catch (err) {
            console.error('上传测试错误:', err);
            return { error: '上传测试失败' };
        }
    }
    async saveRes(res) {
        try {
            await fetch('/save_test_results', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(res)
            });
        } catch (error) {
            console.error('保存结果失败:', error);
        }
    }
    showRes(res) {
        const resEl = document.getElementById('results');
        if (resEl) {
            resEl.innerHTML = `
                <div class="r-con">
                    <div class="r-row">
                        <div class="r-crd">
                            <span class="l">延迟</span>
                            <span class="v">${res.ping_avg} ms</span>
                        </div>
                        <div class="r-crd">
                            <span class="l">抖动</span>
                            <span class="v">${res.jitter} ms</span>
                        </div>
                        <div class="r-crd">
                            <div class="sp-grp">
                                <div class="sp-l">下载速度</div>
                                <div class="sp-i">
                                    <div class="sp-r">
                                        <span class="sl">平均</span>
                                        <span class="v">${(res.download_avg * 8).toFixed(2)} Mb/s</span>
                                    </div>
                                    <div class="sp-r">
                                        <span class="sl">峰值</span>
                                        <span class="v">${(res.download_peak * 8).toFixed(2)} Mb/s</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="r-crd">
                            <div class="sp-grp">
                                <div class="sp-l">上传速度</div>
                                <div class="sp-i">
                                    <div class="sp-r">
                                        <span class="sl">平均</span>
                                        <span class="v">${(res.upload_avg * 8).toFixed(2)} Mb/s</span>
                                    </div>
                                    <div class="sp-r">
                                        <span class="sl">峰值</span>
                                        <span class="v">${(res.upload_peak * 8).toFixed(2)} Mb/s</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            setTimeout(() => {
                const newResCon = resEl.querySelector('.r-con');
                if (newResCon) {
                    newResCon.classList.add('show');
                }
            }, 10);
        }
    }
    showErr(msg) {
        const resEl = document.getElementById('results');
        if (resEl) {
            resEl.innerHTML = `
                <div class="r-con">
                    <div class="err-msg">${msg}</div>
                </div>
            `;
            setTimeout(() => {
                const newResCon = resEl.querySelector('.r-con');
                if (newResCon) {
                    newResCon.classList.add('show');
                }
            }, 10);
        }
    }
    async updHis() {
        try {
            const res = await fetch('/get_records');
            const recs = await res.json();
            const hisList = document.getElementById('historyList');
            if (hisList) {
                if (recs && recs.length > 0) {
                    const rows = recs.map(rec => {
                        const ts = rec.timestamp.split(' ');
                        const date = ts[0].split('-').slice(1).join('-');
                        const time = ts[1];
                        let loc = rec.ip === '127.0.0.1' ? '本地' : '未知';
                        if (rec.location) {
                            loc = `${rec.location.region}-${rec.location.city}`.replace('省', '').replace('市', '');
                        }
                        return `
                            <tr>
                                <td>${date}<br>${time}</td>
                                <td>${rec.ip}<br>${loc}</td>
                                <td>${rec.results.download_avg.toFixed(2)}</td>
                                <td>${rec.results.download_peak.toFixed(2)}</td>
                                <td>${rec.results.upload_avg.toFixed(2)}</td>
                                <td>${rec.results.upload_peak.toFixed(2)}</td>
                                <td>${rec.results.ping_avg}</td>
                                <td>${rec.results.jitter}</td>
                                <td>${rec.results.download_size}/${rec.results.upload_size}</td>
                            </tr>
                        `;
                    }).join('');
                    hisList.innerHTML = rows;
                } else {
                    hisList.innerHTML = `
                        <tr>
                            <td colspan="9" class="no-recs">暂无测速记录</td>
                        </tr>
                    `;
                }
            }
        } catch (err) {
            console.error('更新历史记录失败:', err);
            const hisList = document.getElementById('historyList');
            if (hisList) {
                hisList.innerHTML = `
                    <tr>
                        <td colspan="9" class="err-msg">加载历史记录失败</td>
                    </tr>
                `;
            }
        }
    }
}
if (!window.spTest) {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('页面加载完成，初始化 SpTest...');
        try {
            window.spTest = new SpTest();
        } catch (err) {
            console.error('SpTest 初始化失败:', err);
        }
    });
} 