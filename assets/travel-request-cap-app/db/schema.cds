namespace travel.approval;

using { cuid, managed } from '@sap/cds/common';

/**
 * 差旅申请主实体
 */
entity TravelRequests : cuid, managed {
  employeeId            : String(50);
  employeeName          : String(100) @mandatory;
  employeeEmail         : String(200) @mandatory;
  destination           : String(200) @mandatory;
  departureDate         : Date;
  returnDate            : Date;
  estimatedAmount       : Decimal(12,2);
  currency              : String(3) default 'CNY';
  purpose               : String(500);
  costCenter            : String(50);
  managerEmail          : String(200);
  departmentManagerEmail: String(200);
  financeEmail          : String(200);
  // DRAFT | PENDING | AUTO_APPROVED | L1_REVIEWING | MULTI_LEVEL_REVIEWING | APPROVED | REJECTED
  status                : String(50) default 'DRAFT';
}

/**
 * 审批记录实体
 */
entity ApprovalRecords : cuid, managed {
  travelRequest  : Association to TravelRequests;
  approverEmail  : String(200);
  approverName   : String(100);
  // AUTO | L1_MANAGER | L2_DEPT_MANAGER | L3_FINANCE
  approverLevel  : String(30);
  // APPROVED | REJECTED
  decision       : String(20);
  comments       : String(500);
  decidedAt      : Timestamp;
}
