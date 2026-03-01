# RAIL

> 面向 Codex + Web AI 的本地优先多代理工作流桌面应用（Tauri + React + TypeScript）

RAIL 通过节点图（DAG）连接多个代理（Codex / Web AI / 本地模型），
在桌面端完成从问题输入到分析、验证、最终综合的全流程执行。

- 本地优先运行（Tauri）
- 可复现执行日志（`run-*.json`）
- 无需 API Key，通过浏览器扩展（Web Connect）半自动接入 Web AI

---

## 目录

- [解决的问题](#解决的问题)
- [核心功能](#核心功能)
- [工作流程](#工作流程)
- [项目结构](#项目结构)
- [技术栈](#技术栈)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [安装（macOS）](#安装macos)
- [使用指南](#使用指南)
- [Web Connect 配置](#web-connect-配置)
- [数据与持久化](#数据与持久化)
- [安全模型](#安全模型)
- [法律声明](#法律声明)
- [架构约束（Guardrails）](#架构约束guardrails)
- [故障排查](#故障排查)
- [开发脚本](#开发脚本)
- [路线图](#路线图)

---

## 解决的问题

单一 AI 对话虽然快，但在复杂任务中常见问题如下：

- 证据不足 / 幻觉
- 长上下文污染
- 难以复现、难以审计
- 缺少角色分工（调研 / 实现 / 评审 / 最终综合）

RAIL 通过 **角色化代理节点 + 运行日志 + 质量门控** 来解决这些问题。

---

## 核心功能

### 1) Workflow Canvas（节点图）
- `Turn / Transform / Gate` 节点类型
- 连线、拖拽、选择、自动对齐
- 运行 / 停止 / 撤销 / 重做
- 连线与执行状态可视化

### 2) 多代理执行
- 基于 Codex 的代理执行
- Web 代理半自动接入（`web/gpt`, `web/gemini`, `web/claude`, `web/perplexity`, `web/grok`）
- 支持 Ollama 本地模型
- DAG 中上游输出自动传递到下游输入

### 3) Feed（结果/文档视图）
- 卡片化展示执行结果
- 查看摘要、原文、输入快照、输入来源
- 发送追加请求（后续提示）
- 分享（复制文本/JSON）、删除
- 按模板运行或自定义运行分组折叠/展开

### 4) Run Records（可复现执行日志）
- 存储于 `src-tauri/runs/run-*.json`
- 保存状态流转、provider trace、质量摘要
- 支持历史复盘与调试

### 5) Settings / Engine
- 引擎启动/停止
- Codex 登录/登出
- 使用量查询
- CWD 管理

### 6) Web Connect（浏览器扩展桥接）
- 仅本地回环（`127.0.0.1`）+ Token 认证
- 自动注入提示词并尝试自动发送
- 自动发送失败时可回退为用户一次手动发送
- 应答自动回收并传给下一个节点

---

## 工作流程

1. 用户在 Workflow 输入问题
2. 运行起始节点（或整张 DAG）
3. 各节点处理输入
   - Turn: 调用 LLM
   - Transform: 数据转换
   - Gate: 条件分支
4. 节点输出传递到后续节点
5. 最终结果写入 Feed 与 run 记录
6. 可在 Feed 继续追加请求并重跑目标节点

---

## 项目结构

```txt
rail/
├─ src/
│  ├─ app/                # 应用根组装
│  ├─ pages/              # 路由级页面
│  ├─ components/         # 可复用 UI
│  ├─ features/           # 功能逻辑
│  ├─ shared/
│  │  ├─ tauri/           # IPC 封装(invoke/listen)
│  │  └─ lib/             # 公共工具
│  └─ i18n/
├─ src-tauri/             # Rust 后端 + run 持久化
├─ extension/rail-bridge/ # Chrome MV3 扩展（Web Connect）
├─ scripts/
├─ docs/
└─ public/
```

---

## 技术栈

- Desktop: **Tauri v2**
- Frontend: **React 19 + TypeScript + Vite**
- Bridge: **Playwright Core + Chrome Extension (MV3)**
- 数据格式: JSON（graph / runs）

---

## 环境要求

- Node.js 18+
- npm 9+
- Rust stable toolchain（用于 Tauri 构建）
- Tauri 支持的 macOS / Linux / Windows

---

## 快速开始

```bash
npm install
npm run dev
```

桌面模式运行：

```bash
npm run tauri dev
```

生产构建：

```bash
npm run build
```

架构 + 构建检查：

```bash
npm run check
```

---

## 安装（macOS）

RAIL 以桌面应用形式分发（不是托管 Web 服务）。

### 1) 开发模式运行

```bash
npm install
npm run tauri dev
```

### 2) 构建发布包

```bash
npm run tauri build -- --bundles app
```

产物路径：

- `src-tauri/target/release/bundle/macos/rail.app`

### 3) 本地安装/运行

1. 在 Finder 中将 `rail.app` 复制到 `Applications`
2. 首次运行若被拦截，右键应用并选择“打开”

终端直接运行：

```bash
open src-tauri/target/release/bundle/macos/rail.app
```

若被 quarantine 拦截：

```bash
xattr -dr com.apple.quarantine src-tauri/target/release/bundle/macos/rail.app
open src-tauri/target/release/bundle/macos/rail.app
```

---

## 使用指南

### A) 基础执行

1. 在 `Workflow` 选择模板或手动搭图
2. 输入问题
3. 点击运行
4. 在 `Feed` 查看结果卡片

### B) 在 Feed 发起追加请求

1. 展开目标卡片
2. 输入追加请求
3. 点击发送
4. 结果会追加到同一 run 上下文

### C) 图保存/加载

- 保存：将当前图保存为文件
- 重命名：修改已保存图名称
- 删除：删除图文件
- 刷新：重新同步列表

### D) 法务文档

- 字体/第三方：`THIRD_PARTY_NOTICES.md`, `public/FONT_LICENSES.txt`
- 投资免责声明：`DISCLAIMER.md`
- 服务条款/责任限制：`TERMS.md`

---

## Web Connect 配置

### 1) 安装扩展

1. 打开 Chrome `chrome://extensions`
2. 开启开发者模式
3. 点击“加载已解压的扩展程序”
4. 选择 `extension/rail-bridge`

### 1-1) 删除/迁移仓库时注意

- `rail.app` 可以独立运行，但 Web Connect 仍依赖扩展。
- 如果扩展是“解压加载”，源目录被删除或移动后扩展会失效。
- 请先把 `extension/rail-bridge` 复制到固定路径，再从新路径重新加载。

### 2) 在应用中生成连接码

1. 打开应用 `Web Connect` 标签页
2. 点击“复制连接代码”
3. 在扩展弹窗中填入 URL/Token 并保存

### 3) 节点设置

- 执行器选择 Web 类型（如 `web/gpt`）
- Web 结果模式选择 `Bridge Assisted（推荐）`

### 4) 运行行为

- 应用尝试自动注入与自动发送
- 失败时仅需在浏览器手动发送一次
- 响应完成后自动回传下一个节点

---

## 数据与持久化

- 图文件：`graphs/*.json`
- 执行记录：`src-tauri/runs/run-*.json`
- UI 语言：localStorage (`rail_ui_locale`)

---

## 安全模型

### 基本原则
- 本地优先执行
- 最小化敏感信息持久化
- 桥接通信最小权限

### Web Connect 保护
- 仅允许 `127.0.0.1`
- Bearer Token 认证
- 支持扩展 ID allowlist
- 支持 Token 轮换

### 开发期扫描

```bash
bash scripts/secret_scan.sh --all
```

---

## 法律声明

发布/运行前请务必阅读：

- `TERMS.md`：服务条款/责任限制
- `DISCLAIMER.md`：投资/金融免责声明
- `THIRD_PARTY_NOTICES.md`：第三方告知
- `public/FONT_LICENSES.txt`：字体许可

重要：
- 股票/金融相关输出仅供信息参考，不构成投资建议。
- 最终投资决策与盈亏责任由用户自行承担。

---

## 架构约束（Guardrails）

仓库内已包含用于防止架构退化的检查脚本。

```bash
npm run check:arch
```

检查项：
- `src/main.tsx` 入口文件规则
- 文件行数上限（含例外清单）
- 分层依赖方向
- cross-slice import 限制

---

## 故障排查

### 1) Web 节点无有效响应就结束
- 检查 Web Connect 状态
- 确认对应服务标签页已打开
- 重新执行扩展连接测试
- 自动发送失败时手动发送一次

### 2) 使用量查询失败
- 检查登录/会话状态
- 当前引擎构建可能不支持 usage API

### 3) 图/Feed 与预期不一致
- 查看最新 run JSON
- 确认是否按同一 `runId` 分组
- 检查上游到下游连线是否正确

### 4) 开发环境性能问题
- 检查是否重复启动 dev server/worker
- 清理无效浏览器自动化会话

---

## 开发脚本

- `npm run dev`：Vite 开发服务器
- `npm run tauri dev`：Tauri 开发运行
- `npm run tauri:dev:isolated`：以分离 Codex Home（强制）运行 Tauri 开发模式
- `npm run tauri:dev:global`：以全局 `~/.codex` Home 运行 Tauri 开发模式（按需）
- `npm run build`：类型检查 + 打包
- `npm run check:arch`：架构约束检查
- `npm run check`：架构 + 构建综合检查

说明：
- 默认运行模式已改为分离 Codex Home（`isolated`），避免与 VSCode Codex 历史混用。

---

## 路线图

- 继续拆分 MainApp 大文件（强化 FSD）
- 增强页面/功能级测试
- 强化 Feed 文档渲染（表格/图表/媒体）
- 增强执行与成本可观测性

---

## License

遵循项目策略。请参照仓库内许可证与告知文档。
