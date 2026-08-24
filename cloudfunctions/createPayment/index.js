/**
 * 创建支付订单云函数
 * 基于微信支付V3 API实现JSAPI/小程序下单
 * 参考文档: https://pay.weixin.qq.com/doc/v3/merchant/4012791897
 */

const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const axios = require('axios');

// 初始化云开发
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

/**
 * 微信支付配置（纯环境变量方式）
 * 所有敏感配置信息都必须通过环境变量设置
 * 必需的环境变量：
 * - WX_APP_ID: 小程序AppID
 * - WX_MCH_ID: 商户号
 * - WX_API_KEY: APIv3密钥
 * - WX_SERIAL_NO: 证书序列号
 * - WX_PRIVATE_KEY: 商户私钥内容
 * - WX_NOTIFY_URL: 支付回调地址
 */
const PAYMENT_CONFIG = {
  appId: process.env.WX_APP_ID,
  mchId: process.env.WX_MCH_ID,
  apiKey: process.env.WX_API_KEY,
  serialNo: process.env.WX_SERIAL_NO,
  privateKey: formatPrivateKey(process.env.WX_PRIVATE_KEY),
  apiV3Url: 'https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi',
  notifyUrl: process.env.WX_NOTIFY_URL
};

/**
 * 格式化私钥内容
 * 处理环境变量中可能丢失的换行符
 */
function formatPrivateKey(privateKeyStr) {
  if (!privateKeyStr) {
    return null;
  }

  // 1. 处理字面量的转义换行符 (例如用户复制了 "Line1\\nLine2")
  let key = privateKeyStr.replace(/\\n/g, '\n');

  // 2. 尝试提取纯 Base64 内容
  // 移除头尾标识，并移除所有空白字符（空格、换行、制表符）
  let content = key
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');

  // 3. 重新分块构建标准 PEM 格式
  // 每64个字符插入一个换行符
  const chunks = content.match(/.{1,64}/g);

  if (!chunks) {
    return privateKeyStr;
  }

  const formatted = `-----BEGIN PRIVATE KEY-----\n${chunks.join('\n')}\n-----END PRIVATE KEY-----`;
  console.log('[formatPrivateKey] 格式化后长度:', formatted.length);
  // 只打印头尾防止泄露，用于确认格式是否正确
  if (formatted.length > 100) {
    console.log('[formatPrivateKey] 头:', formatted.substring(0, 50));
    console.log('[formatPrivateKey] 尾:', formatted.substring(formatted.length - 50));
  }
  return formatted;
}

// 配置验证和检查
function validateConfiguration() {
  const requiredEnvVars = ['WX_APP_ID', 'WX_MCH_ID', 'WX_API_KEY', 'WX_SERIAL_NO', 'WX_PRIVATE_KEY', 'WX_NOTIFY_URL'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    console.error(`❌ 错误: 以下必需的环境变量未设置:`);
    console.error(`   ${missingVars.join(', ')}`);
    console.error(`   请在云开发控制台的"环境变量"中设置这些配置！`);
    throw new Error(`缺少必需的环境变量: ${missingVars.join(', ')}`);
  }

  // 验证私钥格式
  const privateKey = PAYMENT_CONFIG.privateKey;
  if (!privateKey) {
    console.error('❌ 错误: 私钥格式化失败');
    throw new Error('私钥格式错误');
  }

  if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') || !privateKey.includes('-----END PRIVATE KEY-----')) {
    console.error('❌ 错误: 私钥格式不正确，缺少PEM标识');
    throw new Error('私钥必须是完整的PEM格式');
  }

  console.log('✅ 配置验证通过: 所有环境变量已正确设置');
  console.log('✅ 私钥格式验证通过');
}

// 启动时验证配置
validateConfiguration();

// 错误码定义
const ERROR_CODES = {
  INVALID_PARAMS: 'INVALID_PARAMS',
  USER_NOT_LOGIN: 'USER_NOT_LOGIN',
  WECHAT_API_ERROR: 'WECHAT_API_ERROR',
  SIGN_ERROR: 'SIGN_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  SYSTEM_ERROR: 'SYSTEM_ERROR'
};

/**
 * 云函数入口
 */
