class SpTest {
    constructor() {
        this.progressFill = document.querySelector('.pg-fill');
        this.progressLabel = document.querySelector('#progressLabel');
        this.testSection = document.querySelector('.t-sec');
        this.progressContainer = document.querySelector('.pg-con');
        this.resultContainer = document.querySelector('.r-con');
        this.resultElement = document.getElementById('results');
        this.historyList = document.getElementById('historyList');
        
        this.config = null;
        this.uploadData = null;
        this.getCfg().then(() => {
            this.initEvt();
            this.updHis();
            this.prepareUploadData();
        });
    }

    async getCfg() {
        try {
            const res = await fetch('/get_test_config');
            if (!res.ok) throw new Error('获取配置失败');
            this.config = await res.json();
            this.chunkSize = this.config.chunk_size;
            this.bufferSize = this.config.buffer_size;
            this.downloadMax = this.config.download_max;
            this.uploadMax = this.config.upload_max;
        } catch (err) {
            this.chunkSize = 1 * 1024 * 1024;
            this.bufferSize = 128 * 1024;
            this.downloadMax = 300 * 1024 * 1024;
            this.uploadMax = 100 * 1024 * 1024;
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
        if (!this.progressFill || !this.progressLabel) return;

        requestAnimationFrame(() => {
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
            
            this.progressFill.style.transition = isTransition ? 
                'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)' : 
                'width 0.2s linear';
            this.progressFill.style.width = `${actualProgress}%`;

            let labelText = '准备开始测试... (0%)';
            if (type === 'download' || type === 'upload') {
                labelText = `正在测试${type === 'download' ? '下载' : '上传'}速度: ${speed.toFixed(2)} Mb/s (${actualProgress.toFixed(1)}%)`;
            } else if (type === 'ping') {
                labelText = `正在测试延迟: ${speed.toFixed(2)} ms (${actualProgress.toFixed(1)}%)`;
            } else if (type === 'transition') {
                labelText = progress <= 20 ? '准备开始下载测试...' : '准备开始上传测试...';
            } else if (type === 'complete') {
                labelText = '测试完成 (100%)';
            } else if (type === 'error') {
                labelText = '测试失败 (0%)';
            }
            
            if (this.progressLabel.textContent !== labelText) {
                this.progressLabel.textContent = labelText;
            }
        });
    }

    async startTest() {
        if (!this.testSection || !this.progressContainer || !this.resultContainer) return;
        
        this.testSection.style.display = 'block';
        this.progressContainer.style.display = 'block';
        this.progressContainer.style.opacity = '1';
        
        this.testSection.classList.add('show');
        this.progressContainer.classList.add('show');
        
        if (this.resultContainer) {
            this.resultContainer.classList.remove('show');
            this.resultContainer.style.display = 'none';
        }
        
        this.updateProgress('init', 0, 0);
        
        try {
            const [pingRes, ] = await Promise.all([
                this.runPingTest(),
                this.prepareUploadData()
            ]);
            
            if (pingRes.error) throw new Error(pingRes.error);
            
            this.updateProgress('transition', 0, 20, true);
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const dlRes = await this.runDlTest();
            if (dlRes.error) throw new Error(dlRes.error);

            this.updateProgress('transition', 0, 60, true);
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const upRes = await this.runUpTest();
            if (upRes.error) throw new Error(upRes.error);
            
            const res = {...pingRes, ...dlRes, ...upRes};
            await this.saveRes(res);
            await this.updHis();
            
            this.updateProgress('complete', 100, 100, true);
            this.progressContainer.style.transition = 'opacity 1.5s cubic-bezier(0.4, 0, 0.2, 1)';
            this.progressContainer.style.opacity = '0';
            await new Promise(resolve => setTimeout(resolve, 1500));
            this.progressContainer.style.display = 'none';
            this.showRes(res);
            
        } catch (err) {
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
                    pings.push(pingTime);
                    
                    this.updateProgress('ping', pingTime, ((i + 1) / count) * 100);
                    
                } catch (err) {
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
                
            return {
                ping_avg: Math.round(avgPing),
                jitter: Math.round(avgJitter)
            };
        } catch (err) {
            return { error: err.message || 'Ping测试失败' };
        }
    }

    async runDlTest() {
        const streams = 6;
        const streamReceivedData = Array(streams).fill(0);
        const speedSamples = [];
        let failedStreams = 0;
        const startTime = performance.now();
        const abortController = new AbortController();

        try {
            const activeStreams = [];
            const threadSize = Math.floor(this.downloadMax / streams);
            
            for(let i = 0; i < streams; i++) {
                const streamPromise = (async () => {
                    try {
                        const start = i * threadSize;
                        const end = (i + 1) * threadSize - 1;
                        
                        const res = await fetch('/download_test', {
                            signal: abortController.signal,
                            headers: {
                                'Range': `bytes=${start}-${end}`,
                                'Cache-Control': 'no-cache'
                            }
                        });

                        if (!res.ok) throw new Error(`下载测试失败: ${res.status}`);
                        
                        const reader = res.body.getReader();
                        while(true) {
                            const {done, value} = await reader.read();
                            if(done) break;
                            streamReceivedData[i] += value.length;
                        }
                    } catch (err) {
                        if (err.name !== 'AbortError') {
                            failedStreams++;
                        }
                    }
                })();
                activeStreams.push(streamPromise);
            }
            
            setTimeout(() => abortController.abort(), 10000);
            
            const speedTimer = setInterval(() => {
                const now = performance.now();
                const totalReceived = streamReceivedData.reduce((a, b) => a + b, 0);
                const duration = (now - startTime) / 1000;
                const currentSpeed = ((totalReceived / (1024 * 1024)) / duration) * 8;
                
                if (currentSpeed > 0) {
                    speedSamples.push(currentSpeed);
                    this.updateProgress('download', currentSpeed, (duration / 10) * 100);
                }
            }, 1000);

            await Promise.all(activeStreams);
            clearInterval(speedTimer);

            if (failedStreams === streams) throw new Error('所有下载流都失败了');
            
            if (speedSamples.length > 0) {
                const peakSpeed = Math.max(...speedSamples);
                speedSamples.sort((a, b) => a - b);
                const cutoff = Math.ceil(speedSamples.length * 0.05);
                const validSamples = speedSamples.slice(cutoff);
                const avgSpeed = validSamples.reduce((a, b) => a + b, 0) / validSamples.length;

                return {
                    download_avg: avgSpeed,
                    download_peak: peakSpeed
                };
            }
            
            throw new Error('下载测试失败');
        } catch (err) {
            return { error: '下载测试失败' };
        }
    }

    async runUpTest() {
        const streams = 3;
        const streamUploadedData = Array(streams).fill(0);
        const speedSamples = [];
        let failedStreams = 0;
        const startTime = performance.now();
        const abortController = new AbortController();

        try {
            const activeStreams = [];
            const threadSize = Math.floor(this.uploadMax / streams);
            
            if (!this.uploadData) {
                await this.prepareUploadData();
            }
            
            for(let i = 0; i < streams; i++) {
                const streamPromise = (async () => {
                    try {
                        while(streamUploadedData[i] < threadSize) {
                            const remainingSize = threadSize - streamUploadedData[i];
                            const currentChunkSize = Math.min(this.chunkSize, remainingSize);
                            
                            const chunk = this.uploadData.slice(0, currentChunkSize);
                            
                            const res = await fetch('/upload_test', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/octet-stream',
                                    'Content-Length': currentChunkSize.toString()
                                },
                                body: chunk,
                                signal: abortController.signal
                            });

                            if (!res.ok) throw new Error('上传失败');
                            
                            const data = await res.json();
                            if (data.status !== 'ok') throw new Error('上传响应无效');
                            
                            streamUploadedData[i] += currentChunkSize;
                            
                            if (performance.now() - startTime >= 10000) break;
                            
                            await new Promise(resolve => setTimeout(resolve, 10));
                        }
                    } catch (err) {
                        if (err.name !== 'AbortError') {
                            failedStreams++;
                        }
                    }
                })();

                await new Promise(resolve => setTimeout(resolve, 50));
                activeStreams.push(streamPromise);
            }
            
            setTimeout(() => abortController.abort(), 10000);
            
            const speedTimer = setInterval(() => {
                const now = performance.now();
                const totalUploaded = streamUploadedData.reduce((a, b) => a + b, 0);
                const duration = (now - startTime) / 1000;
                const currentSpeed = ((totalUploaded / (1024 * 1024)) / duration) * 8;
                
                if (currentSpeed > 0) {
                    speedSamples.push(currentSpeed);
                    this.updateProgress('upload', currentSpeed, (duration / 10) * 100);
                }
            }, 1000);

            await Promise.all(activeStreams);
            clearInterval(speedTimer);

            if (failedStreams === streams) throw new Error('所有上传流都失败了');
            
            if (speedSamples.length > 0) {
                const peakSpeed = Math.max(...speedSamples);
                speedSamples.sort((a, b) => a - b);
                const cutoff = Math.ceil(speedSamples.length * 0.05);
                const validSamples = speedSamples.slice(cutoff);
                const avgSpeed = validSamples.reduce((a, b) => a + b, 0) / validSamples.length;

                return {
                    upload_avg: avgSpeed,
                    upload_peak: peakSpeed
                };
            }
            
            throw new Error('上传测试失败');
        } catch (err) {
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
        } catch (error) {}
    }

    showRes(res) {
        if (!this.resultElement) return;
        
        const html = `
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
                                    <span class="v">${res.download_avg.toFixed(2)} Mb/s</span>
                                </div>
                                <div class="sp-r">
                                    <span class="sl">峰值</span>
                                    <span class="v">${res.download_peak.toFixed(2)} Mb/s</span>
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
                                    <span class="v">${res.upload_avg.toFixed(2)} Mb/s</span>
                                </div>
                                <div class="sp-r">
                                    <span class="sl">峰值</span>
                                    <span class="v">${res.upload_peak.toFixed(2)} Mb/s</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        this.resultElement.innerHTML = html;
        
        requestAnimationFrame(() => {
            const newResCon = this.resultElement.querySelector('.r-con');
            if (newResCon) {
                newResCon.classList.add('show');
            }
        });
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
            const baseChunkSize = this.chunkSize;
            this.uploadData = new Uint8Array(baseChunkSize);
            
            const pattern = new Uint8Array(256);
            for(let i = 0; i < 256; i++) {
                pattern[i] = i;
            }
            
            for(let i = 0; i < this.uploadData.length; i += 256) {
                this.uploadData.set(pattern.slice(0, Math.min(256, this.uploadData.length - i)), i);
            }
        } catch (err) {
            this.uploadData = null;
        }
    }
}

if (!window.spTest) {
    document.addEventListener('DOMContentLoaded', () => {
        try {
            window.spTest = new SpTest();
        } catch (err) {}
    });
} 
