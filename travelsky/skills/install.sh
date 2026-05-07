#!/bin/sh
set -eu

skills="merge-sapphire update-sapphire-baseline"

usage() {
  cat <<'EOF'
用法：
  sh travelsky/skills/install.sh [目标项目目录]

说明：
  单文件安装器：不需要 Bun、Node.js、pnpm，也不依赖额外 skill 文件。
  安装时会询问使用的工具/编辑器，并把 skills 写入目标项目内的本地目录。
  不会写入任何用户全局目录。

示例：
  sh travelsky/skills/install.sh
  sh travelsky/skills/install.sh /path/to/project
EOF
}

fail() {
  printf '安装失败：%s\n' "$1" >&2
  exit 1
}

default_target() {
  if command -v git >/dev/null 2>&1; then
    git rev-parse --show-toplevel 2>/dev/null && return 0
  fi
  pwd
}

write_merge() {
  file=$1
  cat > "$file" <<'MERGE_SAPPHIRE_SKILL'
---
name: merge-sapphire
description: Merge local dev into dev-sapphire for the Sapphire/TravelSky OpenCode fork, resolving conflicts with travelsky/changes-baseline.md and travelsky/baseline-checklists/*.md, preserving secondary-development behavior, preferring dev bun.lock, and verifying CLI and desktop safety.
---

# Merge Sapphire

Use this skill when merging source branch `dev` into the secondary-development branch `dev-sapphire` after upstream source code has already been synced into local `dev`.

## Hard Rules

- Source branch: `dev`.
- Target branch: `dev-sapphire`.
- On `dev-sapphire`, `git merge dev` means `ours` is `dev-sapphire` and `theirs` is `dev`.
- Read `travelsky/changes-baseline.md` before resolving any business conflict.
- Read every `travelsky/baseline-checklists/*.md` file if the directory exists.
- Do not edit `travelsky/changes-baseline.md` or checklist files during a merge unless the user explicitly asks.
- Resolve `bun.lock` conflicts with the source branch version from `dev` (`theirs`).
- Do not resolve business-code conflicts by whole-file overwrite unless the file is generated or both sides are mechanically equivalent.
- Preserve Sapphire/TravelSky behavior first, then integrate upstream changes around it.
- Keep CLI and desktop behavior stable. If either side is touched, verify that side explicitly.

## Start

Read context:

```bash
sed -n '1,220p' AGENTS.md
sed -n '1,260p' travelsky/changes-baseline.md
find travelsky -path 'travelsky/baseline-checklists/*.md' -type f -print
```

Inspect state:

```bash
git status --short
git branch --show-current
git rev-parse --verify dev
git rev-parse --verify dev-sapphire
```

If the worktree has user changes, inspect them before merging. Do not reset, checkout, clean, or stash user work without explicit user approval. Continue only when dirty files are unrelated or the user has approved the handling.

Create a mental pre-merge baseline from:

- files listed in `travelsky/changes-baseline.md`;
- files listed in `travelsky/baseline-checklists/*.md`;
- current tests that protect those files.

## Merge

```bash
git switch dev-sapphire
git merge dev
```

If the merge completes without conflicts, still run the protection checklist. Clean merges can still break Sapphire behavior.

## Conflict Workflow

List conflicts:

```bash
git diff --name-only --diff-filter=U
git status --short
```

For each conflict, inspect all useful views:

```bash
git diff --ours -- path/to/file
git diff --theirs -- path/to/file
git show :1:path/to/file
git show :2:path/to/file
git show :3:path/to/file
```

Resolve by class:

- `bun.lock`: accept stage 3 (`dev`) and stage the file.
- Baseline/checklist files: preserve every documented invariant and verification point.
- CLI login/provider/model files: preserve local token storage, expiry semantics, Bearer header injection, TravelSky-only provider behavior, and `ensureLogin` before `tui(...)`.
- Metric files: preserve run-loop completion timing, same-origin Tempo host/cookie reuse, timeout tolerance, and `token`/`tool`/`file_change`/`answer_code` separation.
- Tests: preserve or update tests so each baseline/checklist invariant remains guarded.
- Desktop files: prefer upstream unless a compatibility change is required by a preserved Sapphire behavior. Do not add new desktop-specific Sapphire behavior unless already documented.
- Generated SDK files: resolve the source file first, then regenerate with `./packages/sdk/js/script/build.ts` when OpenAPI or SDK source changed.

After each group, stage only resolved files and recheck:

```bash
git diff --name-only --diff-filter=U
```

Stop and reassess before continuing if upstream substantially rewrote authentication, provider discovery, TUI startup, session lifecycle, snapshot diffing, or Tempo reporting. These areas are behavior-critical and need semantic integration, not marker cleanup.

## Required Audit

Before calling the merge complete, build a short audit note for yourself and verify:

- every file in `travelsky/changes-baseline.md` that exists in the repo still satisfies its conflict strategy;
- every checklist item in `travelsky/baseline-checklists/*.md` is preserved or has an explicit reason it no longer applies;
- `bun.lock` came from `dev` if it conflicted;
- no conflict markers remain;
- no baseline/checklist file was changed accidentally;
- CLI touched files have focused tests or typecheck coverage;
- desktop touched files have the nearest available package verification.

Commands:

```bash
rg -n '<<<<<<<|=======|>>>>>>>' .
git diff --check
```

## Verification

Run from package directories, never from repo root.

Always run:

```bash
cd packages/opencode && bun typecheck
```

Run focused Sapphire tests when present:

```bash
cd packages/opencode && bun test \
  test/cli/tui/thread.test.ts \
  test/cli/travelsky-auth-store.test.ts \
  test/cli/travelsky-login.test.ts \
  test/cli/travelsky-bootstrap.test.ts \
  test/server/tempo-metric.test.ts \
  test/session/metric.test.ts
```

If `packages/app`, `packages/desktop`, or `packages/desktop-electron` changed, inspect that package's `package.json` and run the nearest typecheck/test command.

## Final Response

Report:

- `dev` merged into `dev-sapphire`;
- conflicts resolved by area;
- how `bun.lock` was handled;
- baseline/checklist invariants preserved;
- CLI and desktop files touched;
- verification commands and results;
- any unresolved risk or skipped verification.
MERGE_SAPPHIRE_SKILL
}

write_update() {
  file=$1
  cat > "$file" <<'UPDATE_SAPPHIRE_BASELINE_SKILL'
---
name: update-sapphire-baseline
description: 在 Sapphire/TravelSky 二次开发需求实现并验证后，默认基于明确 commit range，或兼容未提交 diff，更新中文合并保护文档 travelsky/changes-baseline.md 与 travelsky/baseline-checklists/*.md。
---

# Update Sapphire Baseline

在 Sapphire/TravelSky 二次开发需求已经实现并完成验证后使用本 skill。它的目标是把一个完成的需求沉淀为未来 `dev -> dev-sapphire` 合并时可执行、可核对的中文保护基线。

## 硬性规则

- `travelsky/changes-baseline.md` 和 `travelsky/baseline-checklists/*.md` 的正文必须使用中文。文件名可以继续使用英文 kebab-case，保证路径稳定。
- 默认使用已提交范围：优先让用户提供或确认 `<base>..<head>` commit range，或一组明确属于本需求的 commit。
- 仅当需求已经完成但尚未提交时，才使用未提交 diff 模式；此时同时读取 staged 与 unstaged diff。
- 如果没有未提交 diff，也没有明确 commit range，不要猜测。先列出候选提交，让用户确认本次需求范围。
- 本 skill 只更新基线文档。除非用户明确要求，不修改产品代码。
- 只有未来合并必须保护的文件，才写入 `travelsky/changes-baseline.md`。
- 每个完成需求或紧密相关的行为组，在 `travelsky/baseline-checklists/` 下新增或更新一个 checklist。
- 不要把需求专属知识写进 `.agents/skills/merge-sapphire/SKILL.md`。只有通用合并流程变化时，才修改 merge skill。
- 不要把纯格式化、纯生成文件、纯依赖更新、无关重构记录成业务保护行为。

## 输入模式

### 已提交范围模式

默认使用这个模式。用户需要提供或确认本次需求对应的 commit range。

常用命令：

```bash
git log --oneline --decorate -n 20 dev-sapphire
git diff --stat <base>..<head>
git diff --name-status <base>..<head>
git diff <base>..<head> -- path/to/file
```

如果用户只说“最近一个需求”但没有给出范围，先列出最近提交，并询问哪个 commit 或 range 属于本次需求。

### 未提交 diff 模式

仅在需求完成但还没有提交时使用。

常用命令：

```bash
git status --short
git diff --stat
git diff --cached --stat
git diff --name-status
git diff --cached --name-status
```

把 staged 和 unstaged diff 一起作为输入范围。如果 worktree 混有无关改动，先让用户拆分或确认哪些文件属于本次需求。

## 开始步骤

读取上下文：

```bash
sed -n '1,220p' AGENTS.md
sed -n '1,260p' travelsky/changes-baseline.md
find travelsky -path 'travelsky/baseline-checklists/*.md' -type f -print | sort
git status --short
```

需要和上游比较时，使用 `dev` 或 `origin/dev`；不要假设本地存在 `main`。

## 准确性流程

### 1. 锁定范围

写任何文档前，先明确说明本次输入范围：

- commit range；或
- 未提交 staged/unstaged diff；或
- 用户在混合 worktree 中确认过的文件列表。

如果范围不清楚，停止并询问用户。

### 2. 提取候选文件

读取真实 diff，并把变更文件分组：

- 业务行为文件；
- 保护该行为的测试；
- 文档或设计说明；
- 生成文件；
- 机械性或无关文件。

通常只有前三类会影响基线文档。生成文件只有在其生成结果本身会影响未来合并时才记录。

### 3. 推导保护行为

对每个候选行为，明确：

- 未来合并时必须保留的用户可见行为或集成行为；
- 实现该行为的准确文件；
- 不能漂移的 API URL、字段、顺序、过滤、时机、持久化、权限或数据结构；
- 能证明该行为保留的测试或人工检查。

如果某个行为无法回溯到代码或验证方式，不要把它写成保护不变量。应说明有意排除，或询问用户。

### 4. 交叉核对已有基线

将候选更新与这些内容核对：

- `travelsky/changes-baseline.md` 已有行；
- 已有 `travelsky/baseline-checklists/*.md`；
- 这些文档中提到的现有测试。

如果新需求改变了已有保护行为，更新现有条目。只有出现新的持久行为组时，才新增 checklist。

## Checklist 粒度

一个 checklist 对应一个持久行为，不是一个文件。

合适的粒度：

- CLI 登录门禁
- TravelSky provider 过滤
- Tempo metric 上报
- Session metric 聚合
- 未来具体功能名

不合适的粒度：

- “杂项修改”
- 对不可分割的行为按每个小 helper 文件拆分
- 把登录、metric、UI 等无关规则混在一个 checklist

文件命名：

```text
travelsky/baseline-checklists/<short-kebab-scope>.md
```

## 更新 changes-baseline.md

对每个需要保护的文件，新增或修订一行中文表格记录：

- 文件路径；
- 类型：新增、修改、生成、文档；
- 改动目的；
- 关键改动点；
- 冲突保留策略。

每一行只记录未来合并决策需要的信息，不要复制完整 checklist 内容。

## Checklist 格式

每个 checklist 必须使用中文，并采用这个结构：

```markdown
# <功能名>合并保护清单

## 保护目标

用一到两句话说明未来合并时必须保留的行为。

## 输入范围

- 来源：`<base>..<head>` 或“未提交 staged/unstaged diff”。
- 相关提交：如适用，列出 commit hash 和标题。

## 保护文件

- `path/to/file.ts`：说明该文件为什么影响这个行为。

## 不变量

- 必须保持为真的具体行为。
- URL、字段、顺序、过滤、时机、持久化、权限、数据结构等不能漂移的规则。

## 冲突处理规则

- 这个功能区域遇到冲突时怎么解。
- 哪一侧通常优先，哪些地方必须语义合并。

## 验证方式

- 能证明行为保留的精确测试、typecheck 或人工检查。

## 停止条件

- 遇到哪些上游变化时不能机械解冲突，必须停下来分析。
```

## 质量门槛

完成前必须确认：

- 每个保护行为至少有一个不变量；
- 每个不变量都有实际验证方式，或明确说明只能人工验证；
- checklist 与 `changes-baseline.md` 的文件路径和行为描述一致；
- 每个新增基线条目都能回溯到已锁定输入范围；
- 没有把无关文件加入基线；
- 没有把纯生成文件或 vendor 变更记录成业务行为；
- `merge-sapphire` 可以只读 checklist 就执行未来合并，不需要回看原始需求讨论。

## 最终回复

用中文报告：

- 使用的输入范围；
- checklist 文件新增或更新情况；
- `changes-baseline.md` 行新增或更新情况；
- 哪些需求行为已被未来合并保护；
- 哪些改动没有写入 baseline，以及原因；
- 准确性校验依据。
UPDATE_SAPPHIRE_BASELINE_SKILL
}

write_skill() {
  dest_root=$1
  skill=$2
  dir="$dest_root/$skill"
  file="$dir/SKILL.md"

  mkdir -p "$dir"
  case "$skill" in
    merge-sapphire)
      write_merge "$file"
      ;;
    update-sapphire-baseline)
      write_update "$file"
      ;;
    *)
      fail "未知 skill：$skill"
      ;;
  esac
  printf '已安装：%s\n' "$dir"
}

install_skills() {
  dest_root=$1
  mkdir -p "$dest_root"
  for skill in $skills; do
    write_skill "$dest_root" "$skill"
  done
}

choose() {
  cat >&2 <<'EOF'
请选择你使用的工具/编辑器：
  1) opencode（项目级 .agents/skills）
  2) Codex（项目级 .agents/skills）
  3) Claude Code（项目级 .claude/skills）
  4) Cursor（项目级 .cursor/skills）
  5) 不确定/团队共享推荐（项目级 .agents/skills）
  6) 全部安装到项目内（.agents + .claude + .cursor）
EOF
  printf '请输入序号 [默认 5]: ' >&2
  read ans
  printf '%s\n' "${ans:-5}"
}

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
esac

target="${1:-$(default_target)}"
[ -d "$target" ] || fail "目标项目目录不存在：$target"

target=$(CDPATH= cd -- "$target" && pwd)
printf '目标项目：%s\n\n' "$target"

choice=$(choose)

case "$choice" in
  1|2|5)
    install_skills "$target/.agents/skills"
    ;;
  3)
    install_skills "$target/.claude/skills"
    ;;
  4)
    install_skills "$target/.cursor/skills"
    ;;
  6)
    install_skills "$target/.agents/skills"
    install_skills "$target/.claude/skills"
    install_skills "$target/.cursor/skills"
    ;;
  *)
    fail "未知选项：$choice"
    ;;
esac

cat <<'EOF'

安装完成。
如果当前工具已经打开，请重启会话或重新加载项目，让工具重新发现新安装的 skill。
EOF
