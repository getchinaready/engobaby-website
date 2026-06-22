# 英歌宝 Engo Baby 官网

普宁 3–6 岁幼儿英语启蒙与全英文 STEAM 创新工坊官网。纯静态站点，中英双语，无构建依赖，可直接部署到 Vercel。

## 文件结构

```
website/                 ← 本文件夹 = Git 仓库根 / 部署根
├── index.html           主站（首页 / 关于 / 课程 / 价格 / 师资 / 课程表概览 / 报名）
├── kebiao.html          详细暑期课程表（海豚组 / 企鹅组日历 + 每日时段）
├── engo-pro.html        英歌派（成人）占位页
├── logo.png / logo_cn.png / mascot.png … 图片（Logo、吉祥物、师资头像，均放在根目录）
├── vercel.json          Vercel 配置（cleanUrls）
└── .gitignore
```
> 图片都放在根目录（HTML 用 `src="logo.png"` 这样的相对路径引用）。如果文件夹里还残留一个旧的 `assets/` 子文件夹（里面是重复的图片），可以直接删掉。

> 注意：本仓库**只含对外公开内容**。内部定价底价、招生话术、商业计划等敏感资料不在此仓库内（保留在上级项目文件夹，勿上传公开仓库）。

## 部署（仓库和 Vercel 都已建好，只差从本地推一次）

> 现状：GitHub 仓库 **`getchinaready/engobaby-website`** 已创建，Vercel 项目 **`engobaby-website`** 已创建并连接到该仓库。
> 你只需把本地文件 push 上去，Vercel 就会**自动开始部署**——不用再在网页上点任何"Deploy"。

### 在"终端"里执行（逐行粘贴）
```bash
cd "/Users/xinzheyu/Desktop/英歌宝创业/英歌宝 Master Folder/EngoBaby 网站项目/website"
rm -rf .git assets          # 清掉残留的不完整 git，以及重复的 assets 文件夹
git init -b main
git add -A
git commit -m "Engo Baby website"
git remote add origin https://github.com/getchinaready/engobaby-website.git
git push -u origin main
```
（小技巧：输入 `cd ` 后把 website 文件夹从访达拖进终端，会自动补全带空格的路径。）

- 第一次 push 时，若弹出 GitHub 登录/授权，按提示用浏览器登录一下即可（你已登录 GitHub，通常一两下就过）。
- **更简单的替代**：如果你装了 **GitHub Desktop**，先在终端只跑前两行（`cd …` 和 `rm -rf .git assets`），然后在 GitHub Desktop 里「Add Local Repository」选这个 website 文件夹 → Publish/Push 到 `getchinaready/engobaby-website` 即可。

push 成功后，去 Vercel 项目 `engobaby-website` 看 **Deployments**，几十秒就会出现一个自动部署，完成后给你一个 `*.vercel.app` 地址。

### 绑定域名 engobaby.com
- 项目 → Settings → **Domains** → 添加 `engobaby.com` 和 `www.engobaby.com`
- Vercel 会显示需要在你**域名注册商**处添加的 DNS 记录，通常是：
  - 根域 `engobaby.com`：**A 记录** → `76.76.21.21`
  - `www`：**CNAME** → `cname.vercel-dns.com`
  - （以 Vercel 页面实际显示为准，可能不同）
- DNS 生效后 Vercel 自动签发 HTTPS 证书

### 以后更新
改完本地文件后：
```bash
git add -A && git commit -m "update" && git push
```
Vercel 会自动重新部署。

## 本地预览
直接双击 `index.html` 用浏览器打开即可（图片走相对路径，本地正常加载）。
