# PRD: {{title}}

> 版本: {{version}} | 创建: {{created_at}} | 更新: {{updated_at}}

## 1. 概述
{{overview}}

## 2. 目标
{{#goals}}
- {{.}}
{{/goals}}

## 3. 目标用户
{{#target_users}}
- {{.}}
{{/target_users}}

## 4. 功能需求
| ID | 描述 | 优先级 |
|----|------|--------|
{{#functional_requirements}}
| {{id}} | {{description}} | {{priority}} |
{{/functional_requirements}}

## 5. 非功能需求
| ID | 描述 | 类别 |
|----|------|------|
{{#non_functional_requirements}}
| {{id}} | {{description}} | {{category}} |
{{/non_functional_requirements}}

## 6. 用户故事
{{#stories}}
### {{id}}: {{title}}
- 优先级: {{priority}} | 复杂度: {{complexity}} | 状态: {{status}}
- 描述: {{description}}
- 验收标准:
{{#acceptance_criteria}}
  - [ ] {{description}} ({{status}})
{{/acceptance_criteria}}
{{/stories}}

## 7. 架构
{{#architecture}}
### {{type}} 视图
```mermaid
{{mermaid}}
```
{{description}}
{{/architecture}}

## 8. 验收标准总表
| ID | 描述 | 可测试 | 状态 |
|----|------|--------|------|
{{#acceptance_criteria}}
| {{id}} | {{description}} | {{testable}} | {{status}} |
{{/acceptance_criteria}}

## 9. 风险
| 风险 | 概率 | 缓解方案 |
|------|------|---------|
{{#risks}}
| {{description}} | {{probability}} | {{mitigation}} |
{{/risks}}
