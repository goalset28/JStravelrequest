# travel-request-approval-workflow — n8n 工作流规格

> **指南**: 在执行以下任何任务之前，请阅读 [../guidelines.md](../guidelines.md) 和 [../guidelines-n8n-workflow.md](../guidelines-n8n-workflow.md)。

勾选已完成的项目。

## 概述

构建差旅申请审批自动化工作流，功能包括：
1. 接收来自 CAP 应用的差旅申请 Webhook
2. 从 SAP S/4HANA 查询部门预算余额（通过 MCP 服务器）
3. 根据申请金额自动路由审批（≤1,000元自动批准；1,001-10,000元一级审批通知；>10,000元三级审批通知）
4. 通过 Microsoft Teams 向相关人员发送通知
5. 将审批结果回调 CAP 应用

**注意（测试阶段）**: 当前版本不使用 SAP Task Center，所有申请通过金额规则自动审批，并通过 Teams 发送通知。Task Center 集成留待生产环境启用。

---

## 前置条件

- [ ] 读取 `../guidelines-n8n-workflow.md` 中的完整 n8n 工作流约束
- [ ] 通过 `n8n-mcp__list-supported-nodes` 确认可用节点
- [ ] 通过 `n8n-mcp__search-nodes-catalog` 查找所有计划使用节点的 `type` 和 `typeVersion`：
  - `webhook`
  - `switch`
  - `if`
  - `set`
  - `respondToWebhook`
  - `microsoftTeams`
  - `stickyNote`
  - `code`
  - `sapMcpClient`（SAP MCP Client）

---

## 节点路由规划

### 工作流主流程

```
Webhook（差旅申请提交）
  → 查询预算余额（SAP MCP Client）→ [预算不足 → 返回错误]
  → Switch（按申请金额路由）
      ├── ≤ 1,000元  → 设置自动审批状态 → Teams 通知申请人（已自动审批）→ 回调 CAP
      ├── 1,001-10,000元 → 设置一级审批中 → Teams 通知直接上级 → 自动审批（测试模式）→ 回调 CAP
      └── > 10,000元 → 设置多级审批中 → Teams 通知直接上级 → Teams 通知部门经理 → Teams 通知财务 → 自动审批（测试模式）→ 回调 CAP
  → Respond to Webhook（返回处理结果）
```

---

## 工作流实现任务

### 1. 项目目录设置

- [ ] 通过 `setup-solution` 技能创建工作流资产目录:
  - `assets/workflows/travel-request-approval-workflow/`
- [ ] 将工作流资产引用添加到 `solution.yaml`

### 2. 审批路由配置数据

- [ ] 在 Code 节点中定义审批阈值常量（ALL_CAPS），包含：
  ```javascript
  const APPROVAL_THRESHOLDS = {
    AUTO_APPROVE_LIMIT: 1000,     // ≤ 此金额自动审批
    SINGLE_APPROVER_LIMIT: 10000  // ≤ 此金额单级审批，> 此金额三级审批
  };

  const MOCK_APPROVERS = {
    LEVEL_1_MANAGER: "manager@test.example.com",        // 直接上级（测试占位符）
    LEVEL_2_DEPT_MANAGER: "deptmgr@test.example.com",  // 部门经理（测试占位符）
    LEVEL_3_FINANCE: "finance@test.example.com"         // 财务负责人（测试占位符）
  };
  ```
- [ ] 在 Code 节点上方添加 StickyNote，提示此为测试占位符配置

### 3. Webhook 触发节点

- [ ] 创建 Webhook 触发节点，节点名称: `"差旅申请提交"` (业务描述性名称)
  - `responseMode`: `"responseNode"`（等待工作流完成后返回结果）
  - 接受 POST 请求，传入申请数据（含 requestId、金额、人员信息、成本中心）

### 4. 请求体验证

- [ ] 创建请求体校验 Code 节点（`onError: "continueErrorOutput"`），验证必填字段：
  - `requestId`, `estimatedAmount`, `employeeEmail`, `employeeName`, `destination`, `costCenter`
  - 校验失败 → 错误输出连接到 400 Respond 节点
  - 校验通过 → 继续流程

