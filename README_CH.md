语言：[English](./README.md) | [中文](./README_CH.md)

# cp0x 出品的 Euler 无许可界面

一个面向 Euler 协议的无许可界面，基于 Berry MUI 模板构建（React 19 + Vite + MUI 7），并集成钱包连接（wagmi + RainbowKit）。

`/explore`、`/earn`、`/lend`、`/borrow` 和 `/portfolio` 页面对应 app.euler.finance 上的同名页面，数据来自 Euler 的公共 API。Explore 展示带有存入 / 借款 / 流动性 / ROE 指标的市场卡片；Earn 展示由策展方管理的资金配置金库，每个金库详情页包含表现、敞口、管理信息，以及由钱包真实驱动的 ERC-4626 存入 / 提取流程。Lend 列出可浏览的 EVK 债务金库，含基础 APY、内生收益与奖励 APY 的合计值，以及风险管理方和抵押品敞口。Borrow 以（抵押品，负债）组合的形式列出市场，其组合详情页通过 EVC 批量调用真实开仓。Portfolio 展示已连接账户的存款与仓位，并提供真实的偿还 / 借入 / 增加或减少抵押品操作。

## 技术栈

- React 19 + TypeScript + Vite
- MUI 7（Berry 模板：主题、布局、UI 组件）
- wagmi + viem + RainbowKit（钱包连接、切换网络）
- @tanstack/react-query（Euler API 数据）、Redux Toolkit（消息提示）、notistack

## 多语言

界面提供英文与简体中文两种语言。语言下拉框位于页面右上角、连接钱包按钮之前。默认语言为英文，所选语言会保存在浏览器的 localStorage 中，刷新后仍然生效。

- 文案目录：`src/utils/locales/en.json` 与 `src/utils/locales/zh.json`
- 国际化方案：`react-intl`（`src/ui-component/Locales.tsx` 中的 `IntlProvider`）
- 组件中的调用方式：`src/hooks/useTranslate.ts`

新增界面文案时，请在两个语言文件中同时添加同一个 key。

## 运行时配置

`public/config.json` **不纳入 git 版本管理**（其中包含私有 RPC 密钥）。克隆仓库后创建一次即可：

```bash
cp public/config.example.json public/config.json
```

示例文件使用无需密钥的公共 RPC，存在速率限制，适合本地开发 —— 如需承载更高负载，请替换为你自己的服务商节点。所有重要设置都位于
`public/config.json`，并在应用渲染之前于运行时加载（修改后无需重新构建）：

- `eulerApi.v3BaseUrl` —— 官方公共 Euler v3 API（`https://v3.euler.finance`）：开放 CORS、无需密钥，由浏览器直接调用。金库数据、APY、资金配置与价格均来自这里。
- `eulerApi.labelsBaseUrl` —— 公共 `euler-labels` 元数据 CDN，提供产品、实体与策展 Earn 金库列表。
- `eulerApi.labelsImagesBaseUrl` —— `euler-labels` 的原始公共资源，用于策展方 logo。
- `eulerApi.baseUrl` —— 其余内部链 / 代币元数据接口的基础地址；开发环境下为 `/euler-api`，即一个基于 curl 的缓存 Vite 代理（见 `vite.config.mts`）。
- `chains[]` —— 链列表，每条链带有 `rpcUrl`（Ankr 节点）；同时供 wagmi transports 与直接 JSON-RPC 调用使用（`src/api/euler.ts` 中的 `rpcCall`）。
- `walletConnectProjectId`、`defaultChainId`、`eulerApi.tokenImagesBaseUrl`。

## Euler API 层

`src/api/euler.ts` 复刻了 Euler 应用所使用的数据源：

公共 v3 API（`v3BaseUrl`，由浏览器直接调用）：

- `POST /v3/evk/vaults/batch` —— 金库详情，包含抵押品配置（Explore 的主要数据）
- `POST /v3/earn/vaults/batch` —— Earn 金库概要与配置策略
- `GET /v3/earn/vaults/{chainId}/{address}` —— Earn 详情、策略与治理信息
- `GET /v3/earn/vaults/{chainId}/{address}/totals` —— 历史 TVL / 份额价格 / APY 序列
- `GET /v3/evk/vaults?chainId=` —— 扁平金库列表（分页，limit ≤ 100）
- `GET /v3/prices`、`GET /v3/apys/{intrinsic,rewards}`

公共 labels CDN（`labelsBaseUrl`，由浏览器直接调用）：

- `GET /{chainId}/{products,entities,earn-vaults}.json` —— 市场分组、策展方与策展 Earn 金库

经开发代理访问的内部 API（`baseUrl`，用于 labels 仓库中未发布的元数据）：

- `GET /internal/euler-chains`、`GET /internal/token-list?chainId=`

说明：内部 API 会按 IP 对突发请求限流（返回临时的 403）—— 代理会缓存响应，应用也会保持较低的请求量（查询次数少、react-query 缓存 60 秒、仅重试一次）。v3 API 会拦截明显的机器人 User-Agent（例如 python-urllib），而浏览器与 curl 可以正常访问。

## 页面

- `/explore?network=1` —— Euler 市场浏览器（实时数据）
- `/earn?network=1` —— 策展 Earn 金库（实时数据）
- `/earn/vault/:vaultAddress?network=1` —— 实时金库详情，以及真实的 ERC-20 授权 / ERC-4626 存入与提取交易
- `/lend?network=1` —— 隔离式 EVK 借出金库，含实时 APY、流动性、使用率、风险管理方与敞口数据
- `/lend/:lendAddress?network=1` —— 借出市场详情，含实时统计、抵押品市场、存入预览、授权与 ERC-4626 存入流程
- `/borrow?network=1` —— 以（抵押品，负债）组合形式呈现的借款市场，含实时 LTV / APY 数据
- `/borrow/:collateral/:liability?network=1` —— 组合详情，含市场信息与真实借款流程（EVC 批量调用）
- `/portfolio` —— 已连接账户的存款与仓位（实时数据），仓位管理页位于 `/portfolio/position/:collateral/:liability`（真实的偿还 / 借入 / 抵押品操作）

## 快速开始

```bash
pnpm install
pnpm start        # 开发服务器（含 /euler-api 代理）
pnpm build        # tsc + vite build
pnpm lint         # eslint
```

## 相关链接

- 网站：[pi.cp0x.com](https://pi.cp0x.com/)
- Twitter：[@cp0xdotcom](https://x.com/cp0xdotcom)
- Telegram：[@cp0xdotcom](https://t.me/cp0xdotcom)

## 参与贡献

关于本地部署、开发与代码贡献的步骤，请参阅 [CONTRIBUTING](./CONTRIBUTING.md)。