exports.main = async (event, context) => {
  console.log('=== 创建支付订单云函数开始 ===');
  console.log('接收到的参数:', event);

  try {
    // 参数验证
    const validation = validateParams(event);
    if (!validation.valid) {
      return createErrorResponse(ERROR_CODES.INVALID_PARAMS, validation.message);
    }

    // 获取用户OpenID
    const openid = await getUserOpenId(context);
    if (!openid) {
      return createErrorResponse(ERROR_CODES.USER_NOT_LOGIN, '获取用户OpenID失败');
    }

    // 生成订单信息
    const orderInfo = generateOrderInfo(event, openid);
    console.log('生成的订单信息:', orderInfo);

    // 调用微信支付下单API
    const prepayResult = await createWechatPayOrder(orderInfo);
    if (!prepayResult.success) {
      return createErrorResponse(ERROR_CODES.WECHAT_API_ERROR, prepayResult.message);
    }

    // 生成小程序支付参数
    const payParams = generateMiniProgramPayParams(prepayResult.prepayId);
    console.log('生成的支付参数:', payParams);

    // 保存订单到数据库
    await saveOrderToDatabase(orderInfo, prepayResult.prepayId);

    console.log('=== 创建支付订单成功 ===');
    return createSuccessResponse({
      orderNo: orderInfo.out_trade_no,
      prepayId: prepayResult.prepayId,
      payParams: payParams
    });

  } catch (error) {
    console.error('创建支付订单异常:', error);
    return createErrorResponse(ERROR_CODES.SYSTEM_ERROR, error.message || '系统异常');
  }
};

/**
 * 参数验证
 */
function validateParams(event) {
  const result = { valid: true, message: '' };

  if (!event.userInfo || !event.userInfo.nickName) {
    result.valid = false;
    result.message = '用户信息不完整';
    return result;
  }

  return result;
}

/**
 * 获取用户OpenID
 */
async function getUserOpenId(context) {
  try {
    // 从云函数上下文获取OpenID
    const { OPENID } = cloud.getWXContext();
    console.log('获取到用户OpenID:', OPENID);
    return OPENID;
  } catch (error) {
    console.error('获取OpenID失败:', error);
    return null;
  }
}

/**
 * 生成订单信息
 */
function generateOrderInfo(event, openid) {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  const orderNo = `WX${timestamp}${random}`;

  // 计算过期时间（30分钟后）
  const expireTime = new Date(Date.now() + 30 * 60 * 1000);
  const timeExpire = expireTime.toISOString().replace(/\.\d{3}Z$/, '+08:00');

  // 从前端传入的 options 获取实际支付信息
  const options = event.options || {};
  const amount = parseInt(options.amount, 10) || 1;       // 支付金额（分）
  const description = options.description || '星光充值'; // 商品描述
  const attach = options.attach || '';                     // 业务数据（JSON字符串）

  console.log('订单生成参数:', { amount, description, attach });

  return {
    appid: PAYMENT_CONFIG.appId,
    mchid: PAYMENT_CONFIG.mchId,
    description: description,
    out_trade_no: orderNo,
    time_expire: timeExpire,
    attach: attach,
    notify_url: PAYMENT_CONFIG.notifyUrl,
    amount: {
      total: amount,
      currency: 'CNY'
    },
    payer: {
      openid: openid
    },
    scene_info: {
      payer_client_ip: '127.0.0.1'
    }
  };
}

/**
 * 调用微信支付下单API
 */
async function createWechatPayOrder(orderInfo) {
  try {
    console.log('=== 调用微信支付下单API ===');

    // 构建请求体
    const requestBody = JSON.stringify(orderInfo);
    console.log('请求体:', requestBody);

    // 生成签名
    const signature = generateSignature('POST', '/v3/pay/transactions/jsapi', requestBody);

    // 构建Authorization头
    const authorization = buildAuthorizationHeader(signature);

    // 发送请求
    const response = await axios({
      method: 'POST',
      url: PAYMENT_CONFIG.apiV3Url,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': authorization,
        'User-Agent': 'WechatPay-Mini-NodeJS'
      },
      data: requestBody,
      timeout: 30000
    });

    console.log('微信支付API响应:', response.data);

    if (response.status === 200 && response.data.prepay_id) {
      return {
        success: true,
        prepayId: response.data.prepay_id
      };
    } else {
      return {
        success: false,
        message: '微信支付下单失败'
      };
    }

  } catch (error) {
    console.error('调用微信支付API失败:', error);

    if (error.response && error.response.data) {
      console.error('微信支付API错误响应:', error.response.data);
      return {
        success: false,
        message: error.response.data.message || '微信支付API调用失败'
      };
    }

    return {
      success: false,
      message: error.message || '网络请求失败'
    };
  }
}