### 5. 预算余额查询（SAP MCP Client）

- [ ] 创建 SAP MCP Client 节点，节点名称: `"查询差旅预算余额"`
  - 调用 S/4HANA 成本中心 API 的 `read_cost_center` 工具
  - 输入参数: `{ "CostCenter": "{{ $json.body.costCenter }}", "ControllingArea": "1000" }`
  - `onError`: `"continueErrorOutput"`
  - 错误路径: 连接到降级处理节点（预算查询失败时，允许继续并警告）
  - `mcpServers`: 注入 `travel-request-budget-mcp-server` 的工具定义
  
- [ ] 创建预算余额校验 IF 节点: `"预算是否充足"`
  - 条件: `$json.result.remainingBudget >= $('差旅申请提交').item.json.body.estimatedAmount`
  - True 分支 → 继续流程
  - False 分支 → 返回预算不足错误给申请人

### 6. 金额路由（Switch 节点）

- [ ] 创建 Switch 节点，节点名称: `"根据金额路由审批"`
  - 输入数据来源: `$('差旅申请提交').item.json.body.estimatedAmount`
  - 规则（rules 模式）：
    - 输出 `auto_approve`: 金额 `<= 1000`（number 类型，`lte` 操作符）
    - 输出 `single_approval`: 金额 `<= 10000`（number 类型，`lte` 操作符）
    - 输出 `multi_approval`: 其余情况（fallback 输出）
  - `typeValidation: "strict"`

### 7. 自动审批分支（≤ 1,000元）

- [ ] Set 节点 `"设置自动审批状态"`:
  - `status`: `"AUTO_APPROVED"`
  - `message`: `"金额 ≤ 1,000元，已自动审批通过"`
  - `approvalLevel`: `"AUTO"`

- [ ] Microsoft Teams 节点 `"通知申请人-自动审批"`:
  - 发送 Teams 消息给申请人（`$('差旅申请提交').item.json.body.employeeEmail`）
  - 消息内容包含: 申请编号、目的地、金额、"已自动审批通过"状态
  - `onError`: `"continueErrorOutput"`
  - 错误路径 → 回调 CAP 并提示重试通知

- [ ] 调用 CAP 回调接口更新状态（Set 节点构造回调 payload）

### 8. 单级审批分支（1,001-10,000元，测试模式）

- [ ] Set 节点 `"设置一级审批状态"`:
  - `status`: `"L1_REVIEWING"`
  - `approvalRoute`: `"SINGLE_APPROVER"`

- [ ] Microsoft Teams 节点 `"通知直接上级-待审批"`:
  - 接收人: Mock 邮箱 `MOCK_APPROVERS.LEVEL_1_MANAGER`（从 Code 节点读取）
  - 消息内容包含: 申请人姓名、目的地、金额、事由、申请编号
  - `onError`: `"continueErrorOutput"`
  - 错误路径 → Respond 节点返回错误给申请人

- [ ] Set 节点 `"模拟一级审批通过"` (测试模式):
  - `status`: `"APPROVED"`
  - `decision`: `"approved"`
  - `approverLevel`: `"L1_MANAGER"`
  - 添加 StickyNote: "⚠️ 测试模式：此节点模拟审批人决策，生产环境应替换为 SAP Task Center 节点"

- [ ] 通知申请人审批结果（Teams 节点）

### 9. 多级审批分支（> 10,000元，测试模式）

- [ ] Set 节点 `"设置多级审批状态"`:
  - `status`: `"MULTI_LEVEL_REVIEWING"`
  - `approvalRoute`: `"THREE_LEVEL"`

- [ ] Microsoft Teams 节点 `"通知直接上级-多级待审"`:
  - 通知直接上级（mock 邮箱）
  - `onError`: `"continueErrorOutput"` → Respond 错误

- [ ] Microsoft Teams 节点 `"通知部门经理-多级待审"`:
  - 通知部门经理（mock 邮箱）
  - `onError`: `"continueErrorOutput"` → Respond 错误

