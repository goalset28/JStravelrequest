# 差旅申请审批管理系统 — 主规格

> **指南**: 在执行以下任何任务之前，请阅读 [guidelines.md](./guidelines.md)。

逐项勾选已完成的任务。

---

## 解决方案设置

- [x] 运行 `setup-solution` 技能创建 `solution.yaml` 及所有资产的 `asset.yaml` 文件
  - 资产清单:
    - `assets/travel-request-cap-app/` — CAP 应用（类型: `cap`）
    - `assets/workflows/travel-request-approval-workflow/` — n8n 工作流（类型: `n8nworkflow`）
    - `assets/travel-request-budget-mcp-server/` — S/4HANA 预算 MCP 服务器（类型: `mcp-server`）
- [x] 验证 `solution.yaml` 和所有 `asset.yaml` 文件存在且格式正确

---

## 资产实现

- [x] 执行 `specification/travel-request-budget-mcp-server/specification.md`（所有任务）
  - 为 S/4HANA 成本中心 API 和预算账户 API 生成 MCP 翻译文件
  - 创建并注册 MCP 服务器资产

- [x] 执行 `specification/travel-request-approval-workflow/specification.md`（所有任务）
  - 构建包含金额路由、Teams 通知、预算校验的 n8n 工作流
  - 生成 webhook OpenAPI schema 并精修字段类型
  - 通过 `validate-n8n-workflow` 验证

- [x] 执行 `specification/travel-request-cap-app/specification.md`（所有任务）
  - 实现 CAP 数据模型、OData API 和业务逻辑
  - 构建前端申请界面和状态查询页

---

## 跨资产兼容性检查

- [x] 确认 CAP 应用调用 n8n Webhook 的 URL 与工作流 `provides.apis[].path` 一致
- [x] 确认 n8n 工作流回调 CAP 的接口 (`updateApprovalStatus`) 与 CAP 服务定义一致
- [x] 确认 MCP 服务器工具名称与 n8n 工作流中 SAP MCP Client 节点的 `toolFromList` 配置一致
- [x] 确认所有环境变量名称在各资产间统一（`N8N_TRAVEL_WORKFLOW_URL`, `CAP_CALLBACK_URL`）

---

## 解决方案架构概览

```
员工（前端）
  → CAP 应用（OData API）
      → n8n Webhook（差旅申请提交）
          → SAP MCP Client（查询 S/4HANA 预算）
              ↑ travel-request-budget-mcp-server
          → Switch（金额路由）
              ├── ≤ 1,000元 → 自动审批 → Teams 通知申请人
              ├── 1,001-10,000元 → Teams 通知上级 → 模拟审批
              └── > 10,000元 → Teams 通知三级 → 模拟审批 → Teams 通知财务
          → CAP 回调（updateApprovalStatus）
  ← Respond to Webhook
```
