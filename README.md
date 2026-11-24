# Hackmon

本题为 AHUCTF 2026 的 AI 方向赛题 Hackmon。

[官方 Writeup](https://c01in.com/posts/ahuctf2026)

开源复办版保留最终 100 题、官方 Bot、初筛、对战判定、页面与演出，使用全新数据库。

## 比赛规则

- 选手须自行填写攻击与防御提示词。
- 默认抽取 10 题，中英文各 5 题，答对至少 9 题；限时 120 秒，冷却 60 秒。
- 可以解释，只按最后一个非空行判分：
  - `number`：只写数字，不带单位或其他文字。
  - `exact`：原样匹配题面答案。
  - `word`：答案及题面别名不区分大小写。
- 只改攻击提示词可沿用初筛；改防御提示词须重测。
- 联盟每条线 15 回合，须守住两线并至少攻陷一席。
- 冠军每条线 30 回合，须攻破冠军且守住自己的防线。
- 每日对局不限。

题数、门槛、时限、冷却、回合数和 Boss 台词在 `competition.json` 配置。抽题数须为 2–100 的偶数。

## Docker Compose 复办

1. 在 CTFd 开放 API Token，准备阿里云百炼 Key，默认模型为 `qwen3.5-flash`。
2. 复制并填写配置：

   ```bash
   cp .env.example .env
   ```

   替换 `T1_CTFD_ORIGIN`、`T1_PUBLIC_ORIGIN`、`T1_MODEL_API_KEY`、`T1_ADMIN_TOKEN` 和 `T1_TEST_REWARD`。

3. 启动：

   ```bash
   docker compose up --build -d
   curl http://127.0.0.1:3000/healthz
   ```

Compose 使用 `live + ctfd`，SQLite 持久化到 `progress` 卷。端口只绑定本机，公开比赛时请配置 HTTPS 反向代理。身份验证模块为 `src/platform/ctfd.js`。

## 本地预览与开发

要求 Node.js 24 或更高版本，无第三方 npm 依赖：

```bash
npm run dev
```

打开 `http://127.0.0.1:4173/`。默认使用内置模拟模型，不访问真实 CTFd 或模型服务。

```bash
npm test
```

开发数据写入 `data/state.json`，删除 `data/` 即可重置。

### 开发组件

demo 页面右下角提供“⚙ 开发”面板：

- 调整回合与冠军入场播放速度、开关场景动态。
- 页面调试可进入我的队伍、防御初筛、联盟对战、冠军入场，以及联盟或冠军的结算与战报。跳转会结束当前模拟对局，前置初筛和冠军资格由 demo 流程补齐。
- 选择初筛、联盟和冠军模拟情景，调整下一局的回合数与模拟事件间隔。
- 清除初筛记录与冷却，重置冠军初见状态。
- 预览冠军演出、三句织字，以及完整进场与模拟战斗；预览不调用模型或创建对局。
- 新建测试身份后返回上一测试身份，原测试存档保留。

也可直接打开 `/?preview=opening` 或 `/?preview=full-opening`。这些组件只用于 demo；live 启动和发布打包会删除开发前端，开发接口返回 404。

### 赛事档案

设置管理令牌后启动，例如：

```bash
T1_ADMIN_TOKEN=local_archive_token_change_me npm run dev
```

打开 `http://127.0.0.1:4173/admin.html`，使用同一令牌连接。档案页支持：

- 查看赛事状态、模型调用与预算、选手列表并按平台 ID 或昵称搜索。
- 查看选手当前提示词、初筛反馈、通关状态和逐局攻防战报。
- 停用或恢复队伍。
- 在 `entry-code` 模式签发或重置参赛码；CTFd 模式不显示此功能。

live 模式必须设置 20–200 位的非示例 `T1_ADMIN_TOKEN`。使用子路径部署时，档案页位于同一 base path 下的 `admin.html`。

## 配置与素材

| 内容 | 位置 |
| --- | --- |
| 初筛、回合数、Boss 台词 | `competition.json` |
| CTFd、模型、静态 flag、公开入口 | `.env`，参考 `.env.example` |
| 头像、地图、场景、图标 | `public/assets/` |
| 背景音乐与音效 | `public/audio/`，同名 WAV 文件 |
| 题库 | `src/screening/questions.json` |

当前保留原版图片和音频。替换时沿用原文件名，或同步修改代码中的引用；音频同时提供 OGG 和 WAV。

## 不公开的数据

真实 Key、Token、正式 flag、选手身份与提示词、作战记录、数据库、备份和校园运维材料均不纳入仓库。复办不要复制旧 `data/`、SQLite 或 `.env`；发布前同时检查源码默认值和 Git 历史。
