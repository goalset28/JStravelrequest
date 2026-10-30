using travel.approval as db from '../db/schema';

/**
 * 差旅申请管理服务
 * 提供差旅申请的提交、查询和审批状态管理
 */
service TravelService @(path: '/api/travel') {

  // 差旅申请 CRUD（员工可创建和查询）
  entity TravelRequests as projection on db.TravelRequests
    excluding { createdBy, modifiedBy };

  // 审批记录（只读，供追溯）
  entity ApprovalRecords as projection on db.ApprovalRecords
    excluding { createdBy, modifiedBy };

  // 提交申请动作（触发 n8n 工作流）
  action submitRequest(requestId : UUID) returns {
    success  : Boolean;
    status   : String;
    message  : String;
  };

  // 审批状态回调（由 n8n 工作流调用）
  action updateApprovalStatus(
    requestId    : UUID,
    decision     : String,
    comments     : String,
    approverLevel: String,
    approverEmail: String,
    approverName : String
  ) returns {
    success  : Boolean;
    requestId: UUID;
    status   : String;
    message  : String;
  };
}
