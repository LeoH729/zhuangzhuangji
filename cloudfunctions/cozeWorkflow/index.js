// 云函数：代理调用 Coze 工作流（读取密钥与工作流ID）
const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 允许的默认基础URL（可被数据库中的 coze_base_url 覆盖）
const DEFAULT_BASE_URL = 'https://api.coze.cn/v1/workflow/run';

exports.main = async (event, context) => {
  const { alias, workflow_id, parameters } = event || {};

  try {
    // 读取密钥与工作流映射
    const resSecrets = await db.collection('app_config').doc('secrets').get();
    const secrets = resSecrets && resSecrets.data ? resSecrets.data : {};

    const apiKey = secrets.coze_api_key;
    const baseUrl = secrets.coze_base_url || DEFAULT_BASE_URL;

    if (!apiKey) {
      return { success: false, code: 'NO_API_KEY', message: '未配置 coze_api_key' };
    }

    // 解析 workflow_ids（支持字符串或对象）
    let wfIds = secrets.workflow_ids || {};
    if (typeof wfIds === 'string') {
      try { wfIds = JSON.parse(wfIds); } catch (_) { wfIds = {}; }
    }

    // 选择最终的工作流ID
    let finalWorkflowId = workflow_id;
    if (!finalWorkflowId && alias) {
      finalWorkflowId = wfIds[alias];
    }
    if (!finalWorkflowId) {
      return { success: false, code: 'WF_NOT_FOUND', message: '缺少工作流ID或别名映射' };
    }

    // 组装请求
    const payload = {
      workflow_id: finalWorkflowId,
      parameters: parameters || {}
    };

    // 发起请求
    const response = await axios.post(baseUrl, payload, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 120000 // 120秒超时，与前端遮罩时长一致
    });

    // 为兼容前端解析方法，直接返回后端的 data（其中应包含 data: '{...json...}'）
    return response.data;
  } catch (error) {
    // 归一化错误输出
    const msg = (error && (error.message || error.errMsg)) || '服务异常';
    const status = error && error.response && error.response.status;
    return { success: false, code: 'HTTP_ERROR', status, message: msg };
  }
};