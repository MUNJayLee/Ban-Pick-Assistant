# 王者荣耀数据抓取脚本

## 重要声明

本脚本仅作为**通用数据抓取框架**提供，用于将任何你**有权访问**的英雄胜率数据源合并到本项目的 `heroes.json` 中。

- 在抓取任何第三方网站（如“苏苏的荣耀助手”、王者营地、NGA 等）之前，请务必阅读并遵守其 **robots.txt** 与用户协议。
- 未经授权抓取他人数据可能违反服务条款或相关法律法规，请自行评估风险。本项目不承担任何责任。
- 建议优先使用官方开放接口或已取得授权的数据源。

## 本次优化重点

相比旧版本，本次优化主要解决以下问题：

1. **无法真正“实时”抓取**：旧版本默认配置是读取本地 `example-data.json`，没有接入网络数据源。
2. **数据源单一**：旧版本只支持一个数据源，某个源挂掉就直接失败。
3. **字段映射不够灵活**：旧版本只支持一级字段名，无法应对嵌套 JSON（如 `data.hero.winRate`）。
4. **英雄名匹配率低**：`nameMap` 覆盖英雄少、别名少，导致第三方数据源中大量英雄无法匹配。
5. **缺少安全兜底**：旧版本会直接覆盖 `heroes.json`，如果接口返回异常可能把数据写坏。

针对以上问题，新版做了：

- **多数据源优先级尝试**：`config.json` 中可配置多个源，脚本会按顺序尝试，任一成功即停止。
- **嵌套字段提取**：`nameField`/`winRateField` 等支持 `data.0.winRate` 这类点分路径。
- **更全的英雄别名映射**：覆盖王者荣耀主流英雄及常见简称、外号、称号后缀。
- **自动备份 + 写入阈值**：写入前自动备份原文件；匹配率/匹配数低于阈值时中止写入，防止覆盖错误数据。
- **更智能的 HTML 解析**：支持标准 `<table>` 以及常见 div/list 结构，能通过表头自动识别列。

## 为什么直接请求 HTML 拿不到苏苏的数据？

“苏苏的荣耀助手”胜率表格通常在浏览器中通过 JavaScript/AJAX 请求后端接口后动态渲染。直接 `curl` 或 `axios.get` 请求页面返回的 HTML 只包含表格骨架，没有真实英雄名与胜率。

正确做法是：

1. 打开浏览器开发者工具（F12）→ Network（网络）。
2. 刷新页面，找到返回英雄排行 JSON 数据的接口（常见路径如 `/api/...`、`/data/...`、`.json` 等）。
3. 将该接口地址配置到本脚本的 `config.json` 中，或将返回的 JSON 保存到本地由脚本读取。

## 使用方法

### 1. 安装依赖

```bash
cd scripts/scraper
npm install
```

### 2. 配置数据源

编辑 `config.json`：

```json
{
  "sources": [
    {
      "name": "第三方 JSON 接口",
      "type": "json",
      "url": "https://example.com/api/honor-hero-ranking",
      "method": "GET",
      "headers": {
        "User-Agent": "Mozilla/5.0 ..."
      },
      "timeout": 15000,
      "retries": 3,
      "mapping": {
        "resultPath": "data.list",
        "nameField": "heroName",
        "winRateField": "winRate",
        "pickRateField": "pickRate",
        "banRateField": "banRate",
        "popularityField": "popularity"
      }
    },
    {
      "name": "本地兜底数据",
      "type": "file",
      "path": "./example-data.json",
      "mapping": {
        "resultPath": "data",
        "nameField": "name",
        "winRateField": "winRate",
        "popularityField": "pickRate"
      }
    }
  ],
  "rateLimit": {
    "enabled": true,
    "delayMs": 1000,
    "retries": 3
  },
  "threshold": {
    "minMatchRate": 0.2,
    "minHeroCount": 3
  },
  "output": "../../src/data/heroes.json"
}
```

说明：

- `sources` 是数组，按顺序尝试。第一个成功的源会被使用，后面的源会被跳过。
- 每个 `source` 里的 `mapping` 是独立的，方便不同源使用不同字段名。
- `resultPath` 支持点分路径，例如 `data.list`、`result.heroes`。
- `nameField` / `winRateField` 等也支持点分路径，例如 `hero.name`、`data.0.winRate`。

支持的 `source.type`：

- `json`：直接请求 JSON 接口并解析。
- `file`：读取本地 JSON 文件（适用于已手动保存的接口响应，或作为兜底）。
- `html`：使用 cheerio 解析静态 HTML 表格/列表（仅适用于服务端渲染的页面）。

### 3. 执行抓取

```bash
npm run fetch
```

脚本会：

1. 按 `sources` 顺序尝试数据源，每个源失败会打印原因并继续下一个；
2. 按 `rateLimit` 限速请求；
3. 将中文英雄名映射为项目内部 `id`；
4. 与原 `heroes.json` 合并，保留克制/搭配等关系数据；
5. **自动备份**原 `heroes.json`；
6. 匹配率达到阈值才写入，否则中止并提示未匹配名称。

### 4. 验证结果

```bash
cd ../..
npm run check
npm run build
```

## 字段说明

- `aiWinRate`：胜率，0-1 之间的小数。
- `popularity`：登场/热度指数，映射为 0-10。
- `pickRate`：登场率，0-1 之间的小数（可选）。
- `banRate`：禁用率，0-1 之间的小数（可选）。
- `difficulty`：若无数据源则保留原值。
- `roles` / `counters` / `counteredBy` / `synergies`：原数据保留，新脚本不覆盖。

## 找不到 JSON 接口怎么办？

如果目标站点完全使用 JS 渲染且无法找到接口，可使用 [Puppeteer](https://pptr.dev/) 或 [Playwright](https://playwright.dev/) 无头浏览器方案，但这会显著增加依赖体积与运行成本。本项目当前未内置无头浏览器依赖。
