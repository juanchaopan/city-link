// 下载官方公开文档并抽取纯文本，供 SPIKE.md 引用原文。只发 GET，不带任何凭据。
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'out', 'docs');
mkdirSync(out, { recursive: true });

const wx = 'https://developers.weixin.qq.com/minigame/dev/wxcloud';
const cb = 'https://docs.cloudbase.net';
const pages = {
  price: `${wx}/billing/price.html`,
  switchGuide: `${wx}/billing/Billing_Instructions.html`,
  quota: `${wx}/reference/quota.html`,
  quota2: `${wx}/basis/concepts/quota.html`,
  calculator: 'https://cloud.weixin.qq.com/cloudbase/price',
  package: 'https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloud/billing/package.html',
  expiration: `${wx}/billing/expiration-rule.html`,
  triggers: `${wx}/guide/functions/triggers.html`,
  transaction: `${wx}/guide/database/transaction.html`,
  transactionEn: `${cb}/en/database/transaction`,
  fnConfig: `${cb}/en/cloud-function/function-configuration/config`,
  notice: 'https://developers.weixin.qq.com/community/minihome/doc/0000a680588d3891fa2ec250c51401',
  backup: `${wx}/guide/database/backup.html`,
  qpsControl: `${cb}/en/envconfig/qps-control`,
  tencentPrice: 'https://cloud.tencent.com/document/product/876/127357',
};

function toText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n');
}

for (const [name, url] of Object.entries(pages)) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) });
    const body = await res.text();
    const text = toText(body);
    writeFileSync(join(out, `${name}.txt`), `${url}\nHTTP ${res.status}\n\n${text}`);
    console.log(name, res.status, body.length, text.length);
  } catch (error) {
    console.log(name, 'FAILED', error.message);
  }
}
