# LLM 接口影响分析报告

> 由 Agent 在 Step 2 分析后更新 `temp/apifox-sync-plan.json` 与 `temp/apifox-sync-plan.md`

## 分析概要

- **分析时间**: {timestamp}
- **变更文件数**: {changedFileCount}
- **scan 候选接口数**: {scanCandidateCount}
- **LLM 确认受影响接口数**: {confirmedCount}
- **排除接口数**: {excludedCount}
- **补充遗漏数**: {addedCount}

## 变更源分析

### {ChangeSourceClassName}

**变更类型**: 字段新增 / 字段删除 / 字段修改 / 方法变更

**变更详情**:
```
{git diff 摘要或字段列表}
```

**业务含义**: {简要说明变更的业务影响}

#### 确认受影响接口

| 方法 | 路径 | 影响类型 | 影响字段 | 分析依据 |
|------|------|----------|----------|----------|
| GET | /api/xxx | response | fieldA, fieldB | PitCommonParam 含同名字段且通过 copyProperties 进入响应 |

#### 排除的接口

| 方法 | 路径 | 排除原因 |
|------|------|----------|
| GET | /api/yyy | 仅日志注释变更，不影响接口契约 |

#### 补充的遗漏

| 方法 | 路径 | 影响类型 | 分析依据 |
|------|------|----------|----------|
| POST | /api/zzz | request_body | 直接修改了 RequestBody DTO 字段 |

---

## 同步建议

### 需要同步的接口

```
GET /api/xxx
POST /api/yyy
```

### 无需同步

- 纯内部 Service/Repository 变更，未影响任何 Controller 接口
- LLM 分析后确认不影响 API 契约的变更

### 同步命令

用户确认后更新 `apifox-sync-plan.json` 为 `confirmed`（含 `targetBranch`，默认主分支 `main`），再执行：

```bash
node dist/index.js sync --sync-mode incremental
```
