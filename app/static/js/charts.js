class SpChart {
    constructor() {
        this.chart = null;
        this.ldHis();
    }

    async ldHis() {
        try {
            const res = await fetch('/get_records');
            const recs = await res.json();
            if (recs && recs.length > 0) {
                this.showChart(recs);
            }
        } catch (err) {
            console.error('加载历史记录失败:', err);
        }
    }

    showChart(recs) {
        const ctx = document.getElementById('hisChart');
        if (!ctx) return;

        // 准备数据
        const labels = recs.map(rec => {
            const ts = rec.timestamp.split(' ');
            return `${ts[0].split('-').slice(1).join('-')} ${ts[1]}`;
        }).reverse();

        const dlData = recs.map(rec => rec.results.download_avg).reverse();
        const ulData = recs.map(rec => rec.results.upload_avg).reverse();

        if (this.chart) {
            this.chart.destroy();
        }

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: '下载速度 (Mb/s)',
                    data: dlData,
                    borderColor: 'rgb(75, 192, 192)',
                    tension: 0.1,
                    fill: false
                }, {
                    label: '上传速度 (Mb/s)',
                    data: ulData,
                    borderColor: 'rgb(255, 99, 132)',
                    tension: 0.1,
                    fill: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: '速度 (Mb/s)'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: '测试时间'
                        }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top'
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                }
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.spChart = new SpChart();
}); 