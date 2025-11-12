/**
 * 扣子工作流API调用参考文件
 * 
 * 本文件提供了在微信小程序中调用扣子工作流API的完整示例和说明。
 * 可以作为开发者集成扣子工作流到自己项目中的参考。
 * 
 * 作者: 穿啥-AI造型师团队
 * 创建日期: 2024-03-12
 * 版本: 1.0.0
 */

/**
 * 基础配置（占位）：已改为通过云函数安全代理调用，不在前端存储密钥
 */
const COZE_CONFIG = {
  API_KEY: "",
  API_URL: "cloudfunction:cozeWorkflow"
};

/**
 * 工作流ID配置
 * 每个工作流都有一个唯一的ID，需要在扣子平台创建工作流后获取
 */
const WORKFLOW_IDS = {
  // 示例工作流ID，替换为你自己的工作流ID
  EXAMPLE_WORKFLOW: "7564249346457485338",
  
  // 可以添加更多工作流
  ANOTHER_WORKFLOW: "another_workflow_id_here"
};

/**
 * 调用扣子工作流的核心函数
 * 
 * @param {Object} params - 调用参数
 * @param {string} params.workflow_id - 要调用的工作流ID
 * @param {Object} [params.parameters] - 传递给工作流的参数，根据工作流定义的输入参数而定
 * @returns {Promise<Object>} - 返回工作流执行结果的Promise
 */
function callCozeWorkflow(params) {
  const { alias, workflow_id, parameters } = params || {};
  if (!workflow_id && !alias) {
    return Promise.reject(new Error('workflow_id or alias is required'));
  }
  // 通过云函数代理，避免在前端暴露密钥
  return wx.cloud.callFunction({
    name: 'cozeWorkflow',
    data: {
      alias,
      workflow_id,
      parameters: parameters || {}
    }
  }).then((res) => {
    // 云函数返回值直接用于 parseWorkflowResponse（应包含 data: '{...}'）
    return (res && res.result) ? res.result : res;
  });
}

/**
 * 处理工作流返回的JSON数据
 * 
 * @param {Object} result - 工作流返回的原始结果
 * @returns {Object} - 解析后的数据对象
 * @throws {Error} - 如果解析失败或数据为空
 */
function parseWorkflowResponse(result) {
  if (!result) {
    throw new Error('工作流返回数据为空');
  }

  // 兼容不同返回结构：
  // 1) 直接 { data: '...json...' }
  // 2) 包裹在 { detail: { data: '...json...' } }
  let raw = result.data;
  if (!raw && result.detail && result.detail.data) {
    raw = result.detail.data;
  }

  if (!raw) {
    throw new Error('工作流返回数据为空');
  }

  try {
    // 优先解析为对象
    let payload;
    if (typeof raw === 'string') {
      payload = JSON.parse(raw);
    } else if (typeof raw === 'object' && raw && typeof raw.data === 'string') {
      // 某些返回会再包一层 { data: '...json...' }
      payload = JSON.parse(raw.data);
    } else {
      payload = raw;
    }

    // 规范化输出：尽最大可能提取图片URL并补充到常用字段
    const isUrl = (val) => typeof val === 'string' && /^https?:\/\//.test(val);
    const pickFromObj = (obj) => {
      if (!obj || typeof obj !== 'object') return '';
      // 常见一层字段
      const directKeys = ['output', 'image', 'url', 'image_url', 'reference_image', 'result_url'];
      for (const k of directKeys) {
        if (isUrl(obj[k])) return obj[k];
      }
      // 可能的数组字段
      const arrayKeys = ['images', 'urls', 'outputs', 'files', 'attachments', 'pictures'];
      for (const k of arrayKeys) {
        const arr = obj[k];
        if (Array.isArray(arr)) {
          // outputs 可能是对象数组
          for (const item of arr) {
            if (isUrl(item)) return item;
            if (item && typeof item === 'object') {
              const candidates = ['value', 'url', 'image', 'image_url'];
              for (const ck of candidates) {
                if (isUrl(item[ck])) return item[ck];
              }
            }
          }
        }
      }
      // 深层 result/data
      if (obj.result && typeof obj.result === 'object') {
        const r = pickFromObj(obj.result);
        if (isUrl(r)) return r;
      }
      if (obj.data && typeof obj.data === 'object') {
        const d = pickFromObj(obj.data);
        if (isUrl(d)) return d;
      }
      return '';
    };

    const imageUrl = pickFromObj(payload);
    if (isUrl(imageUrl)) {
      // 不覆盖已有字段，仅补充缺失的常用键，便于调用方兜底
      if (!payload.image) payload.image = imageUrl;
      if (!payload.url) payload.url = imageUrl;
      if (!payload.output) payload.output = imageUrl;
    }

    return payload;
  } catch (error) {
    console.error('解析工作流返回数据失败:', error, raw);
    throw new Error('解析工作流返回数据失败');
  }
}

/**
 * 格式化文本内容，处理换行和序号等
 * 
 * @param {string} text - 原始文本
 * @returns {string} - 格式化后的文本
 */
