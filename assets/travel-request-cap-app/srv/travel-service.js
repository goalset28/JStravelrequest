'use strict';

const cds = require('@sap/cds');

module.exports = class TravelService extends cds.ApplicationService {
  async init() {

    const { TravelRequests, ApprovalRecords } = this.entities;

    // ─── BEFORE CREATE: 校验和初始化 ───────────────────────────────
    this.before('CREATE', TravelRequests, async (req) => {
      const data = req.data;

      // 移除 Composition 子项，防止 INSERT 时出错
      delete data.approvalRecords;

      // 必填字段校验
      const required = ['employeeName', 'employeeEmail', 'destination',
        'departureDate', 'returnDate', 'estimatedAmount', 'purpose',
        'costCenter', 'managerEmail'];
      for (const field of required) {
        if (!data[field]) {
          req.error(400, `缺少必填字段: ${field}`);
          return;
        }
      }

      // 金额校验
      if (data.estimatedAmount <= 0) {
        req.error(400, '申请金额必须大于 0');
        return;
      }

      // 日期逻辑校验
      if (data.departureDate && data.returnDate) {
        if (new Date(data.returnDate) < new Date(data.departureDate)) {
          req.error(400, '返回日期不能早于出发日期');
          return;
        }
      }

      // 初始化状态
      data.status = 'DRAFT';
    });

    // ─── ACTION: submitRequest ─────────────────────────────────────
    this.on('submitRequest', async (req) => {
      const { requestId } = req.data;

      const request = await SELECT.one.from(TravelRequests).where({ ID: requestId });
      if (!request) {
        return req.error(404, `申请 ${requestId} 不存在`);
      }
      if (request.status !== 'DRAFT') {
        return req.error(409, `申请当前状态为 ${request.status}，无法重新提交`);
      }

      // 更新状态为 PENDING
      await UPDATE(TravelRequests).set({ status: 'PENDING' }).where({ ID: requestId });

      // 触发 n8n 工作流（异步，不阻塞响应）
      const webhookUrl = process.env.N8N_TRAVEL_WORKFLOW_URL;
      if (webhookUrl) {
        const payload = {
          requestId: request.ID,
          employeeEmail: request.employeeEmail,
          employeeName: request.employeeName,
          destination: request.destination,
          departureDate: request.departureDate,
          returnDate: request.returnDate,
          estimatedAmount: request.estimatedAmount,
          currency: request.currency || 'CNY',
          purpose: request.purpose,
          costCenter: request.costCenter,
          managerEmail: request.managerEmail,
          departmentManagerEmail: request.departmentManagerEmail,
          financeEmail: request.financeEmail,
        };

        try {
          const { default: fetch } = await import('node-fetch');
          const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            const errText = await response.text();
            cds.log('travel-service').warn(`n8n workflow returned ${response.status}: ${errText}`);
            await UPDATE(TravelRequests).set({ status: 'DRAFT' }).where({ ID: requestId });
            return {
              success: false,
              status: 'DRAFT',
              message: `工作流触发失败 (HTTP ${response.status})，请稍后重试`,
            };
          }

          // 工作流响应：更新状态
          const result = await response.json();
          if (result.status) {
            await UPDATE(TravelRequests).set({ status: result.status }).where({ ID: requestId });
          }

          return {
            success: true,
            status: result.status || 'PENDING',
            message: result.message || '申请已提交，审批流程已启动',
          };
        } catch (err) {
          cds.log('travel-service').error('Failed to trigger n8n workflow', err);
          await UPDATE(TravelRequests).set({ status: 'DRAFT' }).where({ ID: requestId });
          return {
            success: false,
            status: 'DRAFT',
            message: `工作流触发异常: ${err.message}，请稍后重试`,
          };
        }
      } else {
        // 未配置 Webhook URL（开发模式）
        cds.log('travel-service').warn('N8N_TRAVEL_WORKFLOW_URL not set, skipping workflow trigger');
        return {
          success: true,
          status: 'PENDING',
          message: '申请已提交（开发模式：工作流未触发）',
        };
      }
    });

    // ─── ACTION: updateApprovalStatus (n8n 回调) ──────────────────
    this.on('updateApprovalStatus', async (req) => {
      const {
        requestId, decision, comments,
        approverLevel, approverEmail, approverName,
      } = req.data;

      const request = await SELECT.one.from(TravelRequests).where({ ID: requestId });
      if (!request) {
        return req.error(404, `申请 ${requestId} 不存在`);
      }

      // 确定新状态
      let newStatus;
      const decisionUpper = (decision || '').toUpperCase();
      if (decisionUpper === 'REJECTED') {
        newStatus = 'REJECTED';
      } else if (decisionUpper === 'APPROVED') {
        const levelUpper = (approverLevel || '').toUpperCase();
        if (levelUpper === 'AUTO' || levelUpper === 'L3_FINANCE') {
          newStatus = 'APPROVED';
        } else if (levelUpper === 'L1_MANAGER' && request.estimatedAmount <= 10000) {
          newStatus = 'APPROVED';
        } else {
          newStatus = request.status; // 多级审批中间步骤，保持当前状态
        }
      } else {
        return req.error(400, `无效的审批决策: ${decision}`);
      }

      // 写入审批记录
      await INSERT.into(ApprovalRecords).entries({
        travelRequest_ID: requestId,
        approverEmail: approverEmail || '',
        approverName: approverName || '',
        approverLevel: (approverLevel || '').toUpperCase(),
        decision: decisionUpper,
        comments: comments || '',
        decidedAt: new Date().toISOString(),
      });

      // 更新申请状态
      await UPDATE(TravelRequests).set({ status: newStatus }).where({ ID: requestId });

      return {
        success: true,
        requestId,
        status: newStatus,
        message: `审批状态已更新为 ${newStatus}`,
      };
    });

    await super.init();
  }
};