/**
 * 生成微信支付V3签名
 */
function generateSignature(method, url, body) {
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const nonceStr = generateNonceStr();

    // 构建签名字符串
    const signatureStr = `${method}\n${url}\n${timestamp}\n${nonceStr}\n${body}\n`;
    console.log('签名字符串:', signatureStr);

    // 获取私钥
    const privateKey = PAYMENT_CONFIG.privateKey;
    if (!privateKey) {
      throw new Error('私钥为空');
    }

    // 使用私钥签名
    const sign = crypto.createSign('sha256');
    sign.update(signatureStr);
    const signature = sign.sign(privateKey, 'base64');

    console.log('签名生成成功:', signature.substring(0, 20) + '...');

    return {
      timestamp,
      nonceStr,
      signature
    };
  } catch (error) {
    console.error('生成签名失败:', error);
    throw error;
  }
}

/**
 * 构建Authorization头
 */
function buildAuthorizationHeader(signInfo) {
  return `WECHATPAY2-SHA256-RSA2048 mchid="${PAYMENT_CONFIG.mchId}",nonce_str="${signInfo.nonceStr}",signature="${signInfo.signature}",timestamp="${signInfo.timestamp}",serial_no="${PAYMENT_CONFIG.serialNo}"`;
}

/**
 * 生成小程序支付参数
 * 根据官方文档：https://pay.weixin.qq.com/doc/v3/merchant/4012791898
 * 小程序调起支付使用RSA签名，不是HMAC-SHA256
 */
function generateMiniProgramPayParams(prepayId) {
  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = generateNonceStr();
    const packageStr = `prepay_id=${prepayId}`;

    // 构建签名字符串（按照官方文档格式）
    const signStr = `${PAYMENT_CONFIG.appId}\n${timestamp}\n${nonceStr}\n${packageStr}\n`;
    console.log('小程序支付签名字符串:', signStr);

    // 使用私钥RSA签名（不是APIv3密钥HMAC签名）
    const privateKey = PAYMENT_CONFIG.privateKey;
    const sign = crypto.createSign('sha256');
    sign.update(signStr);
    const paySign = sign.sign(privateKey, 'base64');

    console.log('小程序支付RSA签名生成成功:', paySign.substring(0, 20) + '...');

    const payParams = {
      timeStamp: timestamp,
      nonceStr: nonceStr,
      package: packageStr,
      signType: 'RSA', // 官方文档要求使用RSA
      paySign: paySign
    };

    console.log('小程序支付参数:', payParams);
    return payParams;
  } catch (error) {
    console.error('生成小程序支付参数失败:', error);
    throw error;
  }
}

/**
 * 生成随机字符串
 */
function generateNonceStr(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 保存订单到数据库
 */
async function saveOrderToDatabase(orderInfo, prepayId) {
  try {
    const db = cloud.database();
    const ordersCollection = db.collection('orders');

    await ordersCollection.add({
      data: {
        out_trade_no: orderInfo.out_trade_no, // 使用正确的字段名
        orderNo: orderInfo.out_trade_no,
        prepayId: prepayId,
        appid: orderInfo.appid,
        mchid: orderInfo.mchid,
        description: orderInfo.description,
        amount: orderInfo.amount.total, // 保存实际的数值
        openid: orderInfo.payer.openid,
        status: 'CREATED',
        attach: orderInfo.attach, // 保存业务附加数据
        created_at: new Date(), // 使用下划线命名
        expire_time: new Date(orderInfo.time_expire)
      }
    });

    console.log('订单保存成功:', orderInfo.out_trade_no);
  } catch (error) {
    console.error('保存订单失败:', error);
    // 不影响主流程，只记录错误
  }
}

/**
 * 创建成功响应
 */
function createSuccessResponse(data) {
  return {
    success: true,
    data: data,
    message: '创建订单成功',
    timestamp: Date.now()
  };
}

/**
 * 创建错误响应
 */
function createErrorResponse(code, message) {
  return {
    success: false,
    code: code,
    message: message,
    timestamp: Date.now()
  };
} 
