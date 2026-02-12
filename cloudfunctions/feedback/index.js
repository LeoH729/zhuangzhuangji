// 云函数：提交用户反馈
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { action, type, content, email } = event;

  // 提交反馈
  if (action === 'submit') {
    try {
      // 获取用户openid
      const wxContext = cloud.getWXContext();
      const openid = wxContext.OPENID;

      // 验证必填字段
      if (!content || content.trim() === '') {
        return { success: false, message: '反馈内容不能为空' };
      }

      // 构建反馈数据
      const feedbackData = {
        type: type || '其他',
        content: content.trim(),
        email: email || '',
        openid: openid,
        createTime: new Date()
      };

      // 插入数据库
      const result = await db.collection('feedbacks').add({
        data: feedbackData
      });

      console.log('反馈提交成功:', result);
      return { success: true, message: '反馈提交成功', data: { _id: result._id } };

    } catch (error) {
      console.error('提交反馈失败:', error);
      return { success: false, message: '提交失败，请稍后重试', error: error.message };
    }
  }

  // 获取反馈列表（管理员功能）
  if (action === 'list') {
    try {
      const { limit = 20, skip = 0 } = event;
      
      // 查询数据
      const result = await db.collection('feedbacks')
        .orderBy('createTime', 'desc')
        .limit(limit)
        .skip(skip)
        .get();

      return { success: true, data: result.data };

    } catch (error) {
      console.error('获取反馈列表失败:', error);
      return { success: false, message: '获取失败', error: error.message };
    }
  }

  // 更新反馈回复（管理员功能）
  if (action === 'updateStatus') {
    try {
      const { feedbackId, reply } = event;

      if (!feedbackId) {
        return { success: false, message: '缺少必要参数' };
      }

      const updateData = {
        updateTime: new Date()
      };

      if (reply) {
        updateData.reply = reply;
      }

      const result = await db.collection('feedbacks').doc(feedbackId).update({
        data: updateData
      });

      return { success: true, message: '更新成功' };

    } catch (error) {
      console.error('更新反馈失败:', error);
      return { success: false, message: '更新失败', error: error.message };
    }
  }

  return { success: false, message: '未知操作' };
};