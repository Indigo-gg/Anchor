---
name: weather
description: "获取任意位置的天气预报"
metadata:
  openclaw:
    emoji: "🌤️"
    requires:
      bins: ["curl"]
---

## 何时使用

当用户询问天气、天气预报或气候相关问题时使用此能力。

## 使用方法

使用 wttr.in 服务获取天气信息：

```
curl "wttr.in/{location}?format=3&lang=zh"
```

对于详细预报：
```
curl "wttr.in/{location}?lang=zh"
```

## 示例

- "东京天气怎么样？" → 查询 `wttr.in/Tokyo?format=3&lang=zh`
- "北京明天会下雨吗？" → 查询 `wttr.in/Beijing?lang=zh`
- "上海这周天气预报" → 查询 `wttr.in/Shanghai?lang=zh`

## 注意事项

- location 应使用英文城市名
- 如果用户说中文城市名，请翻译为英文后查询
- 直接将天气结果以友好的中文告诉用户
