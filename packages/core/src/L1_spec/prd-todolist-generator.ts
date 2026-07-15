/**
 * PRD TodoList Generator — PRD 生成后自动创建执行任务清单
 * 
 * 借鉴 Cursor Rules（规则驱动）和 Qoder Quest（任务分解）的设计模式：
 * - 从 PRD 的 stories 和 acceptance_criteria 自动提取可执行任务
 * - 每个任务有明确的验证标准和依赖关系
 * - 任务按优先级排序，支持并行执行
 */

import type { PRD, Story } from '@azaloop/shared';

export interface TodoItem {
  id: string;
  title: string;
  description: string;
  priority: 'P0' | 'P1' | 'P2';
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  story_id?: string;
  acceptance_criteria: string[];
  dependencies: string[];
  estimated_effort: 'XS' | 'S' | 'M' | 'L' | 'XL';
  verification: string;
}

export interface TodoList {
  prd_id: string;
  title: string;
  created_at: string;
  total_items: number;
  items: TodoItem[];
  summary: {
    p0_count: number;
    p1_count: number;
    p2_count: number;
    parallel_groups: number;
    critical_path: string[];
  };
}

export class PrdTodolistGenerator {
  /**
   * 从 PRD 生成 TodoList
   */
  generate(prd: PRD): TodoList {
    const items: TodoItem[] = [];
    
    // 1. 从 stories 提取任务
    for (const story of prd.stories || []) {
      const storyTasks = this.extractTasksFromStory(story, prd);
      items.push(...storyTasks);
    }
    
    // 2. 添加基础设施任务（架构、环境搭建）
    const infraTasks = this.generateInfraTasks(prd);
    items.unshift(...infraTasks);
    
    // 3. 添加质量保障任务
    const qualityTasks = this.generateQualityTasks(prd);
    items.push(...qualityTasks);
    
    // 4. 计算依赖关系和关键路径
    this.resolveDependencies(items);
    const criticalPath = this.findCriticalPath(items);
    
    // 5. 按优先级排序
    items.sort((a, b) => {
      const priorityOrder = { P0: 0, P1: 1, P2: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
    
    const p0Count = items.filter(i => i.priority === 'P0').length;
    const p1Count = items.filter(i => i.priority === 'P1').length;
    const p2Count = items.filter(i => i.priority === 'P2').length;
    
    // 计算并行组数
    const parallelGroups = this.countParallelGroups(items);
    
    return {
      prd_id: prd.id,
      title: prd.title,
      created_at: new Date().toISOString(),
      total_items: items.length,
      items,
      summary: {
        p0_count: p0Count,
        p1_count: p1Count,
        p2_count: p2Count,
        parallel_groups: parallelGroups,
        critical_path: criticalPath,
      },
    };
  }
  
  /**
   * 从 Story 提取任务
   */
  private extractTasksFromStory(story: Story, _prd: PRD): TodoItem[] {
    const tasks: TodoItem[] = [];
    const acs = story.acceptance_criteria || [];
    
    // Map Story priority (P0-P3) to TodoItem priority (P0-P2)
    const priority = this.mapPriority(story.priority);
    
    // 主任务：实现 story
    tasks.push({
      id: `TASK-${story.id}`,
      title: story.title,
      description: story.description,
      priority,
      status: 'pending',
      story_id: story.id,
      acceptance_criteria: acs.map(ac => ac.description),
      dependencies: (story.dependencies || []).map(dep => `TASK-${dep}`),
      estimated_effort: this.estimateEffort(story, acs.length),
      verification: this.generateVerification(story, acs),
    });
    
    // 子任务：每个 AC 可以拆分为独立验证步骤
    if (acs.length > 1) {
      for (let i = 0; i < acs.length; i++) {
        const ac = acs[i];
        if (!ac) continue;
        tasks.push({
          id: `TASK-${story.id}-AC${i + 1}`,
          title: `验证: ${ac.description.slice(0, 60)}${ac.description.length > 60 ? '...' : ''}`,
          description: `验收标准验证：${ac.description}`,
          priority,
          status: 'pending',
          story_id: story.id,
          acceptance_criteria: [ac.description],
          dependencies: [`TASK-${story.id}`],
          estimated_effort: 'XS',
          verification: ac.description,
        });
      }
    }
    
    return tasks;
  }
  
  /**
   * 生成基础设施任务
   */
  private generateInfraTasks(prd: PRD): TodoItem[] {
    const tasks: TodoItem[] = [];
    
    // 架构搭建任务
    if (prd.architecture && prd.architecture.length > 0) {
      const archDesc = prd.architecture[0]?.description || '组件化架构';
      tasks.push({
        id: 'TASK-INFRA-001',
        title: '项目架构搭建',
        description: `根据架构图搭建项目基础结构：${archDesc}`,
        priority: 'P0',
        status: 'pending',
        acceptance_criteria: ['项目结构符合架构图设计', '核心组件已创建'],
        dependencies: [],
        estimated_effort: 'M',
        verification: '项目结构通过架构评审',
      });
    }
    
    // 数据模型任务
    if (prd.stories && prd.stories.length > 0) {
      tasks.push({
        id: 'TASK-INFRA-002',
        title: '数据模型定义',
        description: '定义核心数据模型和类型',
        priority: 'P0',
        status: 'pending',
        acceptance_criteria: ['所有核心实体已定义', '类型安全通过编译'],
        dependencies: ['TASK-INFRA-001'],
        estimated_effort: 'S',
        verification: '数据模型编译通过',
      });
    }
    
    return tasks;
  }
  
  /**
   * 生成质量保障任务
   */
  private generateQualityTasks(prd: PRD): TodoItem[] {
    const tasks: TodoItem[] = [];
    
    // 测试任务
    tasks.push({
      id: 'TASK-QUAL-001',
      title: '单元测试编写',
      description: '为核心功能编写单元测试',
      priority: 'P1',
      status: 'pending',
      acceptance_criteria: [
        '核心功能测试覆盖率 ≥ 80%',
        '所有测试通过',
      ],
      dependencies: prd.stories.map(s => `TASK-${s.id}`),
      estimated_effort: 'M',
      verification: '测试覆盖率报告 ≥ 80%',
    });
    
    // 集成测试
    if (prd.stories.length >= 3) {
      tasks.push({
        id: 'TASK-QUAL-002',
        title: '集成测试',
        description: '验证 story 之间的集成点',
        priority: 'P1',
        status: 'pending',
        acceptance_criteria: [
          '所有集成点测试通过',
          '无数据丢失或损坏',
        ],
        dependencies: ['TASK-QUAL-001'],
        estimated_effort: 'S',
        verification: '集成测试全部通过',
      });
    }
    
    // 验收测试
    tasks.push({
      id: 'TASK-QUAL-003',
      title: '验收测试',
      description: '根据 PRD 验收标准进行最终验收',
      priority: 'P0',
      status: 'pending',
      acceptance_criteria: prd.acceptance_criteria.map(ac => ac.description),
      dependencies: ['TASK-QUAL-001', 'TASK-QUAL-002'],
      estimated_effort: 'S',
      verification: '所有验收标准通过',
    });
    
    return tasks;
  }
  
  /**
   * Map Story priority (P0-P3) to TodoItem priority (P0-P2)
   */
  private mapPriority(storyPriority: string): 'P0' | 'P1' | 'P2' {
    if (storyPriority === 'P0') return 'P0';
    if (storyPriority === 'P1') return 'P1';
    return 'P2'; // P2 and P3 both map to P2
  }
  
  /**
   * 估算工作量
   */
  private estimateEffort(story: Story, acCount: number): 'XS' | 'S' | 'M' | 'L' | 'XL' {
    const descLength = story.description.length;
    if (acCount <= 1 && descLength < 100) return 'XS';
    if (acCount <= 2 && descLength < 200) return 'S';
    if (acCount <= 3 && descLength < 400) return 'M';
    if (acCount <= 5 && descLength < 800) return 'L';
    return 'XL';
  }
  
  /**
   * 生成验证描述
   */
  private generateVerification(story: Story, acs: Array<{ description: string }>): string {
    if (acs.length === 0) {
      return `验证 "${story.title}" 功能正常`;
    }
    if (acs.length === 1) {
      return acs[0]?.description || '验证验收标准通过';
    }
    return `验证 ${acs.length} 条验收标准全部通过`;
  }
  
  /**
   * 解析依赖关系
   */
  private resolveDependencies(items: TodoItem[]): void {
    const taskIds = new Set(items.map(i => i.id));
    for (const item of items) {
      // 过滤掉不存在的依赖
      item.dependencies = item.dependencies.filter(dep => taskIds.has(dep));
    }
  }
  
  /**
   * 查找关键路径
   */
  private findCriticalPath(items: TodoItem[]): string[] {
    // 简单的关键路径：P0 任务的依赖链
    const p0Items = items.filter(i => i.priority === 'P0');
    const path: string[] = [];
    
    for (const item of p0Items) {
      if (!path.includes(item.id)) {
        path.push(item.id);
        // 递归添加依赖
        for (const dep of item.dependencies) {
          if (!path.includes(dep)) {
            path.unshift(dep);
          }
        }
      }
    }
    
    return path.slice(0, 10); // 最多返回10个
  }
  
  /**
   * 计算并行组数
   */
  private countParallelGroups(items: TodoItem[]): number {
    // 简单启发式：没有依赖的 P0/P1 任务可以并行
    const independentTasks = items.filter(
      i => i.dependencies.length === 0 && (i.priority === 'P0' || i.priority === 'P1')
    );
    return Math.max(1, independentTasks.length);
  }
}

/**
 * 便捷函数：从 PRD 生成 TodoList
 */
export function generatePrdTodolist(prd: PRD): TodoList {
  const generator = new PrdTodolistGenerator();
  return generator.generate(prd);
}
