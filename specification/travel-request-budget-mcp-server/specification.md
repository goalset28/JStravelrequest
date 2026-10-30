# travel-request-budget-mcp-server — MCP 翻译规格

> **指南**: 在执行以下任何任务之前，请阅读 [../guidelines.md](../guidelines.md)。

勾选已完成的项目。

## 数据依赖

- SAP S/4HANA 成本中心 API: `sap.s4:apiResource:API_COSTCENTER_SRV:v1`
  - 已下载规格: `api-specs/api-costcenter-srv.edmx`
- SAP S/4HANA 预算账户 API: `sap.s4:apiResource:API_BUDGETACCOUNTCORE:v1`
  - 已下载规格: `api-specs/api-budgetaccountcore.edmx`

## MCP 工具范围

```
MCP API: sap.s4:apiResource:API_COSTCENTER_SRV:v1
MCP tool scope: read-only
Resources in scope: CostCenter, CostCenterText
```

```
MCP API: sap.s4:apiResource:API_BUDGETACCOUNTCORE:v1
MCP tool scope: read-only
Resources in scope: BudgetAccount, BudgetAccountHierarchy
```

## MCP 翻译文件生成任务

- [ ] 为成本中心 API 生成 MCP 翻译文件
  - 调用 `mcp-translation-file` 技能，API 规格: `api-specs/api-costcenter-srv.edmx`
  - ORD ID: `sap.s4:apiResource:API_COSTCENTER_SRV:v1`
  - API 类型: `edmx`
  - 范围: 只读，资源: `CostCenter, CostCenterText`
  - 输出路径: `mcps/api-costcenter-srv/translation.json`

- [ ] 为预算账户 API 生成 MCP 翻译文件
  - 调用 `mcp-translation-file` 技能，API 规格: `api-specs/api-budgetaccountcore.edmx`
  - ORD ID: `sap.s4:apiResource:API_BUDGETACCOUNTCORE:v1`
  - API 类型: `edmx`
  - 范围: 只读，资源: `BudgetAccount, BudgetAccountHierarchy`
  - 输出路径: `mcps/api-budgetaccountcore/translation.json`

- [ ] 创建 MCP 服务器资产目录: `assets/travel-request-budget-mcp-server/`
- [ ] 复制翻译文件到资产目录:
  ```
  assets/travel-request-budget-mcp-server/mcp-translation/costcenter-translation.json
  assets/travel-request-budget-mcp-server/mcp-translation/budget-translation.json
  ```
- [ ] 创建 `assets/travel-request-budget-mcp-server/asset.yaml`
- [ ] 将 MCP 服务器资产添加到 `solution.yaml`
