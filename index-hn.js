const fs = require('fs');

// --- 1. 你要抓取的源列表配置 ---
const TASKS = [
  { url: "https://live.lizanyang.top/hn.m3u", ua: "Mozilla/5.0" },
  { url: "https://itv.aptv.app/china-iptv/hnyd.m3u", ua: "AptvPlayer/1.2.5(iPhone)" },
  { url: "https://itv.aptv.app/china-iptv/zgyd.m3u", ua: "AptvPlayer/1.2.5(iPhone)" },
  { url: "https://itv.5iclub.dpdns.org/MiGu.m3u", ua: "AptvPlayer/1.2.5(iPhone)" },
  { url: "https://raw.githubusercontent.com/aookapp/iptv/main/www.m3u", ua: "Mozilla/5.0" },
  { url: "https://raw.githubusercontent.com/Kimentanm/aptv/master/m3u/iptv.m3u", ua: "Mozilla/5.0" }
];

// --- 2. 你的自定义频道筛选模板 ---
const TEMPLATE = `
#央视
CCTV1
CCTV2
CCTV3
CCTV4
CCTV5
CCTV5+
CCTV6
CCTV7
CCTV8
CCTV9
CCTV10
CCTV11
CCTV12
CCTV13
CCTV14
CCTV15
CCTV16
CCTV17
CCTV4K
CCTV8K
CCTV怀旧剧场
CCTV第一剧场
CCTV高尔夫球
CCTV世界地理
CCTV央视台球
CCTV风云足球
#卫视
河南卫视
北京卫视
天津卫视
河北卫视
山西卫视
江苏卫视
浙江卫视
安徽卫视
江西卫视
山东卫视
湖南卫视
海南卫视
重庆卫视
四川卫视

#数字
CHC动作电影
CHC家庭影院
CHC影迷电影
CINEMAX热门影院
NEWTV动作电影
#电影
经典电影
止戈电影
神乐华语影院
龙华电影
功夫片
电影怪兽
电影谍战
电影贺岁
梁家辉
周星星
周星驰
李连杰
刘德华
沈腾
#戏曲
大象睛彩中原
大象戏曲
大象移动戏曲
#动画
浙江少儿
卡酷少儿
金鹰卡通
少儿动画
动漫秀场
嘉佳卡通
优漫卡通频道
新动漫
银魂
哆啦A梦
海绵宝宝
中华小当家
青春动漫BESTTV
`;

// --- 3. 解析模板并构建数据结构 ---
const templateChannels = new Map(); // 使用 Map 保持模板的插入顺序

function initTemplate() {
  let currentGroup = '未分类';
  const lines = TEMPLATE.split('\n');
  
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    
    if (line.startsWith('#')) {
      currentGroup = line.substring(1).trim(); // 获取分组名
    } else {
      // 将频道名标准化（去空格、短横线，转小写），作为匹配用的唯一键值
      let key = line.toLowerCase().replace(/[-_ 　]/g, '');
      templateChannels.set(key, { 
        name: line,         // 你模板里原本的名字
        group: currentGroup,// 所属分类
        logo: '',           // 预留台标位置
        urls: new Set()     // 使用 Set 存储该频道对应的所有去重播放链接
      });
    }
  }
}

// --- 4. 智能匹配源频道名到模板频道名 ---
function matchChannel(m3uChannelName) {
  // 标准化抓取到的名字
  let clean = m3uChannelName.toLowerCase().replace(/[-_ 　]/g, '');
  
  // 1. 完全匹配
  if (templateChannels.has(clean)) return clean;
  
  // 2. 去除常见的高清后缀后匹配 (例如 "CCTV1 HD" -> "cctv1")
  let cleanNoSuffix = clean.replace(/hd|fhd|1080p|1080i|720p|超清|高清/g, '');
  if (templateChannels.has(cleanNoSuffix)) return cleanNoSuffix;
  
  // 3. 包含匹配 (例如抓取到 "CCTV1综合"，能匹配到 "CCTV1")
  for (const key of templateChannels.keys()) {
    if (clean.startsWith(key) || cleanNoSuffix.startsWith(key)) {
      // 特殊处理：防止 CCTV1 误匹配到 CCTV11, CCTV12 等
      if (key.match(/cctv\d+$/) && clean.match(new RegExp(`^${key}\\d`))) {
        continue;
      }
      return key;
    }
  }
  return null; // 都不匹配，说明是你不需要的频道，返回 null
}

// --- 5. 核心抓取与合并逻辑 ---
async function main() {
  initTemplate(); // 初始化模板
  
  for (const task of TASKS) {
    console.log(`正在抓取: ${task.url}`);
    try {
      const res = await fetch(task.url, { headers: { "User-Agent": task.ua } });
      if (!res.ok) {
        console.error(`抓取失败: 状态码 ${res.status}`);
        continue;
      }
      
      const text = await res.text();
      const lines = text.split('\n');
      
      let currentExtInf = '';
      let matchedKey = null;
      
      for (let line of lines) {
        line = line.trim();
        if (line.startsWith('#EXTM3U')) continue;
        
        if (line.startsWith('#EXTINF')) {
          currentExtInf = line;
          // 提取当前行逗号后面的频道名称
          let m3uName = line.substring(line.lastIndexOf(',') + 1).trim();
          matchedKey = matchChannel(m3uName);
          
          // 如果匹配到了，并且还没有台标，尝试从源里提取一个台标
          if (matchedKey) {
            let logoMatch = currentExtInf.match(/tvg-logo="([^"]+)"/);
            if (logoMatch && !templateChannels.get(matchedKey).logo) {
              templateChannels.get(matchedKey).logo = logoMatch[1];
            }
          }
        } else if (line.startsWith('http') || line.startsWith('rtmp') || line.startsWith('rtsp')) {
          // 如果这个频道在模板名单里，就把链接加进去
          if (matchedKey && currentExtInf) {
            templateChannels.get(matchedKey).urls.add(line);
          }
          currentExtInf = '';
          matchedKey = null;
        }
      }
    } catch (e) {
      console.error(`请求报错: ${task.url}`, e.message);
    }
  }

  // --- 6. 生成最终的 M3U 内容 ---
  let output = "#EXTM3U\n";
  let totalChannels = 0;
  let totalLinks = 0;

  // 严格按照模板的顺序遍历输出
  for (const [key, info] of templateChannels.entries()) {
    if (info.urls.size === 0) continue; // 如果没抓到这个频道的源，跳过不输出
    
    totalChannels++;
    // 一个频道有几个源，就输出几行，播放器会自动识别为备用线路
    for (const url of info.urls) {
      let logoStr = info.logo ? ` tvg-logo="${info.logo}"` : '';
      // 覆写 M3U 标签，强制使用你设定的名字和分组
      output += `#EXTINF:-1 tvg-name="${info.name}" group-title="${info.group}"${logoStr},${info.name}\n`;
      output += `${url}\n`;
      totalLinks++;
    }
  }

  // 写入文件
  fs.writeFileSync('kankan-hn.m3u', output);
  console.log(`\n🎉 处理完成！`);
  console.log(`共匹配到 ${totalChannels} 个模板频道，生成了 ${totalLinks} 条播放链接。`);
}

main();
