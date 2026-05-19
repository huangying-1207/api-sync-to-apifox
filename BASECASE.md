# Basecase 管理

## 问题记录

### BusinessProjectIndex 误报问题

**问题描述**: 在类型转换追踪过程中，当方法返回类型是 void 但调用了返回值的方法时，会产生误报。

**解决方案**: 优化 `traceTypeConversionAffected` 方法，在追踪过程中检查每个调用者方法是否真正传递了类型转换结果。

**追踪条件**:
- 调用者返回类型不是 void（可能返回了类型转换结果）
- 调用者有参数类型是受影响的 DTO（可能修改了引用参数）

**优化文件**: `src/core/scanner/DependencyGraph.ts`

**测试覆盖**: 已通过 Scanner 相关测试验证

### 复杂注解导致方法名提取失败

**问题描述**: 当 Spring Boot 控制器方法上有多个复杂注解（如包含嵌套注解的 @LogRecord 或多行注解）时，原有的方法名提取正则表达式无法正确处理这些复杂注解结构，导致方法名提取失败（返回 null），最终该方法被方法级依赖过滤逻辑过滤掉。

**解决方案**:
1. 优化方法名提取正则表达式，支持跳过任意复杂的注解（包括嵌套注解和多行注解）：
   ```typescript
   let methodNameMatch = methodContent.match(/(?:@[\s\S]*?)\b(?:public|private|protected)\s+\S+\s+(\w+)\s*\(/);
   ```
2. 添加备用方法名提取策略：从 @PostMapping/@GetMapping 等注解中提取 URL 路径作为方法名（符合 Spring Boot 约定）
3. 处理路径到方法名的转换（如将 "save-drama-project" 转换为 "saveDramaProject"）

**优化文件**: `src/core/scanner/ApiScanner.ts`

**测试覆盖**: 已通过实际项目扫描验证，现在能正确识别带有复杂注解的方法，如 saveDramaProject

### 间接类型转换追踪问题

**问题描述**: 当一个 DTO 通过 BeanUtils.copyProperties 等方法将属性复制到另一个对象，然后该对象被转换为 JSON 并返回时，类型转换追踪逻辑无法正确地追踪到这种间接影响，导致受影响的接口没有被记录到变更影响报告中。

**解决方案**:
1. 优化 `analyzeTypeConversionFlow` 方法，增强对间接流向返回值情况的识别能力
2. 优化 `buildEmbeddedClosure` 方法，添加双向传播和方法返回类型检查功能
3. 优化 `traceCallsForDto` 方法，去掉递归追踪条件中对 .data() 调用的要求

**优化文件**: `src/core/scanner/DependencyGraph.ts`

**测试覆盖**: 已通过实际项目扫描验证，现在能正确追踪到通过 I18n 服务间接调用的接口
