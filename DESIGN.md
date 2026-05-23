# DESIGN.md

## 项目与用户画像
- 产品：抖音 Wiki — AI 驱动的短视频知识资产管理系统
- 用户：个人知识管理 / 创作者素材库 / 企业内容沉淀
- Phase 1 聚焦：导入 + Wiki 列表，最小可用

## 品牌与视觉方向
- 主色：深黑灰（#2C2C2C / #1A1A1A），搭配中性灰
- 风格关键词：极简、信息密度高、工具感、黑白调

## Design Tokens

### 色彩
- accent: #2C2C2C
- text-primary: #1A1A1A
- text-secondary: #8C8C8C
- surface: #FFFFFF
- surface-dim: #fcf9f8
- surface-container: #FAFAFA
- border-subtle: #EAEAEA

### 字体
- Geist 字体（Google Fonts CDN，.cn 域名）

### 布局与响应式
- 最大宽度 1200px，居中
- 导航栏固定顶部（sticky）
- Wiki 列表：1/2/3 列响应式网格
- 导入页：居中最大宽度 700px

### 交互与动效
- 页面切换：AnimatePresence + motion（opacity/scale/y 平移）
- 卡片进度条：spring 动画
- 卡片 hover：边框加深 + 阴影 + 图片放大
