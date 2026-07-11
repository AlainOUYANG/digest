// 一次性引导脚本：从 digest.zhangtenggan.cn 公开归档的即刻栏目提取活跃作者，
// 生成 config/jike-users.json 初始名单。只读抓取，限速 1 req/s。
const SITE = 'https://digest.zhangtenggan.cn';
const MAX_ISSUES = 15;
const MAX_POSTS = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (bootstrap-jike)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
};

const archive = await get(`${SITE}/archive.html`);
const issuePaths = [...new Set(archive.match(/\/jike\/[0-9-]+\.html/g) ?? [])]
  .sort()
  .reverse()
  .slice(0, MAX_ISSUES);
console.error(`扫描 ${issuePaths.length} 期即刻简报…`);

const postUrls = new Set();
for (const path of issuePaths) {
  await sleep(1000);
  try {
    const html = await get(SITE + path);
    for (const u of html.match(/https?:\/\/m\.okjike\.com\/originalPosts\/[0-9a-f]+/g) ?? []) {
      postUrls.add(u);
    }
  } catch (e) {
    console.error(`跳过 ${path}: ${e.message}`);
  }
}
const posts = [...postUrls].slice(0, MAX_POSTS);
console.error(`共 ${postUrls.size} 条原帖，解析前 ${posts.length} 条…`);

const users = new Map();
for (const url of posts) {
  await sleep(1000);
  try {
    const html = await get(url);
    // 页面内嵌 JSON 的第一个 user 对象即帖子作者；username 与 screenName 相邻成对
    const m = html.match(/"username":"([^"]+)","screenName":"([^"]+)"/);
    const id = m?.[1];
    const name = m?.[2];
    if (id && name && !users.has(id)) {
      users.set(id, name);
      console.error(`  + ${name}`);
    }
  } catch (e) {
    console.error(`跳过 ${url}: ${e.message}`);
  }
}

const list = [...users].map(([id, name]) => ({ id, name }));
console.log(JSON.stringify(list, null, 2));
console.error(`共 ${list.length} 位作者`);
