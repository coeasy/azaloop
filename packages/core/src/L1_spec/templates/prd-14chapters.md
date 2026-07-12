# PRD: {{title}}

> 版本: {{version}} | 创建: {{created_at}} | 更新: {{updated_at}}
> 复杂度: {{complexity}} | 产品类型: {{productType}}

---

## 第1章 项目背景

### 1.1 行业分析
{{industry_analysis}}

### 1.2 业务现状
{{business_status}}

### 1.3 痛点分析
{{#pain_points}}
- {{.}}
{{/pain_points}}

---

## 第2章 需求基本情况

### 2.1 需求来源
{{requirement_source}}

### 2.2 场景还原
{{scenario_replay}}

### 2.3 深层动机
{{deep_motivation}}

---

## 第3章 商业分析

### 3.1 市场定位
{{market_positioning}}

### 3.2 竞品分析
| 竞品 | 优势 | 劣势 | 差异化机会 |
|------|------|------|-----------|
{{#competitors}}
| {{name}} | {{advantage}} | {{disadvantage}} | {{opportunity}} |
{{/competitors}}

### 3.3 盈利模式
{{#revenue_models}}
- {{.}}
{{/revenue_models}}

---

## 第4章 项目收益目标

### 4.1 北极星指标
{{north_star_metric}}

### 4.2 量化目标
| 指标 | 基线 | 目标值 | 衡量周期 |
|------|------|--------|---------|
{{#quantified_goals}}
| {{metric}} | {{baseline}} | {{target}} | {{period}} |
{{/quantified_goals}}

### 4.3 ROI 预估
{{roi_estimation}}

---

## 第5章 项目方案概述

### 5.1 整体方案
{{overall_solution}}

### 5.2 技术选型
| 领域 | 选型 | 理由 |
|------|------|------|
{{#tech_stack}}
| {{area}} | {{choice}} | {{reason}} |
{{/tech_stack}}

### 5.3 里程碑
| 里程碑 | 内容 | 预计时间 | 交付物 |
|--------|------|---------|--------|
{{#milestones}}
| {{name}} | {{content}} | {{eta}} | {{deliverable}} |
{{/milestones}}

---

## 第6章 项目范围

### 6.1 功能边界
{{#in_scope}}
- {{.}}
{{/in_scope}}

### 6.2 非功能需求
| ID | 描述 | 类别 |
|----|------|------|
{{#non_functional_requirements}}
| {{id}} | {{description}} | {{category}} |
{{/non_functional_requirements}}

### 6.3 排除项（Out of Scope）
{{#out_of_scope}}
- {{.}}
{{/out_of_scope}}

---

## 第7章 项目风险

### 7.1 风险识别
| 风险 | 概率 | 影响 | 等级 |
|------|------|------|------|
{{#risks}}
| {{description}} | {{probability}} | {{impact}} | {{level}} |
{{/risks}}

### 7.2 风险评估
{{risk_assessment}}

### 7.3 应对方案
| 风险 | 应对策略 | 责任人 |
|------|---------|--------|
{{#risk_mitigations}}
| {{risk}} | {{strategy}} | {{owner}} |
{{/risk_mitigations}}

---

## 第8章 术语表

| 术语 | 定义 |
|------|------|
{{#glossary}}
| {{term}} | {{definition}} |
{{/glossary}}

---

## 第9章 参考文档

{{#references}}
- [{{title}}]({{url}})
{{/references}}

---

## 第10章 功能需求

### 10.1 架构图
{{#architecture}}
#### {{type}} 视图
```mermaid
{{mermaid}}
```
{{description}}
{{/architecture}}

### 10.2 ER 模型
```mermaid
erDiagram
{{er_model}}
```

### 10.3 核心流程图
```mermaid
flowchart TD
{{flowchart}}
```

### 10.4 状态机
```mermaid
stateDiagram-v2
{{state_machine}}
```

### 10.5 逐模块详解
{{#functional_requirements}}
#### {{id}}: {{description}}
- 优先级: {{priority}}
- 输入: {{input}}
- 输出: {{output}}
- 业务规则: {{business_rule}}
{{/functional_requirements}}

---

## 第11章 数据埋点

### 11.1 埋点规划
| 事件名 | 触发时机 | 属性 | 用途 |
|--------|---------|------|------|
{{#tracking_events}}
| {{event}} | {{trigger}} | {{properties}} | {{purpose}} |
{{/tracking_events}}

### 11.2 指标体系
{{#metrics_tree}}
- {{.}}
{{/metrics_tree}}

---

## 第12章 角色与权限

### 12.1 RBAC 模型
| 角色 | 权限 | 数据范围 |
|------|------|---------|
{{#rbac_roles}}
| {{role}} | {{permissions}} | {{data_scope}} |
{{/rbac_roles}}

### 12.2 数据权限
{{data_permission}}

---

## 第13章 运营计划

### 13.1 上线推广
{{#launch_plan}}
- {{.}}
{{/launch_plan}}

### 13.2 监控体系
| 指标 | 阈值 | 告警方式 |
|------|------|---------|
{{#monitoring_metrics}}
| {{metric}} | {{threshold}} | {{alert_method}} |
{{/monitoring_metrics}}

---

## 第14章 待决事项

### 14.1 未确认项
{{#open_items}}
- [ ] {{.}}
{{/open_items}}

### 14.2 风险待决
{{#pending_risks}}
- [ ] {{.}}
{{/pending_risks}}

### 14.3 后续计划
{{#future_plans}}
- {{.}}
{{/future_plans}}

---

> 本 PRD 基于 AzaLoop 14 章模板生成，遵循宪法 12 条原则与 4 铁律。
