// 云函数：代理调用 Coze 工作流（读取密钥与工作流ID）+ 图片转存
const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 允许的默认基础URL（可被数据库中的 coze_base_url 覆盖）
const DEFAULT_BASE_URL = 'https://api.coze.cn/v1/workflow/run';

exports.main = async (event, context) => {
  const { alias, workflow_id, parameters, action } = event || {};

  // 图片转存动作
  if (action === 'transferImage') {
    return await transferImageToCloud(event.imageUrl);
  }

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
      // 优先直接匹配 (例如 alias='style_001', config key='style_001')
      finalWorkflowId = wfIds[alias];

      // 兼容旧逻辑或特殊前缀 (如果 config key 是 'Style_style_001')
      if (!finalWorkflowId) {
        finalWorkflowId = wfIds['Style_' + alias];
      }
    }
    if (!finalWorkflowId) {
      return { success: false, code: 'WF_NOT_FOUND', message: `缺少工作流ID或别名映射 (alias=${alias})` };
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

// 在云端下载外部图片并上传到云存储（绕过前端域名限制）
async function transferImageToCloud(imageUrl) {
  if (!imageUrl) {
    return { success: false, message: '缺少 imageUrl' };
  }

  try {
    // 云端下载（不受域名白名单限制）
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxRedirects: 5
    });

    const buffer = Buffer.from(response.data);
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const cloudPath = `generated_results/${uniqueId}.png`;

    // 上传到云存储
    const uploadRes = await cloud.uploadFile({
      cloudPath,
      fileContent: buffer
    });

    return { success: true, fileID: uploadRes.fileID };
  } catch (err) {
    console.error('[transferImage] error:', err);
    return { success: false, message: err.message || '图片转存失败' };
  }
}