- [ ] Microsoft Teams 节点 `"通知财务-多级待审"`:
  - 通知财务负责人（mock 邮箱）
  - `onError`: `"continueErrorOutput"` → Respond 错误

- [ ] Set 节点 `"模拟多级审批通过"` (测试模式):
  - 添加 StickyNote: "⚠️ 测试模式：生产环境需替换为分级 SAP Task Center 审批链"

- [ ] 通知申请人最终审批结果（Teams 节点）
- [ ] 通知财务团队启动报销流程（Teams 节点 `"通知财务-报销触发"`）

### 10. 审批结果回调 CAP（共用）

- [ ] Set 节点 `"构造回调 Payload"`:
  - 组装最终 `{ requestId, status, decision, approverLevel, message }` 结构

- [ ] 注意: CAP 回调通过 HTTP 调用（CAP 服务在同一 BTP 实例），配置为环境变量 `CAP_CALLBACK_URL`

### 11. Respond to Webhook 节点

- [ ] Respond 节点 `"返回处理结果"`:
  - 响应 200，包含 `{ requestId, status, message }`
  - 每条分支的最终节点都连接到此节点（不重复使用 — 通过 Merge 汇聚后连接）

### 12. 错误响应节点

- [ ] Respond 节点 `"返回错误给申请人"`:
  - 响应 400/500，包含错误详情
  - 所有错误路径（预算不足、字段验证失败、Teams 通知失败）均连接到此节点

---

## 工作流文件生成

- [ ] 将完整工作流写入: `assets/workflows/travel-request-approval-workflow/travel-request-approval-workflow.n8n.json`
- [ ] 运行脚本生成 `workflow` 块和 `provides.apis[]`:
  ```bash
  node .agent/skills/n8n-workflow/scripts/generate-workflow-asset.js \
    assets/workflows/travel-request-approval-workflow/travel-request-approval-workflow.n8n.json \
    travel-request-approval-workflow \
    <solution-name>
  ```
- [ ] 精修 `workflow-schema.openapi.json`:
  - 请求体字段类型: `requestId`(string), `estimatedAmount`(number), `employeeEmail`(string), `employeeName`(string), `destination`(string), `departureDate`(string/date), `returnDate`(string/date), `purpose`(string), `costCenter`(string), `managerEmail`(string), `departmentManagerEmail`(string), `financeEmail`(string)
  - 所有金额字段使用 `number` 类型（确保 Switch 条件使用 `operator.type: "number"`）
  - `required[]`: `["requestId","estimatedAmount","employeeEmail","employeeName","destination","costCenter","managerEmail"]`

---

## SAP MCP 服务器注入配置

在所有 `CUSTOM.sapMcpClient` 节点的 `mcpServers` 参数中注入预算 MCP 服务器定义：

```
MCP API: sap.s4:apiResource:API_COSTCENTER_SRV:v1
MCP tool scope: read-only
Resources in scope: CostCenter, CostCenterText
```

---

## 验证与测试

- [ ] 使用 `n8n-mcp__validate-n8n-workflow` 验证工作流 JSON 和 asset.yaml
- [ ] 修复所有验证错误（凭证错误预期存在，可忽略）
- [ ] 确认所有分支均连接到 Respond to Webhook 节点（满足 caller contract Rule 9）
- [ ] 确认 Switch 节点金额条件使用 `operator.type: "number"`（Rule 11/12）
- [ ] 确认 `pinData` 已通过 `pin-data-schemas` 工具生成

---

## 里程碑日志映射

| 里程碑 | 对应节点 | 日志位置 |
|--------|---------|---------|
| M2: 预算校验通过 | 预算是否充足 IF 节点 | 通过分支 |
| M3: 审批路由完成 | Switch 路由节点 | 各输出分支 |
| M4: 审批通知已发送 | Teams 通知节点成功 | 通知发送后 |
| M5: 审批决策已记录 | 模拟审批/CAP 回调 | 状态更新后 |
| M6: 报销流程触发 | 财务报销通知节点 | >10,000元分支 |
