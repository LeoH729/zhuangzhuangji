const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const axios = require('axios');

// 初始化云开发环境
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 环境变量优先；线上函数目前只配了 AppSecret，必须保留 AppID / OfferID / AppKey 兜底，否则会报 appid missing。
const CONFIG = {
  appId: String(process.env.WX_APP_ID || 'wx2e1dbc56f270e910').trim(),
  appSecret: String(process.env.WX_APP_SECRET || '').trim(),
  offerId: String(process.env.XPAY_OFFER_ID || '1450540036').trim(),
  appKeySandbox: String(process.env.XPAY_APP_KEY_SANDBOX || 'NmSHjfUbu918c7ojfmRUuIoLznUmNTkr').trim(),
  appKeyProd: String(process.env.XPAY_APP_KEY || 'ncvkmTWW4EvP8Ujt9D7pwpy248sBjPIX').trim(),
  env: parseInt(process.env.XPAY_ENV !== undefined ? process.env.XPAY_ENV : '0', 10)
};

function getActiveAppKey() {
  return CONFIG.env === 1 ? CONFIG.appKeySandbox : CONFIG.appKeyProd
}

function getPaymentConfigError() {
  const missing = []
  if (!CONFIG.appId) missing.push('WX_APP_ID')
  if (!CONFIG.offerId) missing.push('XPAY_OFFER_ID')
  if (!getActiveAppKey()) missing.push(CONFIG.env === 1 ? 'XPAY_APP_KEY_SANDBOX' : 'XPAY_APP_KEY')
  if (Number.isNaN(CONFIG.env) || ![0, 1].includes(CONFIG.env)) missing.push('XPAY_ENV')
  return missing.length ? `虚拟支付配置不完整，缺少: ${missing.join(', ')}` : ''
}

function pickField(payload, keys = []) {
  const source = payload && payload.data ? Object.assign({}, payload, payload.data) : (payload || {})
  for (const key of keys) {
    if (source[key]) return source[key]
  }
  return ''
}

async function getSessionKey(jsCode, appId) {
  const errors = []
  const openApiAttempts = [
    () => cloud.openapi.auth.code2Session({ jsCode }),
    () => cloud.openapi.auth.code2Session({ js_code: jsCode }),
    () => cloud.openapi.login.code2Session({ js_code: jsCode, grant_type: 'authorization_code' })
  ]
  for (const attempt of openApiAttempts) {
    try {
      const res = await attempt()
      const sessionKey = pickField(res, ['sessionKey', 'session_key'])
      if (sessionKey) {
        console.log('[virtualPayment] 通过云调用获取 session_key 成功')
        return sessionKey
      }
    } catch (err) {
      errors.push(`云调用 ${err.errCode || ''} ${err.message || err.errMsg || err}`.trim())
    }
  }

  if (appId && CONFIG.appSecret) {
    const sessionRes = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
      params: {
        appid: appId,
        secret: CONFIG.appSecret,
        js_code: jsCode,
        grant_type: 'authorization_code'
      }
    })
    if (sessionRes.data && sessionRes.data.session_key) return sessionRes.data.session_key
    errors.push(`jscode2session ${sessionRes.data && sessionRes.data.errcode} ${sessionRes.data && sessionRes.data.errmsg}`)
  } else {
    errors.push('未配置有效 AppSecret')
  }

  throw new Error(errors.filter(Boolean).join('；') || '无法获取 session_key')
}

async function getAccessToken(appId) {
  const openApiAttempts = [
    () => cloud.openapi.getLatestAvailableToken(),
    () => cloud.openapi.auth.getAccessToken({})
  ]
  for (const attempt of openApiAttempts) {
    try {
      const res = await attempt()
      const token = pickField(res, ['accessToken', 'access_token'])
      if (token) {
        console.log('[virtualPayment] 通过云调用获取 access_token 成功')
        return token
      }
    } catch (err) {
      console.warn('[virtualPayment] 云调用 access_token 失败:', err && (err.message || err.errMsg))
    }
  }

  if (!appId || !CONFIG.appSecret) {
    throw new Error('无法获取 access_token：AppSecret 无效且云调用失败')
  }
  const tokenRes = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
    params: {
      grant_type: 'client_credential',
      appid: appId,
      secret: CONFIG.appSecret
    }
  })
  if (tokenRes.data && tokenRes.data.access_token) return tokenRes.data.access_token
  throw new Error(`获取微信接口令牌失败: ${(tokenRes.data && tokenRes.data.errmsg) || 'unknown'}`)
}

