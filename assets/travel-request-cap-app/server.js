'use strict';

const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const { createServer } = require('http');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'app/travel-request')));

// ── 数据库初始化 ─────────────────────────────────────
const db = new Database(':memory:');

db.exec(`
  CREATE TABLE IF NOT EXISTS TravelRequests (
    ID TEXT PRIMARY KEY,
    employeeId TEXT,
    employeeName TEXT NOT NULL,
    employeeEmail TEXT NOT NULL,
    destination TEXT NOT NULL,
    departureDate TEXT,
    returnDate TEXT,
    estimatedAmount REAL,
    currency TEXT DEFAULT 'CNY',
    purpose TEXT,
    costCenter TEXT,
    managerEmail TEXT,
    departmentManagerEmail TEXT,
    financeEmail TEXT,
    status TEXT DEFAULT 'DRAFT',
    createdAt TEXT,
    modifiedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS ApprovalRecords (
    ID TEXT PRIMARY KEY,
    travelRequest_ID TEXT NOT NULL,
    approverEmail TEXT,
    approverName TEXT,
    approverLevel TEXT,
    decision TEXT,
    comments TEXT,
    decidedAt TEXT,
    createdAt TEXT,
    FOREIGN KEY (travelRequest_ID) REFERENCES TravelRequests(ID)
  );
`);

// ── 辅助函数 ─────────────────────────────────────────
function now() { return new Date().toISOString(); }
function odata(value) { return { '@odata.context': '$metadata', value }; }
function odataSingle(value) { return { '@odata.context': '$metadata', ...value }; }

// ── TravelRequests CRUD ───────────────────────────────

// GET /api/travel/TravelRequests
app.get('/api/travel/TravelRequests', (req, res) => {
  try {
    let sql = 'SELECT * FROM TravelRequests WHERE 1=1';
    const params = [];

    // $filter 支持 employeeEmail eq 'x'
    const filter = req.query.$filter || req.query['%24filter'];
    if (filter) {
      const m = filter.match(/employeeEmail\s+eq\s+'([^']+)'/i);
      if (m) { sql += ' AND employeeEmail = ?'; params.push(m[1]); }
    }

    const orderby = req.query.$orderby || req.query['%24orderby'];
    if (orderby && orderby.includes('createdAt')) {
      sql += orderby.includes('desc') ? ' ORDER BY createdAt DESC' : ' ORDER BY createdAt ASC';
    } else {
      sql += ' ORDER BY createdAt DESC';
    }

    const top = parseInt(req.query.$top || req.query['%24top'] || '100');
    sql += ' LIMIT ?';
    params.push(top);

    const rows = db.prepare(sql).all(...params);
    res.json(odata(rows));
  } catch (e) {
    res.status(500).json({ error: { message: e.message } });
  }
});

// GET /api/travel/TravelRequests(id) or /api/travel/TravelRequests/id
app.get('/api/travel/TravelRequests/:id', (req, res) => {
  const id = req.params.id.replace(/[()]/g, '');
  const row = db.prepare('SELECT * FROM TravelRequests WHERE ID = ?').get(id);
  if (!row) return res.status(404).json({ error: { message: '申请不存在' } });
  res.json(odataSingle(row));
});

// POST /api/travel/TravelRequests
app.post('/api/travel/TravelRequests', (req, res) => {
  const d = req.body;
  const required = ['employeeName', 'employeeEmail', 'destination', 'estimatedAmount', 'purpose', 'costCenter', 'managerEmail'];
  for (const f of required) {
    if (!d[f]) return res.status(400).json({ error: { message: `缺少必填字段: ${f}` } });
  }
  if (d.estimatedAmount <= 0) return res.status(400).json({ error: { message: '申请金额必须大于 0' } });
  if (d.departureDate && d.returnDate && new Date(d.returnDate) < new Date(d.departureDate)) {
    return res.status(400).json({ error: { message: '返回日期不能早于出发日期' } });
  }
  const id = uuidv4();
  const ts = now();
  db.prepare(`INSERT INTO TravelRequests
    (ID,employeeId,employeeName,employeeEmail,destination,departureDate,returnDate,
     estimatedAmount,currency,purpose,costCenter,managerEmail,departmentManagerEmail,financeEmail,
     status,createdAt,modifiedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'DRAFT',?,?)`).run(
    id, d.employeeId || null, d.employeeName, d.employeeEmail, d.destination,
    d.departureDate || null, d.returnDate || null, d.estimatedAmount, d.currency || 'CNY',
    d.purpose, d.costCenter, d.managerEmail,
    d.departmentManagerEmail || null, d.financeEmail || null, ts, ts
  );
  const row = db.prepare('SELECT * FROM TravelRequests WHERE ID = ?').get(id);
  res.status(201).json(odataSingle(row));
});

