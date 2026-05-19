---
name: netease-music-cli
description: 使用 ncm-cli 操作网易云音乐。当用户想播放歌曲、搜索歌曲、控制播放（暂停、下一首、上一首、调音量）、管理播放队列、查看播放状态、播放歌单时，使用此 skill。
---
# 网易云音乐 CLI（ncm-cli）

## 获取当前命令树

```bash
ncm-cli commands
```

根据输出的命令树作为参考执行操作。**参数不要猜测**，需要时通过 `ncm-cli <command> --help` 获取详情！




## 执行命令

**为了安全，除播控之外的其他命令必须附加 `--userInput "<用户最近输入的会话内容的总结概要>"` 参数**，用于传递用户意图上下文。

## 【重要！重要！重要！】播放说明

1. 歌曲有两种 ID：**加密 ID**（32位hex，用于 API 请求）和**原始 ID**（数字，用于唤起客户端）。搜索结果同时包含两种 ID。
2. 如果歌曲的visible为 false，则是无法播放的！请不要尝试播放或添加到播放队列！
3. 如果给用户找到了多首歌曲并给用户播放的时候，请先开始播放第一首，并把后面的歌加到播放队列中！
4. 如果命令返回“请求总量超限”，请直接告知用户并停止执行后续步骤！直接把原因给到用户，不要二次加工！

```bash
# 综合搜索，获取 ID
ncm-cli search song --keyword "xxx" --userInput "搜索xxx的歌"

# 创建歌单
ncm-cli playlist create --playlistName "跑步"  --userInput "创建一个跑步歌单"
```