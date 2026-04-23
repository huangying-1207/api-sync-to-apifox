功能实现总结

  📋 核心功能

  1. 自动接口同步 - 检测后端接口的新增、删除和变更，自动同步到 Apifox
  2. 字段说明中文展示 - 自动将接口字段说明格式化为中文
  3. 增量同步模式 - 仅同步变更的接口，提高效率
  4. 全量更新功能 - 支持同步所有接口，适用于项目初始化

  🛠 技术特性

  代码解析能力

  - Spring Boot：识别 @RestController 注解的类和 @GetMapping/@PostMapping 等注解的方法
  - Node.js：识别 app.get()/app.post() 等路由定义
  - Git 变更检测：基于 git 增量同步，只处理变更过的文件

  配置管理

  - 配置文件支持：自动读取 .apifoxsync.json 配置文件
  - 命令行参数覆盖：支持命令行参数直接覆盖配置文件
  - 配置初始化：通过 config init 命令生成默认配置

  🚀 使用方法

  # 初始化配置
  apifox-sync config init

  # 扫描接口变更
  apifox-sync scan

  # 同步接口到 Apifox
  apifox-sync sync

  # 全量更新
  apifox-sync sync --sync-mode full

  📊 接口变更展示

  === 开始 Apifox 接口同步 ===
  启用增量同步模式
  发现配置文件: D:\IDEA\claude-test\.apifoxsync.json
  正在检测代码变更...
  检测到 0 个文件有变更
  正在扫描 springboot 项目接口变化: ./test-spring-boot/src/main/java/com/example
  发现 1 个 Controller 文件
  ✅ 扫描完成，发现 5 个接口
  发现接口: 5个
  接口详情:
    GET / (UserController.java)
    GET /{id} (UserController.java)
    POST / (UserController.java)
    PUT /{id} (UserController.java)
    DELETE /{id} (UserController.java)
  === 扫描完成 ===

  📝 配置文件示例

  {
    "apifox-project-id": "your-project-id",
    "apifox-api-key": "your-api-key",
    "source-type": "code",
    "source-path": "./src/main/java/com/example",
    "framework": "springboot",
    "sync-mode": "incremental"
  }

  🎯 应用场景

  1. 开发过程中：每次代码提交后自动同步变更的接口
  2. 项目初始化：使用全量同步快速创建完整的接口文档
  3. 接口维护：定期同步确保文档与实际代码一致
  4. 代码重构：重构后使用全量同步更新整个接口文档

  该技能提供了灵活的配置选项和直观的命令行接口，使得 Apifox 接口文档管理变得更加高效和自动化。
