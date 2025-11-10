/**
 * # 微信小程序中加载 Lottie 动画的正确方法
 * 
 * > 创建时间：2024-03-14  
 * > 更新时间：2024-03-18
 * > 相关文件：utils/animations.js, pages/index/index.js, pages/index/index.wxml
 * 
 * ## 重要提示
 * 
 * **在微信小程序中使用Lottie动画的关键点：**
 * 
 * 1. **不能通过文件路径加载动画文件**，例如：
 *    ```javascript
 *    // ❌ 错误方式 - 这在小程序中无法工作！
 *    lottie.loadAnimation({
 *      path: '../../animations/my-animation.json',
 *      ...
 *    });
 *    ```
 * 
 * 2. **必须直接使用JSON数据**：
 *    - 必须将完整的Lottie JSON数据导入到JS文件中
 *    - 通过JS对象传递给Lottie，而不是通过路径引用
 *
 * ## 标准实现流程
 * 
 * 为了在微信小程序中正确加载和显示 Lottie 动画，我们采用以下标准化方法：
 * 
 * ### 1. 创建动画数据管理文件
 * 
 * 在 utils/animations.js 中集中管理所有动画数据：
 */

// utils/animations.js 示例
/**
 * 动画数据管理文件
 * 集中存放所有 Lottie 动画数据
 */

// 着装上传动画
const attireUploadingAnimation = {
  "v": "5.6.8",
  // ... 完整的动画数据
};

// 这里可以添加更多的动画数据
// const otherAnimation = { ... };

// 导出所有动画
module.exports = {
  attireUploading: attireUploadingAnimation,
  // 可以添加更多动画
};

/**
 * ### 2. WXML 中添加 Canvas 元素
 * 
 * ```xml
 * <canvas 
 *   type="2d" 
 *   id="lottie-canvas" 
 *   class="lottie-canvas">
 * </canvas>
 * ```
 * 
 * ### 3. WXSS 中设置样式
 * 
 * ```css
 * .lottie-canvas {
 *   width: 300px;
 *   height: 300px;
 *   margin-bottom: 20px;
 * }
 * ```
 * 
 * ### 4. 在页面 JS 中初始化动画
 */

// pages/index/index.js 示例代码
// 引入 lottie
const lottie = require('lottie-miniprogram');
// 引入动画数据
const animations = require('../../utils/animations.js');

// 初始化 Lottie 动画
function initLottieAnimation() {
  wx.createSelectorQuery()
    .select('#lottie-canvas')
    .node()
    .exec((res) => {
      if (!res[0] || !res[0].node) {
        console.error('找不到 canvas 节点');
        return;
      }

      const canvas = res[0].node;
      const context = canvas.getContext('2d');
      
      // 设置高清屏幕适配
      const dpr = wx.getSystemInfoSync().pixelRatio;
      canvas.width = 300 * dpr;
      canvas.height = 300 * dpr;

      // 初始化 lottie
      lottie.setup(canvas);
      
      // ✅ 正确方式：直接使用从animations.js导入的JSON数据
      const lottieInstance = lottie.loadAnimation({
        animationData: animations.attireUploading,  // 直接使用JSON对象
        loop: true,
        autoplay: true,
        rendererSettings: {
          context
        }
      });

      // ❌ 错误方式 - 不要尝试通过文件路径加载
      // const lottieInstance = lottie.loadAnimation({
      //   path: '../../animations/animation.json', // 这在小程序中不起作用！
      //   loop: true,
      //   autoplay: true,
      //   rendererSettings: {
      //     context
      //   }
      // });

      // 保存实例
      this.setData({ lottieInstance });
    });
}

/**
 * ### 5. 管理动画生命周期
 */

// 在页面加载时初始化动画
function onLoad() {
  // 其他初始化代码...
  this.initLottieAnimation();
}

// 停止动画
function stopAnimation() {
  if (this.data.lottieInstance) {
    this.data.lottieInstance.stop();
  }
}

// 销毁动画实例
function onUnload() {
  if (this.data.lottieInstance) {
    this.data.lottieInstance.destroy();
  }
}

/**
 * ## 优势与最佳实践
 * 
 * 1. **动画数据集中管理**
 *    - 所有动画数据存放在一个文件中
 *    - 方便复用、维护和更新
 *    - 代码结构更清晰
 * 
 * 2. **直接使用JSON数据的重要性**
 *    - 微信小程序环境无法通过路径加载外部JSON文件
 *    - 必须将动画数据作为JS对象直接导入
 *    - 这是小程序中Lottie能正常工作的关键
 * 
 * 3. **Canvas 配置要点**
 *    - 使用 `type="2d"` 属性
 *    - 设置高 DPR 适配，避免模糊
 *    - 合理设置尺寸
 * 
 * 4. **性能注意事项**
 *    - 在不需要显示时停止动画
 *    - 页面卸载时销毁实例
 *    - 合理控制动画复杂度和尺寸
 *    - 考虑复杂动画的文件大小对小程序包体积的影响
 * 
 * 5. **从Lottie文件到代码的转换流程**
 *    1. 从LottieFiles或Adobe After Effects导出.json动画文件
 *    2. 复制JSON内容并粘贴到animations.js的对象中
 *    3. 不要尝试通过路径引用文件，始终使用直接的JSON数据引用
 * 
 * ## 安装与准备
 * 
 * - 安装: npm install lottie-miniprogram
 * - 构建: 开发者工具中点击"构建 npm"
 * - 设置: 在"详情"中勾选"使用 npm 模块"
 * 
 * ## 常见问题排查
 * 
 * - **动画不显示**：检查是否正确使用了animationData而非path
 * - **Canvas未找到**：确保Canvas已渲染完成再初始化Lottie
 * - **内存占用过大**：优化动画JSON大小，减少不必要的图层和效果
 * 
 * ## 参考信息
 * 
 * - 官方文档: https://www.npmjs.com/package/lottie-miniprogram
 * - 动画制作: https://lottiefiles.com/
 * - 微信小程序 Canvas 2D: https://developers.weixin.qq.com/miniprogram/dev/component/canvas.html
 */

// 此文件仅作为文档使用，不实际执行 