import type { PRD } from '@azaloop/shared';

export interface FieldDiff {
  field: string;
  oldValue: string;
  newValue: string;
  changeRatio: number;  // 0-1
}

export interface PrdDiff {
  fields: FieldDiff[];
  overallChangeRatio: number;
  materialChange: boolean;
}

/**
 * V20 Task 12: 字段级差异分析（非哈希）
 */
export function diffPrd(oldPrd: PRD, newPrd: PRD): PrdDiff {
  const fields: FieldDiff[] = [];
  
  // 比较关键字段
  const keyFields = ['overview', 'title', 'version'] as const;
  for (const field of keyFields) {
    const oldVal = String(oldPrd[field] ?? '');
    const newVal = String(newPrd[field] ?? '');
    if (oldVal !== newVal) {
      const maxLen = Math.max(oldVal.length, newVal.length);
      const changeRatio = maxLen > 0 ? Math.abs(oldVal.length - newVal.length) / maxLen : 0;
      fields.push({
        field,
        oldValue: oldVal.slice(0, 100),
        newValue: newVal.slice(0, 100),
        changeRatio,
      });
    }
  }
  
  // 比较数组字段（goals, stories, risks）
  const arrayFields = ['goals', 'stories', 'risks'] as const;
  for (const field of arrayFields) {
    const oldArr = Array.isArray(oldPrd[field]) ? oldPrd[field] : [];
    const newArr = Array.isArray(newPrd[field]) ? newPrd[field] : [];
    if (oldArr.length !== newArr.length) {
      const maxLen = Math.max(oldArr.length, newArr.length);
      const changeRatio = Math.abs(oldArr.length - newArr.length) / maxLen;
      fields.push({
        field,
        oldValue: `length=${oldArr.length}`,
        newValue: `length=${newArr.length}`,
        changeRatio,
      });
    }
  }
  
  const overallChangeRatio = fields.length > 0 
    ? fields.reduce((sum, f) => sum + f.changeRatio, 0) / fields.length
    : 0;
  
  return {
    fields,
    overallChangeRatio,
    materialChange: hasMaterialChange({ overallChangeRatio }),
  };
}

/**
 * V20 Task 12: contract.md 差异（按行）
 */
export function diffContract(oldContent: string, newContent: string): { 
  lineChanges: number; 
  changeRatio: number; 
  materialChange: boolean 
} {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  
  let lineChanges = 0;
  const maxLen = Math.max(oldLines.length, newLines.length);
  
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i] ?? '';
    const newLine = newLines[i] ?? '';
    if (oldLine !== newLine) {
      lineChanges++;
    }
  }
  
  const changeRatio = maxLen > 0 ? lineChanges / maxLen : 0;
  
  return {
    lineChanges,
    changeRatio,
    materialChange: hasMaterialChange({ changeRatio }),
  };
}

/**
 * V20 Task 12: 判断是否有实质性变化：<10% 不触发 drift
 */
export function hasMaterialChange(diff: { overallChangeRatio: number } | { changeRatio: number }): boolean {
  const ratio = 'overallChangeRatio' in diff ? diff.overallChangeRatio : diff.changeRatio;
  return ratio >= 0.1;  // 10% 阈值
}

export interface MaterialChangeReport {
  changed: boolean;
  diffScore: number;
  diffAreas: string[];
  addedFields: string[];
  removedFields: string[];
  changedFields: string[];
}

/**
 * 内容差异而非仅哈希对比（Jaccard 距离 + PRD 字段级 diff）。
 * 旧 hasMaterialChange(diff) 保留不变；本函数用于直接对 PRD / 字符串做内容对比。
 */
export function hasMaterialChangeV2(
  oldContent: string | PRD,
  newContent: string | PRD,
  threshold: number = 0.1,
): MaterialChangeReport {
  const oldStr = typeof oldContent === 'string' ? oldContent : JSON.stringify(oldContent);
  const newStr = typeof newContent === 'string' ? newContent : JSON.stringify(newContent);

  // 基于 Jaccard 距离的 token 级 diff score
  const oldTokens = oldStr.split(/\s+/).filter(t => t.length > 0);
  const newTokens = newStr.split(/\s+/).filter(t => t.length > 0);
  const oldSet = new Set(oldTokens);
  const newSet = new Set(newTokens);
  let intersection = 0;
  for (const t of oldSet) {
    if (newSet.has(t)) intersection++;
  }
  const union = new Set([...oldTokens, ...newTokens]).size;
  const jaccard = union > 0 ? intersection / union : 1;
  const diffScore = 1 - jaccard;

  const emptyReport: MaterialChangeReport = {
    changed: diffScore > threshold,
    diffScore,
    diffAreas: [],
    addedFields: [],
    removedFields: [],
    changedFields: [],
  };

  // 仅当两侧都是 PRD 对象时计算字段级 diff
  if (
    typeof oldContent === 'object' &&
    typeof newContent === 'object' &&
    oldContent !== null &&
    newContent !== null
  ) {
    const oldPrd = oldContent as PRD;
    const newPrd = newContent as PRD;
    const diffAreas: string[] = [];
    if (oldPrd.overview !== newPrd.overview) diffAreas.push('overview');
    if (oldPrd.title !== newPrd.title) diffAreas.push('title');
    if ((oldPrd.stories?.length ?? 0) !== (newPrd.stories?.length ?? 0)) {
      diffAreas.push('stories.length');
    }
    const oldIds = new Set((oldPrd.stories ?? []).map(s => s.id));
    const newIds = new Set((newPrd.stories ?? []).map(s => s.id));
    const addedFields = [...newIds].filter(id => !oldIds.has(id));
    const removedFields = [...oldIds].filter(id => !newIds.has(id));
    return {
      changed: diffScore > threshold,
      diffScore,
      diffAreas,
      addedFields,
      removedFields,
      changedFields: diffAreas,
    };
  }

  return emptyReport;
}
