# Pull Request 指南

本文介绍通过 Pull Request 贡献代码的完整流程。

## 分支策略

| 分支 | 用途 |
|------|------|
| `main` | 稳定的生产版本 |
| `develop` | 集成分支 — **所有 PR 都合并到这里** |
| `feat/*` | 新功能 |
| `fix/*` | Bug 修复 |
| `chore/*` | 工具链、依赖、重构 |
| `docs/*` | 仅文档变更 |

## 操作流程

### 1. 同步本地 develop

创建分支前，先确保本地 `develop` 是最新的：

```bash
git checkout develop
git pull origin develop
```

### 2. 创建功能分支

从 `develop` 拉出新分支：

```bash
git checkout -b feat/你的功能名
# 或者
git checkout -b fix/问题描述
```

分支名使用小写加连字符。示例：
- `feat/telegram-channel`
- `fix/scheduler-stuck-detection`
- `chore/upgrade-hono`

### 3. 开发并提交

在你的分支上开发，按 [Conventional Commits](https://www.conventionalcommits.org/) 规范提交：

```bash
git add .
git commit -m "feat(scheduler): add backoff for stuck tasks"
```

常用类型：`feat`、`fix`、`chore`、`docs`、`refactor`、`test`。

### 4. 推送分支

```bash
git push origin feat/你的功能名
```

### 5. 创建 Pull Request

打开 GitHub 仓库页面，会看到提示横幅，点击 **Compare & pull request**。

**关键设置：**
- **目标分支**：选 `develop`（不是 `main`）
- **标题**：同样遵循 Conventional Commits 风格，例如 `feat(agent): add skill hot reload`
- **描述**：按下方模板填写

### 6. 等待 CI 检查

PR 提交后会自动运行：
- `bun typecheck` — TypeScript 类型检查
- `bun test` — 单元测试

所有检查通过后才能合并。如有失败，在你的分支上修复后重新推送即可。

### 7. 请人 Review

至少指定一名 Reviewer。有反馈时直接推送新提交来修改，**Review 开始后不要 force push**。

### 8. 合并

审批通过且 CI 绿色后，使用 **Squash and merge**，保持 `develop` 历史整洁。

---

## PR 描述模板

```markdown
## What（做了什么）

简述本次 PR 的改动内容。

## Why（为什么）

为什么需要这个改动？如有关联 Issue 请附上链接。

## How（怎么做的）

关键的实现决策（如果不是一目了然的话）。

## Testing（如何验证）

你是怎么确认改动有效的？
- [ ] 手动测试：描述步骤
- [ ] 单元测试已添加/更新
```

---

## 实用建议

- **一个 PR 只做一件事。** 保持 PR 聚焦，更容易 Review，也更容易回滚。
- **可以先开 Draft PR。** 早点开 Draft 可以获得早期反馈，也能提前触发 CI。
- **Review 前先 Rebase。** 如果 `develop` 已经有新提交，先 rebase：`git rebase origin/develop`。
- **自我 Review。** 请人看之前先自己看一遍 diff，把明显问题先解决掉。
- **关联 Issue。** 在 PR 描述里用 `Closes #123`，合并后会自动关闭对应 Issue。