// ── ApprovalRecords ────────────────────────────────────
app.get('/api/travel/ApprovalRecords', (req, res) => {
  let sql = 'SELECT * FROM ApprovalRecords WHERE 1=1';
  const params = [];
  const filter = req.query.$filter || req.query['%24filter'];
  if (filter) {
    const m = filter.match(/travelRequest_ID\s+eq\s+([^\s&]+)/i);
    if (m) { sql += ' AND travelRequest_ID = ?'; params.push(m[1].replace(/'/g, '')); }
  }
  sql += ' ORDER BY createdAt ASC';
  const rows = db.prepare(sql).all(...params);
  res.json(odata(rows));
});

// ── Actions ────────────────────────────────────────────

// POST /api/travel/submitRequest
app.post('/api/travel/submitRequest', async (req, res) => {
  const { requestId } = req.body;
  if (!requestId) return res.status(400).json({ error: { message: 'requestId 必填' } });

  const request = db.prepare('SELECT * FROM TravelRequests WHERE ID = ?').get(requestId);
  if (!request) return res.status(404).json({ error: { message: `申请 ${requestId} 不存在` } });
  if (request.status !== 'DRAFT') {
    return res.status(409).json({ error: { message: `申请当前状态为 ${request.status}，无法重新提交` } });
  }

  db.prepare('UPDATE TravelRequests SET status=?, modifiedAt=? WHERE ID=?').run('PENDING', now(), requestId);

  const webhookUrl = process.env.N8N_TRAVEL_WORKFLOW_URL;
  if (webhookUrl) {
    try {
      const { default: fetch } = await import('node-fetch');
      const payload = { requestId: request.ID, employeeEmail: request.employeeEmail,
        employeeName: request.employeeName, destination: request.destination,
        departureDate: request.departureDate, returnDate: request.returnDate,
        estimatedAmount: request.estimatedAmount, currency: request.currency || 'CNY',
        purpose: request.purpose, costCenter: request.costCenter,
        managerEmail: request.managerEmail,
        departmentManagerEmail: request.departmentManagerEmail,
        financeEmail: request.financeEmail };
      const response = await fetch(webhookUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      if (!response.ok) {
        db.prepare('UPDATE TravelRequests SET status=?, modifiedAt=? WHERE ID=?').run('DRAFT', now(), requestId);
        return res.json({ value: { success: false, status: 'DRAFT', message: `工作流触发失败 (HTTP ${response.status})，请稍后重试` } });
      }
      const result = await response.json();
      if (result.status) {
        db.prepare('UPDATE TravelRequests SET status=?, modifiedAt=? WHERE ID=?').run(result.status, now(), requestId);
      }
      return res.json({ value: { success: true, status: result.status || 'PENDING', message: result.message || '申请已提交，审批流程已启动' } });
    } catch (err) {
      db.prepare('UPDATE TravelRequests SET status=?, modifiedAt=? WHERE ID=?').run('DRAFT', now(), requestId);
      return res.json({ value: { success: false, status: 'DRAFT', message: `工作流触发异常: ${err.message}` } });
    }
  }

  // 未配置 Webhook（开发模式）
  res.json({ value: { success: true, status: 'PENDING', message: '申请已提交（开发模式：工作流未触发）' } });
});

// POST /api/travel/updateApprovalStatus
app.post('/api/travel/updateApprovalStatus', (req, res) => {
  const { requestId, decision, comments, approverLevel, approverEmail, approverName } = req.body;
  if (!requestId || !decision) return res.status(400).json({ error: { message: 'requestId 和 decision 必填' } });

  const request = db.prepare('SELECT * FROM TravelRequests WHERE ID = ?').get(requestId);
  if (!request) return res.status(404).json({ error: { message: `申请 ${requestId} 不存在` } });

  const decisionUpper = decision.toUpperCase();
  let newStatus;
  if (decisionUpper === 'REJECTED') {
    newStatus = 'REJECTED';
  } else if (decisionUpper === 'APPROVED') {
    const levelUpper = (approverLevel || '').toUpperCase();
    if (levelUpper === 'AUTO' || levelUpper === 'L3_FINANCE') {
      newStatus = 'APPROVED';
    } else if (levelUpper === 'L1_MANAGER' && request.estimatedAmount <= 10000) {
      newStatus = 'APPROVED';
    } else {
      newStatus = request.status;
    }
  } else {
    return res.status(400).json({ error: { message: `无效的审批决策: ${decision}` } });
  }

  const recId = uuidv4();
  const ts = now();
  db.prepare(`INSERT INTO ApprovalRecords
    (ID,travelRequest_ID,approverEmail,approverName,approverLevel,decision,comments,decidedAt,createdAt)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    recId, requestId, approverEmail || '', approverName || '',
    (approverLevel || '').toUpperCase(), decisionUpper,
    comments || '', ts, ts
  );
  db.prepare('UPDATE TravelRequests SET status=?, modifiedAt=? WHERE ID=?').run(newStatus, ts, requestId);

  res.json({ value: { success: true, requestId, status: newStatus, message: `审批状态已更新为 ${newStatus}` } });
});

// ── 启动服务器 ─────────────────────────────────────────
const PORT = process.env.PORT || 4004;
createServer(app).listen(PORT, () => {
  console.log(`[travel-cap] 差旅申请服务已启动: http://localhost:${PORT}`);
  console.log(`[travel-cap] API 路径: /api/travel/TravelRequests`);
  console.log(`[travel-cap] 前端页面: http://localhost:${PORT}/`);
});
