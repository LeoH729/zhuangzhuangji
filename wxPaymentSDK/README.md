# 微信支付SDK

## 简介

这是一个完整的微信小程序支付SDK，基于微信支付V3 API实现，提供了从订单创建到支付完成的完整解决方案。

## 特性

- ✅ 基于微信支付V3 API
- ✅ 支持JSAPI支付（小程序支付）
- ✅ RSA2048签名算法
- ✅ 完整的支付回调处理
- ✅ 安全的配置管理
- ✅ 详细的错误处理
- ✅ 开箱即用

> ⚠️ **首次使用必读**：此SDK提供完整的支付框架，但需要您根据实际业务需求配置两个关键函数：
> 1. **createPayment云函数**中的支付金额和商品信息获取
> 2. **paymentNotify云函数**中的支付成功业务逻辑处理
> 
> 详见 [必需的业务逻辑配置](#-必需的业务逻辑配置) 章节

## 调用SDK前的准备工作

### 1. 复制SDK到项目

将整个 `wxPaymentSDK` 文件夹复制到您的小程序项目根目录：

```bash
# 复制SDK到您的项目
cp -r wxPaymentSDK your-project/

# 复制云函数
cp -r wxPaymentSDK/cloudfunctions/* your-project/cloudfunctions/
```

### 2. 配置支付参数

本SDK已采用**环境变量配置**方式，所有敏感配置信息都通过云开发环境变量进行管理，确保配置安全。

#### 2.1 进入云开发控制台配置环境变量

1. 打开**微信开发者工具**
2. 进入**云开发控制台**
3. 选择**云函数** → **版本与配置** → **配置** → **高级配置**
4. 在**环境变量**部分，添加以下配置项：

#### 2.2 createPayment云函数环境变量配置

为 `createPayment` 云函数添加以下**6个环境变量**：

| 环境变量名 | 说明 | 示例值 |
|-----------|------|--------|
| `WX_APP_ID` | 小程序AppID | `wx1234567890abcdef` |
| `WX_MCH_ID` | 商户号 | `1234567890` |
| `WX_API_KEY` | APIv3密钥 | `32位随机字符串` |
| `WX_SERIAL_NO` | 证书序列号 | `1234567890ABCDEF` |
| `WX_PRIVATE_KEY` | 商户私钥内容 | `-----BEGIN PRIVATE KEY-----...` |
| `WX_NOTIFY_URL` | 支付回调地址 | `步骤4获取后填写` |

> ⚠️ **重要提醒**：
> - 私钥内容必须包含完整的PEM格式标识
> - 回调地址在步骤4配置HTTP触发器后获取

#### 2.3 paymentNotify云函数环境变量配置

为 `paymentNotify` 云函数添加以下**4个环境变量**：

| 环境变量名 | 说明 | 示例值 |
|-----------|------|--------|
| `WX_APP_ID` | 小程序AppID | `与createPayment保持一致` |
| `WX_MCH_ID` | 商户号 | `与createPayment保持一致` |
| `WX_API_KEY` | APIv3密钥 | `与createPayment保持一致` |
| `WX_SERIAL_NO` | 证书序列号 | `与createPayment保持一致` |

#### 2.4 配置步骤详解

1. **添加环境变量**：
   ```
   点击"新增环境变量"按钮
   → 输入变量名（如：WX_APP_ID）
   → 输入对应的值
   → 点击确认
   ```

2. **私钥格式要求**：
   ```
   WX_PRIVATE_KEY 的值必须是完整的PEM格式：
   -----BEGIN PRIVATE KEY-----
   MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...
   （私钥内容，多行）
   -----END PRIVATE KEY-----
   ```

3. **配置验证**：
   - 云函数会在启动时自动验证所有必需的环境变量
   - 如有配置错误，云函数日志会显示详细的错误信息

#### 2.5 验证环境变量配置

配置完成后，可以通过以下方式验证配置是否正确：

1. **查看云函数日志**：
   ```
   部署云函数后 → 点击"详情" → 查看"调用日志"
   正确配置会显示：✅ 配置验证通过: 所有环境变量已正确设置
   错误配置会显示：❌ 错误: 以下必需的环境变量未设置
   ```

2. **测试云函数调用**：
   ```javascript
   // 在小程序中测试createPayment云函数
   wx.cloud.callFunction({
     name: 'createPayment',
     data: {
       userInfo: { nickName: 'test' }
     },
     success: res => {
       console.log('配置验证结果:', res);
     }
   });
   ```

3. **常见配置错误及解决方案**：
   | 错误信息 | 原因 | 解决方案 |
   |---------|------|----------|
   | `缺少必需的环境变量: WX_APP_ID` | 环境变量未设置 | 检查变量名是否正确，值是否填写 |
   | `私钥格式错误` | 私钥格式不正确 | 确保包含完整的PEM标识和换行符 |
   | `网络请求失败` | API密钥或商户号错误 | 检查商户后台配置是否一致 |

### 3. 部署云函数

在微信开发者工具中：

1. **部署createPayment云函数**
   ```
   右键点击 cloudfunctions/createPayment 文件夹
   → 选择"上传并部署：云端安装依赖"
   ```

2. **部署paymentNotify云函数**
   ```
   右键点击 cloudfunctions/paymentNotify 文件夹
   → 选择"上传并部署：云端安装依赖"
   ```

### 4. 配置回调地址

#### 4.1 为paymentNotify配置HTTP触发器

1. **配置HTTP触发器**
   ```
   右键点击已部署的 paymentNotify 云函数
   → 选择"配置HTTP触发器"
   → 复制生成的HTTP访问URL
   ```

2. **获取完整回调地址**
   ```
   示例URL格式：
   https://service-xxx.ap-shanghai.apigw.tencentcs.com/release/paymentNotify
   ```

#### 4.2 更新createPayment云函数的回调地址环境变量

1. **进入createPayment云函数配置**
   ```
   云开发控制台 → 云函数 → createPayment → 版本与配置 → 配置 → 高级配置
   ```

2. **更新WX_NOTIFY_URL环境变量**
   ```
   找到之前添加的 WX_NOTIFY_URL 环境变量
   → 点击"编辑"
   → 将值更新为刚才获取的HTTP访问URL
   → 保存
   ```

#### 4.3 重新部署createPayment云函数

配置更新后，需要重新部署使环境变量生效：
```
右键点击 cloudfunctions/createPayment 文件夹
→ 选择"上传并部署：云端安装依赖"
```

> 💡 **提示**：环境变量配置的优势
> - 无需修改代码文件
> - 配置更加安全
> - 支持不同环境（开发/生产）使用不同配置
> - 避免敏感信息暴露在代码中

## 在项目中使用SDK

> ⚠️ **重要提醒**：使用SDK前必须完成以下业务逻辑配置，否则将无法正常处理实际业务场景！

### 📋 必需的业务逻辑配置

#### ⭐ 配置1：createPayment云函数 - 获取实际支付信息

**位置**：`wxPaymentSDK/cloudfunctions/createPayment/index.js` 中的 `generateOrderInfo` 函数

**问题**：SDK默认使用硬编码的测试金额（0.01元），必须修改为获取实际业务支付信息。

**必需修改**：
```javascript
// ❌ SDK默认代码（仅供测试，生产环境必须修改）
function generateOrderInfo(event, openid) {
  return {
    // ... 其他配置
    description: '微信支付测试', // 硬编码描述
    attach: 'lazyenglish', // 硬编码业务数据
    amount: {
      total: 1, // ❌ 硬编码1分（0.01元）
      currency: 'CNY'
    }
  };
}

// ✅ 修改后的代码（获取实际业务信息）
function generateOrderInfo(event, openid) {
  // 从前端传递的options中获取实际支付信息
  const options = event.options || {};
  const amount = parseInt(options.amount, 10) || 1; // 实际支付金额（分）
  const description = options.description || '商品购买'; // 实际商品描述
  const attach = options.attach || ''; // 实际业务数据（JSON字符串）
  
  console.log('订单生成参数:', { amount, description, attach });
  
  return {
    // ... 其他配置
    description: description, // ✅ 使用实际的商品描述
    attach: attach, // ✅ 使用实际的业务数据
    amount: {
      total: amount, // ✅ 使用实际的支付金额（分）
      currency: 'CNY'
    }
  };
}
```

#### ⭐ 配置2：paymentNotify云函数 - 处理实际业务逻辑

**位置**：`wxPaymentSDK/cloudfunctions/paymentNotify/index.js` 中的 `processPaymentSuccess` 函数

**问题**：SDK默认只处理订单状态更新，必须添加实际的业务逻辑处理。

**必需添加**：
```javascript
async function processPaymentSuccess(paymentData) {
  try {
    // ... 基础订单处理逻辑（SDK已提供）
    
    // 🎯 【必需添加】您的实际业务逻辑处理
    await handleYourBusinessLogic(order, paymentData);
    
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

// 🎯 【必需实现】您的业务逻辑处理函数
async function handleYourBusinessLogic(order, paymentData) {
  try {
    // 从订单的attach字段中解析业务信息
    const attachData = JSON.parse(order.attach || '{}');
    
    // 根据您的实际业务需求实现逻辑，例如：
    
    // 示例1：用户点数增加
    if (attachData.credits) {
      const creditsToAdd = parseInt(attachData.credits, 10);
      await addUserCredits(paymentData.payer.openid, creditsToAdd);
    }
    
    // 示例2：会员升级
    if (attachData.membershipType) {
      await upgradeMembership(paymentData.payer.openid, attachData.membershipType);
    }
    
    // 示例3：商品发放
    if (attachData.productId) {
      await deliverProduct(paymentData.payer.openid, attachData.productId);
    }
    
    console.log('✅ 业务逻辑处理成功');
  } catch (error) {
    console.error('❌ 业务逻辑处理失败:', error);
    throw error;
  }
}
```

**⚠️ 重要提醒**：
- **配置1是必需的**：否则所有支付都将显示0.01元，无法处理实际金额
- **配置2是必需的**：否则支付成功后不会执行任何业务逻辑（如增加点数、发放商品等）
- 这两个配置缺一不可，必须根据您的实际业务需求进行实现

### 基础用法

```javascript
// 在页面文件中引入SDK
const WxPaymentSDK = require('../../wxPaymentSDK/index.js');

Page({
  data: {
    userInfo: {}
  },

  // 发起支付
  async startPayment() {
    try {
      const result = await WxPaymentSDK.processPayment(this.data.userInfo);
      
      if (result.success) {
        // 支付成功 - 在这里处理成功后的业务逻辑
        this.handlePaymentSuccess(result);
      } else if (result.cancelled) {
        // 用户取消支付
        wx.showToast({
          title: '支付已取消',
          icon: 'none'
        });
      } else {
        // 支付失败
        wx.showToast({
          title: result.message || '支付失败',
          icon: 'none'
        });
      }
    } catch (error) {
      console.error('支付异常:', error);
      wx.showToast({
        title: '支付异常',
        icon: 'none'
      });
    }
  },

  // 处理支付成功后的业务逻辑
  handlePaymentSuccess(paymentResult) {
    console.log('支付成功，订单号:', paymentResult.orderNo);
    
    // 📝 在这里添加您的业务逻辑：
    // 1. 更新用户会员状态
    // 2. 发放虚拟商品
    // 3. 记录购买历史
    // 4. 发送成功通知
    // 5. 跳转到成功页面等
    
    wx.showToast({
      title: '支付成功',
      icon: 'success'
    });
    
    // 示例：跳转到成功页面
    wx.navigateTo({
      url: `/pages/success/success?orderNo=${paymentResult.orderNo}`
    });
  }
});
```

### 高级用法

```javascript
// 自定义支付参数
const customOptions = {
  amount: 100,        // 支付金额（分）
  description: '商品购买',
  attach: 'custom_data'
};

const result = await WxPaymentSDK.processPayment(this.data.userInfo, customOptions);
```

## 业务逻辑处理指南

> 🔔 **重要**：以下内容与上述"必需的业务逻辑配置"相对应，请确保已完成配置1和配置2的修改！

### 1. 客户端支付成功处理

当支付成功后，在客户端的 `handlePaymentSuccess` 方法中处理：

```javascript
handlePaymentSuccess(paymentResult) {
  const { orderNo, transactionId } = paymentResult;
  
  // 🎯 核心业务逻辑处理
  switch (this.data.productType) {
    case 'vip':
      this.upgradeUserToVip(orderNo);
      break;
    case 'course':
      this.unlockCourse(orderNo);
      break;
    case 'goods':
      this.addToInventory(orderNo);
      break;
  }
  
  // 记录用户购买历史
  this.recordPurchaseHistory(orderNo);
  
  // 显示成功页面
  this.showSuccessPage(orderNo);
}
```

### 2. 服务端回调处理

在 `cloudfunctions/paymentNotify/index.js` 中，找到 `processPaymentSuccess` 函数：

```javascript
async function processPaymentSuccess(paymentData) {
  try {
    const { out_trade_no, transaction_id, success_time, amount, payer } = paymentData;
    
    // 1. 查询订单
    const orderQuery = await db.collection('orders').where({ out_trade_no }).get();
    const order = orderQuery.data[0];
    
    // 2. 检查是否已处理（幂等性）
    if (order.status === 'PAID') {
      return { success: true, message: '订单已处理' };
    }
    
    // 3. 更新订单状态
    await db.collection('orders').doc(order._id).update({
      data: {
        status: 'PAID',
        transaction_id,
        success_time,
        paid_amount: amount.total,
        payer_openid: payer.openid,
        updated_at: new Date()
      }
    });
    
    // 🎯 在这里添加您的业务逻辑：
    await handleYourBusinessLogic(order, paymentData);
    
    return { success: true };
  } catch (error) {
    console.error('处理支付回调异常:', error);
    return { success: false, message: error.message };
  }
}

// 📝 您的业务逻辑处理函数
async function handleYourBusinessLogic(order, paymentData) {
  // 根据您的业务需求添加逻辑：
  
  // 会员升级示例
  if (order.productType === 'vip') {
    await db.collection('users').doc(order.userId).update({
      data: {
        vipStatus: true,
        vipExpireTime: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        updateTime: new Date()
      }
    });
  }
  
  // 虚拟商品发放示例
  if (order.productType === 'virtual') {
    await db.collection('user_items').add({
      data: {
        userId: order.userId,
        itemId: order.productId,
        orderId: paymentData.out_trade_no,
        createTime: new Date()
      }
    });
  }
  
  // 课程解锁示例
  if (order.productType === 'course') {
    await db.collection('user_courses').add({
      data: {
        userId: order.userId,
        courseId: order.productId,
        orderId: paymentData.out_trade_no,
        unlockTime: new Date()
      }
    });
  }
}
```

### 3. 业务逻辑处理要点

- **幂等性处理**：SDK已处理订单重复回调，您的业务逻辑也应该支持重复执行
- **错误处理**：业务逻辑异常不应影响订单状态更新
- **异步处理**：复杂业务逻辑建议异步处理，避免回调超时

## API文档

### WxPaymentSDK.processPayment(userInfo, options)

发起完整的支付流程

**参数:**
- `userInfo` (Object): 用户信息对象，必须包含 `nickName`
- `options` (Object, 可选): 支付选项
  - `amount` (Number): 支付金额（分），默认1
  - `description` (String): 商品描述
  - `attach` (String): 附加数据

**返回值:**
```javascript
{
  success: true/false,
  message: '支付结果描述',
  orderNo: '订单号',
  transactionId: '微信支付交易号',
  cancelled: true/false  // 是否用户取消
}
```

## 配置参数获取

- **appId**: 微信公众平台 → 开发 → 开发管理 → 开发设置 → AppID
- **mchId**: 微信商户平台 → 账户中心 → 商户信息 → 商户号
- **apiKey**: 微信商户平台 → 账户中心 → API安全 → APIv3密钥
- **serialNo**: 微信商户平台 → 账户中心 → API安全 → 证书序列号
- **privateKey**: 微信商户平台 → 账户中心 → API安全 → 申请证书 → 下载证书 → 私钥内容

## 常见问题

### Q: 支付成功但业务逻辑没有执行？

**A**: 检查以下几点：
1. paymentNotify云函数是否正常接收回调
2. 业务逻辑代码是否有异常
3. 数据库操作权限是否正确
4. 查看云函数日志排查具体错误

### Q: 如何处理支付成功但业务逻辑失败的情况？

**A**: 建议的处理方式：
1. 支付状态和业务逻辑分离处理
2. 业务逻辑失败不影响支付状态
3. 记录失败日志，建立重试机制
4. 提供手动补偿机制

### Q: 如何避免重复处理同一笔订单？

**A**: 实现幂等性处理：
1. 在业务逻辑处理前检查处理记录
2. 使用订单号作为唯一标识
3. 处理完成后记录处理状态

## 安全建议

1. **保护敏感信息**
   - 不要将配置信息提交到公开仓库
   - 定期更换API密钥和证书

2. **业务逻辑安全**
   - 在服务端进行关键业务逻辑处理
   - 客户端处理仅用于UI展示
   - 实现幂等性避免重复处理

3. **监控和日志**
   - 记录详细的支付和业务处理日志
   - 监控异常支付行为
   - 建立告警机制

## 许可证

MIT License 