/**
 * HMAC-SHA256 签名计算辅助函数
 * @param {string} key 密钥
 * @param {string} data 待签名字符串
 * @returns {string} 16进制小写签名值
 */
function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

/**
 * 云函数主入口拦截器（处理微信消息推送回调）
 */
exports.main = async (event, context) => {
  let isWechatCallback = false;
  if (event.MsgType === 'event' && event.Event === 'xpay_goods_deliver_notify') {
    console.log('🔔 [virtualPayment] 收到微信被动发货通知事件，准备进行发货...', event);
    isWechatCallback = true;
    // 强制转换为 queryOrder 动作，复用内部的主动查单与加积分逻辑
    event.action = 'queryOrder';
    event.orderNo = event.OrderId || event.OutTradeNo;
  }

  const result = await handleRequest(event, context);

  // 如果是微信的消息推送回调，必须返回特定的结构告诉微信我们处理成功了，否则微信会一直重试
  if (isWechatCallback) {
    console.log('[virtualPayment] 微信发货通知处理完毕，返回标准 ErrCode 响应');
    return {
      ErrCode: 0,
      ErrMsg: "success"
    };
  }

  return result;
};

/**
 * 核心业务处理逻辑
 */
async function handleRequest(event, context) {
  console.log('=== [virtualPayment] 接收到请求 ===', { event });
  
  const wxContext = cloud.getWXContext();
  // 适配微信消息推送事件，脱机无 wxContext.OPENID 时使用 event.OpenId
  const OPENID = wxContext.OPENID || event.userInfo?.openId || event.OpenId;
  const db = cloud.database();
  const _ = db.command;
  
  if (!OPENID) {
    return { success: false, message: '无法获取有效的用户 OpenID' };
  }

  const activeAppKey = getActiveAppKey();
  const runtimeAppId = String(wxContext.APPID || CONFIG.appId || '').trim();
  console.log(`[virtualPayment] 当前环境: ${CONFIG.env === 1 ? '沙箱环境 (env=1)' : '现网环境 (env=0)'}, appid=${runtimeAppId}`);
  const configError = getPaymentConfigError();
  if (configError) {
    console.error('[virtualPayment] 配置校验失败:', configError);
    return { success: false, message: configError };
  }

  // ==================== 动作 1：创建预下单订单并计算签名 ====================
  if (event.action === 'createOrder') {
    const { code, productId, goodsPrice, description, attach } = event;
    
    if (!code) {
      return { success: false, message: '交易预下单失败：缺少临时会话 code 凭证' };
    }
    if (!productId || !goodsPrice) {
      return { success: false, message: '交易预下单失败：商品参数不完整' };
    }

    try {
      console.log('[virtualPayment] 正在换取 session_key, appid=', runtimeAppId);
      let sessionKey = ''
      try {
        sessionKey = await getSessionKey(code, runtimeAppId)
      } catch (sessionError) {
        console.error('[virtualPayment] 换取 session_key 失败:', sessionError)
        return {
          success: false,
          message: `获取微信 session_key 失败: ${sessionError.message || sessionError}`
        }
      }
      console.log('[virtualPayment] 成功换取 session_key');

      // 2. 生成唯一的防重商户订单号 (VP + 时间戳 + 随机数)
      const timestamp = Date.now();
      const orderNo = `VP${timestamp}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;

      // 3. 构建符合微信官方规范的 signData 结构 (按参数首字母 ASCII 升序字典排序，保证不同平台和微信版本下签名的一致性)
      const rawSignData = {
        attach: attach || '',
        buyQuantity: 1,
        currencyType: 'CNY',
        env: CONFIG.env,
        goodsPrice: parseInt(goodsPrice, 10),
        offerId: CONFIG.offerId,
        outTradeNo: orderNo,
        productId: productId
      };

      // 显式按照 Key 的 ASCII 码升序进行 JSON 字符串序列化，防止 JS 引擎顺序异常导致 -15005 签名无效错误
      const signData = JSON.stringify(
        Object.keys(rawSignData)
          .sort()
          .reduce((acc, key) => {
            acc[key] = rawSignData[key];
            return acc;
          }, {})
      );
      console.log('[virtualPayment] 构建并已按 ASCII 升序字典排序的 signData 字符串:', signData);

      // 4. 计算双重签名
      // A. paySig: 使用对应的 AppKey 对 `requestVirtualPayment&` + `signData` 进行 HMAC-SHA256
      const paySig = hmacSha256(activeAppKey, `requestVirtualPayment&${signData}`);
      
      // B. signature: 使用解出的 session_key 对 `signData` 进行 HMAC-SHA256
      const signature = hmacSha256(sessionKey, signData);
      
      console.log('[virtualPayment] 计算签名成功:', { paySig, signature });

      const payParams = {
        mode: 'short_series_goods',
        env: CONFIG.env,
        signData: signData,
        paySig: paySig,
        signature: signature
      };

      // 5. 保存预下单记录至 orders 集合中，便于发货匹配与对账
      await db.collection('orders').add({
        data: {
          out_trade_no: orderNo,
          orderNo: orderNo,
          productId: productId,
          amount: goodsPrice, // 单位为分
          openid: OPENID,
          status: 'CREATED',
          pay_type: 'VIRTUAL_PAYMENT',
          mode: 'short_series_goods',
          attach: attach,
          env: CONFIG.env,
          created_at: new Date(),
          expire_time: new Date(Date.now() + 30 * 60 * 1000) // 30分钟后过期
        }
      });
      console.log('[virtualPayment] 下单数据库记录创建成功:', orderNo);

      return {
        success: true,
        data: {
          orderNo: orderNo,
          payParams: payParams
        }
      };

    } catch (error) {
      console.error('[virtualPayment] createOrder 流程异常:', error);
      return { success: false, message: `创建支付订单失败: ${error.message || error}` };
    }
  }

  // ==================== 动作 2：主动查询订单状态并核销对账（发货兜底） ====================
  if (event.action === 'queryOrder') {
    const { orderNo } = event;
    
    if (!orderNo) {
      return { success: false, message: '查询失败：缺少订单号' };
    }

    try {
      // 1. 查询本地 orders 记录
      const orderQuery = await db.collection('orders').where({ out_trade_no: orderNo }).get();
      if (orderQuery.data.length === 0) {
        return { success: false, message: `订单 ${orderNo} 在数据库中未找到` };
      }

      const order = orderQuery.data[0];
      
      // 如果本地状态已经成功，则直接发货成功响应
      if (order.status === 'PAID') {
        return { success: true, status: 'PAID', message: '订单已成功付款并已发货完成' };
      }

      // 2. 本地尚未核销，主动向微信服务器发起 `/xpay/query_order` 查询最新支付状态
      console.log('[virtualPayment] 订单本地状态为 CREATED，向微信支付接口查询最新付款状态...', orderNo);
      
      console.log('[virtualPayment] 正在获取 access_token...');
      let accessToken = ''
      try {
        accessToken = await getAccessToken(runtimeAppId)
      } catch (tokenError) {
        console.error('[virtualPayment] 获取 access_token 失败:', tokenError)
        return { success: false, message: tokenError.message || '获取微信接口令牌失败' }
      }

      // B. 准备请求 Payload 字段 (按 ASCII 升序排序以保证对账接口签名一致性)
      const rawRequestPayload = {
        env: CONFIG.env,
        openid: OPENID,
        order_id: orderNo // 注意参数键为 order_id
      };
      
      const requestPayload = Object.keys(rawRequestPayload)
        .sort()
        .reduce((acc, key) => {
          acc[key] = rawRequestPayload[key];
          return acc;
        }, {});

      const postBody = JSON.stringify(requestPayload);

      // C. 计算接口签名 pay_sig
      // 公式: HMAC_SHA256(appKey, uri + "&" + postBody)
      const uri = '/xpay/query_order';
      const paySig = hmacSha256(activeAppKey, `${uri}&${postBody}`);

      // D. 发送 POST 查询请求
      console.log('[virtualPayment] 发送微信主动对账请求...');
      const queryUrl = `https://api.weixin.qq.com/xpay/query_order?access_token=${accessToken}&pay_sig=${paySig}`;
      
      const res = await axios.post(queryUrl, requestPayload, {
        headers: { 'Content-Type': 'application/json' }
      });
      
      console.log('[virtualPayment] 微信对账响应:', res.data);

      // E. 解析微信状态：errcode === 0 且 order.status 为 2 (已支付待发货) 或 4 (已发货完成)
      if (res.data && res.data.errcode === 0 && res.data.order && (res.data.order.status === 2 || res.data.order.status === 4)) {
        console.log('🎯 微信确认已付款成功！立即执行发货发点数流程...', orderNo);
        
        // 3. 执行原子性发货加点数逻辑
        let attachData = {};
        try {
          if (order.attach) {
            attachData = JSON.parse(order.attach);
          }
        } catch (e) {
          console.warn('[virtualPayment] 解析 attach 参数异常:', e);
        }

        const eggAmount = attachData.eggAmount || 0;
        console.log(`[virtualPayment] 本次充值增加的星光数量: ${eggAmount}`);

        if (eggAmount > 0) {
          // A. 原子累加用户积分数据
          try {
            await db.collection('user_points').doc(OPENID).update({
              data: {
                points: _.inc(eggAmount),
                lastReason: `recharge_vp_${order.amount}`,
                updatedAt: new Date()
              }
            });
            console.log(`[virtualPayment] 用户 ${OPENID} 积分累加成功`);
          } catch (err) {
            // 用户记录不存在则初始化
            if (err.message && (err.message.includes('Document not found') || err.code === -502001)) {
              await db.collection('user_points').doc(OPENID).set({
                data: {
                  points: eggAmount,
                  lastReason: `recharge_vp_${order.amount}`,
                  createdAt: new Date(),
                  updatedAt: new Date()
                }
              });
              console.log(`[virtualPayment] 用户 ${OPENID} 积分初始化创建成功`);
            } else {
              throw err;
            }
          }

          // B. 写入 points_history 收支日志表
          await db.collection('points_history').add({
            data: {
              _openid: OPENID,
              type: 'recharge',
              amount: eggAmount,
              reason: `recharge_vp_${order.amount}`,
              title: order.description || '星光充值',
              createdAt: new Date()
            }
          });
          console.log('[virtualPayment] 收支流水记录保存成功');
        }

        // 如果微信侧状态为 2 (已支付待发货)，则向微信发起 notify_provide_goods 通报发货，完成合规闭环
        if (res.data.order.status === 2) {
          console.log('[virtualPayment] 订单在微信侧为已支付待发货状态，发起 notify_provide_goods 发货通报...');
          try {
            const rawDeliverPayload = {
              env: CONFIG.env,
              order_id: orderNo
            };
            const deliverPayload = Object.keys(rawDeliverPayload)
              .sort()
              .reduce((acc, key) => {
                acc[key] = rawDeliverPayload[key];
                return acc;
              }, {});
            const deliverPostBody = JSON.stringify(deliverPayload);
            const deliverUri = '/xpay/notify_provide_goods';
            const deliverPaySig = hmacSha256(activeAppKey, `${deliverUri}&${deliverPostBody}`);
            
            const deliverUrl = `https://api.weixin.qq.com/xpay/notify_provide_goods?access_token=${accessToken}&pay_sig=${deliverPaySig}`;
            const deliverRes = await axios.post(deliverUrl, deliverPayload, {
              headers: { 'Content-Type': 'application/json' }
            });
            console.log('[virtualPayment] 微信发货通报响应:', deliverRes.data);
            if (deliverRes.data && deliverRes.data.errcode !== 0) {
              console.warn('[virtualPayment] 微信发货通报失败:', deliverRes.data);
            }
          } catch (deliverError) {
            console.error('[virtualPayment] 微信发货通报异常:', deliverError);
            // 容错处理：不阻断本地已完成的加点数流程
          }
        }

        // 4. 更新订单本地状态为已发货 PAID
        await db.collection('orders').doc(order._id).update({
          data: {
            status: 'PAID',
            transaction_id: res.data.order.wx_order_id || '',
            trade_state: 'SUCCESS',
            paid_amount: order.amount,
            success_time: new Date().toISOString(),
            updated_at: new Date()
          }
        });
        console.log('[virtualPayment] 订单本地状态标记 PAID 成功:', orderNo);

        return { success: true, status: 'PAID', message: '查单对账并成功发货' };
      }

      // 如果微信对账接口返回了错误码，则明确返回失败及错误信息，避免静默掩盖
      if (res.data && res.data.errcode !== 0) {
        console.error('[virtualPayment] 微信对账接口返回错误:', res.data);
        return {
          success: false,
          code: 'XPAY_ERROR',
          status: 'ERROR',
          message: `微信支付对账失败: [${res.data.errcode}] ${res.data.errmsg}`
        };
      }

      // 微信侧尚未付款
      return { 
        success: true, 
        status: 'PENDING', 
        message: '订单尚未付款或微信仍在处理中' 
      };

    } catch (error) {
      console.error('[virtualPayment] queryOrder 流程异常:', error);
      return { success: false, message: `查询对账处理失败: ${error.message || error}` };
    }
  }

  return { success: false, message: '未定义的云函数动作 action' };
};
