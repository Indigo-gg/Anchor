---
name: image_gen
description: "生成图片"
metadata:
  openclaw:
    emoji: "🖼️"
    exec_mode: instant
    handler_key: image_gen
    trigger:
      keywords: ["画", "生成图片", "图片", "壁纸", "头像"]
      description: "明确要求生成图片"
---

## 功能说明

调用图片生成 API 根据用户描述生成图片。

## 参数提取

从用户消息中提取以下信息：
- prompt: 图片描述（用户的原始描述）
- imageSize: 图片尺寸

### 尺寸识别规则
- "1:1": 正方形、方形、头像、头图
- "16:9": 横屏、横版、宽屏、桌面壁纸、电脑壁纸
- "9:16": 竖屏、竖版、手机壁纸、手机屏保
- "4:3": 4:3比例
- 用户未指定尺寸时默认正方形 (1:1)
