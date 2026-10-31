// 粘贴到微信开发者工具的调试器 Console 运行：逐级加压，记录成功率和延迟，找到真实的并发和 QPS 上限。
(async () => {
  const levels = [10, 20, 50, 100, 200, 400];
  const report = [];
  for (const level of levels) {
    const start = Date.now();
    const results = await Promise.allSettled(
      Array.from({ length: level }, () => wx.cloud.callFunction({ name: 'spikeprobe', data: { action: 'ping' } })),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    report.push({
      concurrent: level,
      seconds: (Date.now() - start) / 1000,
      failed: failed.length,
      firstError: failed[0]?.reason?.errMsg ?? null,
    });
    console.table(report);
    if (failed.length > level * 0.2) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  console.log('把这张表记进 SPIKE.md', JSON.stringify(report));
})();
