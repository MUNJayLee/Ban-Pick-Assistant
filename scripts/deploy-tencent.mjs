import COS from 'cos-nodejs-sdk-v5';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, extname } from 'path';

const SECRET_ID = process.env.COS_SECRET_ID;
const SECRET_KEY = process.env.COS_SECRET_KEY;

if (!SECRET_ID || !SECRET_KEY) {
  console.error('缺少 COS_SECRET_ID / COS_SECRET_KEY 环境变量');
  process.exit(1);
}

const BUCKET = 'bp-assistant-1311691999';
const REGION = 'ap-shanghai';
const DIST = 'dist';

const cos = new COS({ SecretId: SECRET_ID, SecretKey: SECRET_KEY });

function call(method, params) {
  return new Promise((resolve, reject) => {
    cos[method](params, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function contentType(file) {
  return MIME[extname(file).toLowerCase()] || 'application/octet-stream';
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

async function main() {
  // 1) 列出已有桶
  console.log('[1/4] 列出已有桶...');
  const { Buckets } = await call('getService', {});
  for (const b of Buckets) console.log('  已有桶:', b.Name, b.Location);

  // 2) 创建桶（已存在则忽略）
  console.log(`[2/4] 确保桶 ${BUCKET} (${REGION}) 存在...`);
  try {
    await call('putBucket', { Bucket: BUCKET, Region: REGION });
    console.log('  已创建');
  } catch (e) {
    if (e.code === 'BucketAlreadyOwnedByYou' || e.statusCode === 409) {
      console.log('  已存在');
    } else {
      throw e;
    }
  }

  // 2.5) 桶设为公有读（否则不存在的路径返回 403，SPA 回退不生效）
  console.log('  设置桶为公有读...');
  await call('putBucketAcl', { Bucket: BUCKET, Region: REGION, ACL: 'public-read' });

  // 3) 上传 dist 所有文件
  console.log('[3/4] 上传文件...');
  const files = walk(DIST);
  let n = 0;
  for (const file of files) {
    const key = file.replace(/\\/g, '/').replace(/^dist\//, '');
    await call('putObject', {
      Bucket: BUCKET,
      Region: REGION,
      Key: key,
      Body: readFileSync(file),
      ContentType: contentType(file),
      ContentDisposition: 'inline',
      ACL: 'public-read',
    });
    n++;
  }
  console.log(`  已上传 ${n} 个文件`);

  // 4) 开启静态网站（SPA：错误页回退到 index.html）
  console.log('[4/4] 配置静态网站...');
  await call('putBucketWebsite', {
    Bucket: BUCKET,
    Region: REGION,
    WebsiteConfiguration: {
      IndexDocument: { Suffix: 'index.html' },
      ErrorDocument: { Key: 'index.html' },
    },
  });
  console.log('  完成');
  console.log('\n✅ 部署完成，访问地址：');
  console.log(`   https://${BUCKET}.cos-website.${REGION}.myqcloud.com`);
}

main().catch((e) => {
  console.error('部署失败：', e.message || JSON.stringify(e));
  process.exit(1);
});
