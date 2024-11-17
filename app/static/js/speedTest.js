class SpTest {
    constructor() {
        this.config = null;
        this.uploadData = null;
        this.getCfg().then(() => {
            this.initEvt();
            this.updHis();
        }).catch(err => {
            console.error('初始化失败:', err);
        });
    }
    async getCfg() {
        try {
            const res = await fetch('/get_test_config');
            if (!res.ok) throw new Error('获取配置失败');
            
            this.config = await res.json();
            console.log('获取到测试配置:', {
                chunkSize: this.config.chunk_size / (1024 * 1024) + 'MB',
                bufferSize: this.config.buffer_size / 1024 + 'KB',
                downloadMax: this.config.download_max / (1024 * 1024) + 'MB',
                uploadMax: this.config.upload_max / (1024 * 1024) + 'MB'
            });
            
            this.chunkSize = this.config.chunk_size;
            this.bufferSize = this.config.buffer_size;
            this.downloadMax = this.config.download_max;
            this.uploadMax = this.config.upload_max;
        } catch (err) {
            console.error('获取配置失败:', err);
            // 前端默认配置，防止配置文件丢失或未配置
            this.chunkSize = 1 * 1024 * 1024;      // 块1MB
            this.bufferSize = 128 * 1024;          // 缓冲128KB
            this.downloadMax = 300 * 1024 * 1024;  // 下载300MB
            this.uploadMax = 100 * 1024 * 1024;    // 上传100MB
            console.log('使用默认配置');
        }
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
    updateProgress(type, speed, progress, isTransition = false) {
        const pgFill = document.querySelector('.pg-fill');
        const pgLab = document.querySelector('#progressLabel');
        
        if (!pgFill || !pgLab) return;

        let actualProgress = progress;
        switch(type) {
            case 'ping':
                actualProgress = (progress / 5) * 20;
                break;
            case 'download':
                actualProgress = 20 + (progress * 0.4);
                break;
            case 'upload':
                actualProgress = 60 + (progress * 0.4);
                break;
            case 'transition':
                actualProgress = progress;
                break;
            case 'complete':
                actualProgress = 100;
                break;
            case 'error':
            case 'init':
                actualProgress = 0;
                break;
        }

        actualProgress = Math.max(0, Math.min(100, actualProgress));
        //增加过度动画以防认为死机了
        if (isTransition) {
            pgFill.style.transition = 'width 0.5s ease-in-out';
        } else {
            pgFill.style.transition = 'width 0.2s linear';
        }
        
        pgFill.style.width = `${actualProgress}%`;

        if (type === 'download' || type === 'upload') {
            pgLab.textContent = `正在测试${type === 'download' ? '下载' : '上传'}速度: ${speed.toFixed(2)} Mb/s (${actualProgress.toFixed(1)}%)`;
        } else if (type === 'ping') {
            pgLab.textContent = `正在测试延迟: ${speed.toFixed(2)} ms (${actualProgress.toFixed(1)}%)`;
        } else if (type === 'transition') {
            if (progress <= 20) {
                pgLab.textContent = '准备开始下载测试...';
            } else if (progress <= 60) {
                pgLab.textContent = '准备开始上传测试...';
            }
        } else if (type === 'complete') {
            pgLab.textContent = '测试完成 (100%)';
        } else if (type === 'error') {
            pgLab.textContent = '测试失败 (0%)';
        } else {
            pgLab.textContent = '准备开始测试... (0%)';
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
        
        this.updateProgress('init', 0, 0);
        
        try {
            const [pingRes, ] = await Promise.all([
                this.runPingTest(),
                this.prepareUploadData()
            ]);
            
            if (pingRes.error) throw new Error(pingRes.error);
            
            this.updateProgress('transition', 0, 20, true);
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const dlRes = await Promise.race([
                this.runDlTest(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('下载测试超时')), 10000)
                )
            ]);
            if (dlRes.error) throw new Error(dlRes.error);

            this.updateProgress('transition', 0, 60, true);
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const upRes = await Promise.race([
                this.runUpTest(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('上传测试超时')), 10000)
                )
            ]);
            if (upRes.error) throw new Error(upRes.error);
            
            const res = {...pingRes, ...dlRes, ...upRes};
            await this.saveRes(res);
            await this.updHis();
            
            this.updateProgress('complete', 100, 100, true);
            pgCon.style.transition = 'opacity 1.5s cubic-bezier(0.4, 0, 0.2, 1)';
            pgCon.style.opacity = '0';
            await new Promise(resolve => setTimeout(resolve, 1500));
            pgCon.style.display = 'none';
            this.showRes(res);
            
        } catch (err) {
            console.error('测试失败:', err);
            this.showErr(err.message || '测试失败，请重试');
            this.updateProgress('error', 0, 0);
        }
    }
    async runPingTest() {
        const pings = [];
        const count = 5; 
        
        try {
            for(let i = 0; i < count; i++) {
                try {
                    await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
                
                    const start = performance.now();
                    const res = await fetch('/ping');
                    const data = await res.json(); 
                    const end = performance.now();
                    
                    if (!res.ok || data.status !== 'ok') {
                        throw new Error('Ping响应无效');
                    }
                    
                    const pingTime = Math.max(1, end - start);
                    console.log(`Ping测试 ${i+1}: ${pingTime.toFixed(2)}ms`);
                    pings.push(pingTime);
                    
                    this.updateProgress('ping', pingTime, ((i + 1) / count) * 100);
                    
                } catch (err) {
                    console.error(`Ping测试第${i+1}次失败:`, err);
                    const avgPing = pings.length > 0 ? 
                        pings.reduce((a, b) => a + b, 0) / pings.length : 
                        100;
                    pings.push(avgPing);
                }
            }
            
            const validPings = pings.filter(p => {
                const mean = pings.reduce((a, b) => a + b, 0) / pings.length;
                const stdDev = Math.sqrt(
                    pings.map(x => Math.pow(x - mean, 2))
                         .reduce((a, b) => a + b, 0) / pings.length
                );
                return Math.abs(p - mean) <= 2 * stdDev;
            });
            
            if (validPings.length === 0) {
                throw new Error('没有有效的Ping测试结果');
            }
            
            const avgPing = validPings.reduce((a, b) => a + b, 0) / validPings.length;
            
            let lastPing = validPings[0];
            const jitters = [];
            for (let i = 1; i < validPings.length; i++) {
                const currentPing = validPings[i];
                const jitter = Math.abs(currentPing - lastPing);
                jitters.push(jitter);
                lastPing = currentPing;
            }
            
            const avgJitter = jitters.length > 0 ? 
                jitters.reduce((a, b) => a + b, 0) / jitters.length : 
                0;
                
            console.log('Ping测试结果:', {
                pings: validPings.map(p => p.toFixed(2) + 'ms'),
                avgPing: avgPing.toFixed(2) + 'ms',
                jitter: avgJitter.toFixed(2) + 'ms'
            });
            
            return {
                ping_avg: Math.round(avgPing),
                jitter: Math.round(avgJitter)
            };
        } catch (err) {
            console.error('Ping测试失败:', err);
            return { error: err.message || 'Ping测试失败' };
        }
    }
    async runDlTest() {
        const streams = 6;
        const sps = [];
        let totalReceived = 0;
        let failedStreams = 0;
        const startTime = performance.now();
        let lastUpdate = startTime;
        const abortController = new AbortController();

        try {
            setTimeout(() => abortController.abort(), 10000);
            const activeStreams = [];
            const threadSize = Math.floor(this.downloadMax / streams);
            console.log(`下载测试 - 总大小: ${this.downloadMax/1024/1024}MB, 线程数: ${streams}, 每线程: ${threadSize/1024/1024}MB`);
            
            for(let i = 0; i < streams; i++) {
                const streamPromise = (async () => {
                    try {
                        const start = i * threadSize;
                        const end = (i + 1) * threadSize - 1;
                        console.log(`下载线程 ${i+1} - 范围: ${start/1024/1024}MB - ${end/1024/1024}MB`);
                        
                        const res = await fetch('/download_test', {
                            signal: abortController.signal,
                            headers: {
                                'Range': `bytes=${start}-${end}`,
                                'Cache-Control': 'no-cache',
                                'Pragma': 'no-cache'
                            }
                        });

                        if (!res.ok) throw new Error(`下载测试失败: ${res.status}`);
                        
                        const reader = res.body.getReader();
                        while(true) {
                            const {done, value} = await reader.read();
                            if(done) break;
                            
                            totalReceived += value.length;
                            
                            const now = performance.now();
                            if (now - lastUpdate >= 200) {
                                const duration = (now - startTime) / 1000;
                                const speedMBps = (totalReceived / (1024 * 1024)) / duration;
                                const speedMbps = speedMBps * 8;
                                sps.push(speedMbps);
                                this.updateProgress('download', speedMbps, (duration / 10) * 100);
                                lastUpdate = now;
                                console.log(`下载速度: ${speedMbps.toFixed(2)} Mb/s, 已接收: ${totalReceived} bytes`);
                            }
                        }
                    } catch (err) {
                        if (err.name === 'AbortError') {
                            console.log('下载测试已终止');
                        } else {
                            console.error(`下载流 ${i+1} 错误:`, err);
                            failedStreams++;
                        }
                    }
                })();
                activeStreams.push(streamPromise);
            }
            
            await Promise.all(activeStreams);
            
            if (failedStreams === streams) throw new Error('所有下载流都失败了');
            
            if (totalReceived > 0) {
                const duration = (performance.now() - startTime) / 1000;
                const avgSpeedMBps = (totalReceived / (1024 * 1024)) / duration;
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
        let totalUploaded = 0;
        let failedStreams = 0;
        const startTime = performance.now();
        let lastUpdate = startTime;
        const abortController = new AbortController();

        try {
            setTimeout(() => abortController.abort(), 10000);
            const activeStreams = [];
            const threadSize = Math.floor(this.uploadMax / streams);
            console.log(`上传测试 - 总大小: ${this.uploadMax/1024/1024}MB, 线程数: ${streams}, 每线程: ${threadSize/1024/1024}MB`);
            
            if (!this.uploadData) {
                console.warn('上传数据未准备好，重新准备');
                await this.prepareUploadData();
            }
            
            console.log(`上传测试配置检查:
                总大小: ${this.uploadMax/1024/1024}MB
                线程数: ${streams}
                每线程: ${threadSize/1024/1024}MB
                块大小: ${this.chunkSize/1024/1024}MB
                缓冲区: ${this.bufferSize/1024}KB
            `);
            
            const chunkSize = Math.min(this.chunkSize, threadSize);
            console.log(`上传块大小: ${chunkSize/1024/1024}MB, 缓冲区大小: ${this.bufferSize/1024}KB`);

            const baseChunk = new Uint8Array(chunkSize);
            for(let i = 0; i < baseChunk.length; i++) {
                baseChunk[i] = i % 256;
            }
            
            for(let i = 0; i < streams; i++) {
                const streamPromise = (async () => {
                    let streamUploaded = 0;
                    
                    try {
                        while(streamUploaded < threadSize) {
                            const remainingSize = threadSize - streamUploaded;
                            const currentChunkSize = Math.min(chunkSize, remainingSize);
                            
                            const chunk = this.uploadData ? this.uploadData.slice(0, currentChunkSize) : 
                                                         baseChunk.slice(0, currentChunkSize);
                            
                            const res = await fetch('/upload_test', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/octet-stream',
                                    'Content-Length': currentChunkSize.toString(),
                                    'X-Upload-Size': threadSize.toString(), 
                                    'X-Chunk-Size': currentChunkSize.toString()
                                },
                                body: chunk,
                                signal: abortController.signal
                            });

                            if (!res.ok) {
                                console.error('上传失败:', await res.text());
                                throw new Error('上传失败');
                            }
                            
                            const data = await res.json();
                            if (data.status !== 'ok') {
                                console.error('上传响应无效:', data);
                                throw new Error('上传响应无效');
                            }
                            
                            streamUploaded += currentChunkSize;
                            totalUploaded += currentChunkSize;
                            
                            const now = performance.now();
                            if (now - lastUpdate >= 200) {
                                const duration = (now - startTime) / 1000;
                                const speedMBps = (totalUploaded / (1024 * 1024)) / duration;
                                const speedMbps = speedMBps * 8;
                                sps.push(speedMbps);
                                this.updateProgress('upload', speedMbps, (duration / 10) * 100);
                                lastUpdate = now;
                                console.log(`上传速度: ${speedMbps.toFixed(2)} Mb/s, 已上传: ${(totalUploaded / (1024 * 1024)).toFixed(2)}MB, 流 ${i+1}`);
                            }
                            
                            if (performance.now() - startTime >= 10000) {
                                console.log(`上传测试达到10秒时限，流 ${i+1} 已上传: ${(streamUploaded / (1024 * 1024)).toFixed(2)}MB`);
                                break;
                            }
                            
                            await new Promise(resolve => setTimeout(resolve, Math.floor(this.bufferSize / (1024 * 10)))); // 大约每MB数据暂停1ms
                        }
                    } catch (err) {
                        if (err.name === 'AbortError') {
                            console.log(`上传流 ${i+1} 已终止，已上传: ${(streamUploaded / (1024 * 1024)).toFixed(2)}MB`);
                        } else {
                            console.error(`上传流 ${i+1} 错误:`, err);
                            failedStreams++;
                        }
                    }
                })();

                await new Promise(resolve => setTimeout(resolve, Math.floor(this.bufferSize / 1024)));
                activeStreams.push(streamPromise);
            }
            
            await Promise.all(activeStreams);
            
            if (failedStreams === streams) throw new Error('所有上传流都失败了');
            
            if (totalUploaded > 0) {
                const duration = (performance.now() - startTime) / 1000;
                const avgSpeedMBps = (totalUploaded / (1024 * 1024)) / duration;
                console.log(`上传测试完成 - 总上传: ${(totalUploaded / (1024 * 1024)).toFixed(2)}MB, 平均速度: ${(avgSpeedMBps * 8).toFixed(2)}Mb/s`);
                return {
                    upload_avg: avgSpeedMBps,
                    upload_peak: Math.max(...sps.map(s => s/8))
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
    async prepareUploadData() {
        try {
            const chunkSize = Math.min(this.chunkSize, Math.floor(this.uploadMax / 3));
            console.log(`预生成上传数据块: ${chunkSize/1024/1024}MB (配置: chunkSize=${this.chunkSize/1024/1024}MB, uploadMax=${this.uploadMax/1024/1024}MB)`);
            
            this.uploadData = new Uint8Array(chunkSize);
            for(let i = 0; i < this.uploadData.length; i++) {
                this.uploadData[i] = i % 256;
            }
            
            console.log('上传数据准备完成');
        } catch (err) {
            console.error('预生成上传数据失败:', err);
            this.uploadData = null;
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