function formatWorkflowText(text) {
  if (!text) return '';
  
  return text
    .replace(/\\n/g, '\n')  // 将 \n 转换为真实换行
    .replace(/(?!\n)\s+(\d+\.)/g, '\n$1')  // 在序号前添加换行，但避免重复换行
    .trim();
}

/**
 * 使用示例1: 基本调用
 * 
 * 这个示例展示了如何调用一个简单的工作流并处理结果
 */
async function exampleBasicWorkflowCall() {
  try {
    // 调用工作流
    const result = await callCozeWorkflow({
      workflow_id: WORKFLOW_IDS.EXAMPLE_WORKFLOW,
      parameters: {
        input_text: "这是一个测试输入"
      }
    });
    
    // 解析结果
    const parsedData = parseWorkflowResponse(result);
    
    // 使用解析后的数据
    console.log('工作流返回的数据:', parsedData);
    
    // 返回处理后的结果
    return {
      success: true,
      data: parsedData
    };
  } catch (error) {
    console.error('工作流调用示例失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 使用示例2: 图片分析工作流
 * 
 * 这个示例展示了如何调用一个处理图片的工作流
 * 假设工作流接收一个图片URL作为输入，并返回分析结果
 */
async function exampleImageAnalysisWorkflow(imageUrl) {
  try {
    // 确保有图片URL
    if (!imageUrl) {
      throw new Error('图片URL不能为空');
    }
    
    // 调用工作流
    const result = await callCozeWorkflow({
      workflow_id: WORKFLOW_IDS.EXAMPLE_WORKFLOW,
      parameters: {
        photo: imageUrl
      }
    });
    
    // 解析结果
    const parsedData = parseWorkflowResponse(result);
    
    // 假设返回的数据包含多个字段
    const formattedResult = {
      title: '图片分析结果',
      description: formatWorkflowText(parsedData.description || ''),
      tags: parsedData.tags || [],
      confidence: parsedData.confidence || 0
    };
    
    return {
      success: true,
      data: formattedResult
    };
  } catch (error) {
    console.error('图片分析工作流调用失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 使用示例3: 多步骤工作流
 * 
 * 这个示例展示了如何实现一个多步骤的工作流调用过程
 * 第一个工作流的输出作为第二个工作流的输入
 */
async function exampleMultiStepWorkflow(initialInput) {
  try {
    // 步骤1: 调用第一个工作流
    const step1Result = await callCozeWorkflow({
      workflow_id: WORKFLOW_IDS.EXAMPLE_WORKFLOW,
      parameters: {
        input: initialInput
      }
    });
    
    // 解析第一步结果
    const step1Data = parseWorkflowResponse(step1Result);
    
    // 步骤2: 使用第一步的结果调用第二个工作流
    const step2Result = await callCozeWorkflow({
      workflow_id: WORKFLOW_IDS.ANOTHER_WORKFLOW,
      parameters: {
        previous_result: step1Data.output,
        additional_param: "其他参数"
      }
    });
    
    // 解析第二步结果
    const step2Data = parseWorkflowResponse(step2Result);
    
    // 返回最终结果
    return {
      success: true,
      step1: step1Data,
      step2: step2Data,
      finalResult: step2Data.final_output
    };
  } catch (error) {
    console.error('多步骤工作流调用失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 错误处理最佳实践
 * 
 * 调用扣子工作流时可能遇到的常见错误及处理方法
 */
const errorHandlingBestPractices = {
  // API密钥无效
  invalidApiKey: {
    symptom: "返回401 Unauthorized错误",
    solution: "检查API_KEY是否正确，并确保它有效且未过期"
  },
  
  // 工作流ID不存在
  invalidWorkflowId: {
    symptom: "返回404 Not Found错误",
    solution: "确认工作流ID是否正确，并检查该工作流是否已发布"
  },
  
  // 参数错误
  parameterError: {
    symptom: "返回400 Bad Request错误",
    solution: "检查传递的参数是否符合工作流定义的输入要求"
  },
  
  // 超时错误
  timeoutError: {
    symptom: "请求超时",
    solution: "增加timeout时间，或者优化工作流以减少执行时间"
  },
  
  // 解析错误
  parsingError: {
    symptom: "JSON解析失败",
    solution: "检查工作流输出是否为有效的JSON格式"
  }
};

/**
 * 性能优化建议
 */
const performanceTips = [
  "设置合理的超时时间，避免长时间等待",
  "对频繁使用的工作流结果进行缓存",
  "在UI上提供加载状态反馈，提升用户体验",
  "对大型响应数据进行分段处理，避免一次性加载过多内容",
  "实现错误重试机制，提高调用成功率"
];

// 导出所有函数和常量，方便在其他文件中使用
module.exports = {
  COZE_CONFIG,
  WORKFLOW_IDS,
  callCozeWorkflow,
  parseWorkflowResponse,
  formatWorkflowText,
  exampleBasicWorkflowCall,
  exampleImageAnalysisWorkflow,
  exampleMultiStepWorkflow,
  errorHandlingBestPractices,
  performanceTips
};