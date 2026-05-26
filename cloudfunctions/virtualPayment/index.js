const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const axios = require('axios');

// 初始化云开发环境
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 从环境变量读取配置，并使用用户提供的正确值作为硬编码兜底，确保免配置即时可用
const CONFIG = {
  appId: process.env.WX_APP_ID || 'wx2e1dbc56f270e910',                        // 小程序 AppID
  appSecret: process.env.WX_APP_SECRET,                                        // 小程序 AppSecret
  offerId: process.env.XPAY_OFFER_ID || '1450540036',                          // 微信虚拟支付 OfferID
  appKeySandbox: process.env.XPAY_APP_KEY_SANDBOX || 'NmSHjfUbu918c7ojfmRUuIoLznUmNTkr', // 微信虚拟支付 沙箱 AppKey
  appKeyProd: process.env.XPAY_APP_KEY || 'ncvkmTWW4EvP8Ujt9D7pwpy248sBjPIX',   // 微信虚拟支付 现网 AppKey
  // 支付环境：0为现网环境，1为沙箱环境。目前切换为 0 (现网)，供体验版/正式版测试真实支付
  env: parseInt(process.env.XPAY_ENV !== undefined ? process.env.XPAY_ENV : '0', 10)
};

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

  // 根据当前环境选择对应的 AppKey
  const activeAppKey = CONFIG.env === 1 ? CONFIG.appKeySandbox : CONFIG.appKeyProd;
  console.log(`[virtualPayment] 当前环境: ${CONFIG.env === 1 ? '沙箱环境 (env=1)' : '现网环境 (env=0)'}`);

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
      // 1. 使用临时 code 实时从微信官方换取 session_key
      console.log('[virtualPayment] 正在请求微信 jscode2session 换取会话密钥...');
      
      // 获取 AppSecret 变量，如果环境变量未定义，则提示需要配置
      const appSecret = CONFIG.appSecret || process.env.WX_APP_SECRET;
      if (!appSecret) {
        return { 
          success: false, 
          message: '未配置小程序 AppSecret。请先在云开发控制台的“环境变量”中配置 WX_APP_SECRET！' 
        };
      }

      const sessionRes = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
        params: {
          appid: CONFIG.appId,
          secret: appSecret,
          js_code: code,
          grant_type: 'authorization_code'
        }
      });

      const sessionKey = sessionRes.data?.session_key;
      if (!sessionKey) {
        console.error('[virtualPayment] 换取 session_key 失败:', sessionRes.data);
        return { 
          success: false, 
          message: `获取微信 session_key 失败: ${sessionRes.data?.errmsg || '账户配置或凭证无效'}` 
        };
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
      
      const appSecret = CONFIG.appSecret || process.env.WX_APP_SECRET;
      if (!appSecret) {
        return { success: false, message: '查单失败：未配置小程序 AppSecret' };
      }

      // A. 获取通用接口凭证 access_token
      console.log('[virtualPayment] 正在获取 access_token...');
      const tokenRes = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
        params: {
          grant_type: 'client_credential',
          appid: CONFIG.appId,
          secret: appSecret
        }
      });
      
      const accessToken = tokenRes.data?.access_token;
      if (!accessToken) {
        console.error('[virtualPayment] 获取 access_token 失败:', tokenRes.data);
        return { success: false, message: '获取微信接口令牌失败' };
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
