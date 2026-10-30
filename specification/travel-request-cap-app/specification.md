# travel-request-cap-app — CAP 应用规格

> **指南**: 在执行以下任何任务之前，请阅读 [../guidelines.md](../guidelines.md)。

勾选已完成的项目。

## 概述

构建一个 Cloud Application Programming Model (CAP) 应用，提供：
1. 差旅申请的数据模型与 OData API
2. 员工提交申请的前端界面（React + SAP UI5 Web Components）
3. 与 n8n 工作流的 Webhook 集成（触发审批流程）

---

## 项目结构设置

- [ ] 通过 `setup-solution` 技能创建 CAP 应用资产目录 `assets/travel-request-cap-app/`
- [ ] 初始化 CAP 项目结构:
  ```
  assets/travel-request-cap-app/
  ├── asset.yaml
  ├── package.json
  ├── .cdsrc.json
  ├── db/
  │   └── schema.cds          # 数据模型定义
  ├── srv/
  │   ├── travel-service.cds  # 服务定义
  │   └── travel-service.js   # 服务处理逻辑
  └── app/
      └── travel-request/     # 前端应用
  ```

---

## 数据模型（db/schema.cds）

- [ ] 定义 `TravelRequest` 实体，字段包括：
  - `ID` (UUID, 主键)
  - `employeeId` (String，员工工号)
  - `employeeName` (String，员工姓名)
  - `employeeEmail` (String，员工邮箱)
  - `destination` (String，目的地)
  - `departureDate` (Date，出发日期)
  - `returnDate` (Date，返回日期)
  - `estimatedAmount` (Decimal，申请金额，单位：元)
  - `currency` (String，货币，默认 CNY)
  - `purpose` (String，出行事由)
  - `status` (String enum: `PENDING` / `AUTO_APPROVED` / `APPROVED` / `REJECTED`)
  - `createdAt` (Timestamp，提交时间，自动填充)
  - `costCenter` (String，成本中心编号)
  - `managerEmail` (String，直接上级邮箱)
  - `departmentManagerEmail` (String，部门经理邮箱)
  - `financeEmail` (String，财务负责人邮箱)

- [ ] 定义 `ApprovalRecord` 实体，字段包括：
  - `ID` (UUID, 主键)
  - `travelRequest` (Association to `TravelRequest`)
  - `approverEmail` (String，审批人邮箱)
  - `approverName` (String，审批人姓名)
  - `approverLevel` (String: `L1_MANAGER` / `L2_DEPT_MANAGER` / `L3_FINANCE`)
  - `decision` (String: `APPROVED` / `REJECTED`)
  - `comments` (String，审批备注)
  - `decidedAt` (Timestamp，审批时间)

---

## 服务定义（srv/travel-service.cds）

- [ ] 定义 `TravelService`，公开以下 CRUD 操作：
  - `TravelRequests` — 员工可创建和查询自己的申请
  - `ApprovalRecords` — 只读，供追溯查询
- [ ] 为 `TravelRequests` 实体添加以下 Actions:
  - `submitRequest(requestId: UUID)` — 提交申请，触发 n8n 工作流
  - `updateApprovalStatus(requestId: UUID, decision: String, comments: String, approverLevel: String)` — 由工作流回调更新审批状态

---

## 服务处理逻辑（srv/travel-service.js）

### 申请提交处理（BEFORE CREATE TravelRequests）

- [ ] 在保存申请前校验必填字段（destination, departureDate, returnDate, estimatedAmount, purpose, managerEmail, costCenter）
- [ ] 设置初始 `status` 为 `PENDING`
- [ ] 自动填充 `createdAt` 为当前时间

### 触发 n8n 工作流（submitRequest action handler）

- [ ] 实现 `submitRequest` 动作处理器：
  - 读取完整申请数据（含金额、人员信息、成本中心）
  - 向 n8n 工作流 Webhook 发起 POST 请求，传递申请数据
  - 请求体结构：
    ```json
    {
      "requestId": "<uuid>",
      "employeeEmail": "<email>",
      "employeeName": "<name>",
      "destination": "<city>",
      "departureDate": "<date>",
      "returnDate": "<date>",
      "estimatedAmount": <number>,
      "currency": "CNY",
      "purpose": "<text>",
      "costCenter": "<cc>",
      "managerEmail": "<email>",
      "departmentManagerEmail": "<email>",
      "financeEmail": "<email>"
    }
    ```
  - Webhook URL 从环境变量 `N8N_TRAVEL_WORKFLOW_URL` 读取
  - 更新申请状态为 `PENDING`（触发成功）或保留草稿（触发失败并返回错误）

### 审批状态回调（updateApprovalStatus action handler）

- [ ] 实现 `updateApprovalStatus` 动作处理器：
  - 创建 `ApprovalRecord` 记录（审批人、决策、备注、时间）
  - 根据 `approverLevel` 和 `decision` 更新 `TravelRequest.status`：
    - 任何级别 `REJECTED` → 状态更新为 `REJECTED`
    - `L3_FINANCE` 且 `APPROVED` → 状态更新为 `APPROVED`
    - 自动审批（≤1,000元）→ 状态直接更新为 `AUTO_APPROVED`
  - 返回更新后的申请状态

---

## 前端界面（app/travel-request/）

- [ ] 使用 React + SAP UI5 Web Components 构建以下页面：

### 1. 差旅申请提交页（主页）
- [ ] 表单字段：目的地、出发日期、返回日期、申请金额（元）、出行事由、成本中心、直接上级邮箱、部门经理邮箱（可选）、财务邮箱（可选）
- [ ] 表单验证：所有必填字段非空，金额为正数，日期逻辑合法
- [ ] 提交后显示：申请编号与"已受理"确认消息
- [ ] 若金额 ≤ 1,000元，显示"此申请将自动审批"提示

### 2. 申请状态查询页
- [ ] 通过申请编号或员工邮箱查询申请
- [ ] 展示申请详情 + 每级审批记录（审批人、时间、决策、备注）
- [ ] 状态以不同颜色显示（待审批/已通过/已拒绝）

---

## 单元测试

- [ ] 为以下场景编写测试：
  - 申请创建（字段验证）
  - 金额 ≤ 1,000元 的自动审批状态流转
  - 审批状态回调的正确更新逻辑
  - 查询 API 返回正确的审批历史记录

---

## 环境变量配置

- [ ] 在 `.env` 文件中记录所需环境变量（不提交真实值）：
  ```
  N8N_TRAVEL_WORKFLOW_URL=<n8n 工作流 webhook URL>
  ```
