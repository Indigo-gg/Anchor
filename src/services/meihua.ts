import { ref, computed } from 'vue'
import { appDb } from './db'

export interface MeihuaDivinationResult {
  tiGua: string;
  yongGua: string;
  relation: string;
  tiElement: string;
  yongElement: string;
}

export interface MeihuaRecord {
  id: string;
  timestamp: number;
  trigger: string; // The initial environment observing prompt
  input: string; // User's input (the object they saw)
  keywords: string[]; // Extracted from LLM
  divinationResult: MeihuaDivinationResult;
  chatHistory: { role: string; content: string }[]; // The mini-chat history
  finalReport: string; // The final RAG generated report
}

// Memory caching
const records = ref<MeihuaRecord[]>([])
let isInitializing = false

async function init() {
    if (isInitializing) return
    isInitializing = true

    try {
        records.value = await appDb.meihuaRecords.reverse().toArray()
    } catch (e) {
        console.error('Failed to load meihua records from db:', e)
        records.value = []
    }
}

function addRecord(data: Omit<MeihuaRecord, 'id' | 'timestamp'>) {
    const record: MeihuaRecord = {
        id: `meihua_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        ...data
    }

    records.value.unshift(record)
    // Non-reactive copy to save in IndexedDB
    appDb.meihuaRecords.put(JSON.parse(JSON.stringify(record))).catch(e => console.error('[MeihuaStore] Save failed', e))
    return record
}

function deleteRecord(id: string) {
    records.value = records.value.filter(r => r.id !== id)
    appDb.meihuaRecords.delete(id).catch(e => console.error('[MeihuaStore] Delete failed', e))
}

export function useMeihuaStore() {
    if (records.value.length === 0) {
        init()
    }

    return {
        records,
        recentRecords: computed(() => records.value.slice(0, 5)),
        addRecord,
        deleteRecord
    }
}

// =======================
// 梅花易数核心算法引擎
// =======================

export const BAGUA = ['乾', '兑', '离', '震', '巽', '坎', '艮', '坤'];
export const BAGUA_ELEMENTS: Record<string, string> = {
  '乾': '金', '兑': '金', '离': '火', '震': '木', '巽': '木', '坎': '水', '艮': '土', '坤': '土'
};

export function getWuxingRelation(ti: string, yong: string): string {
  const t = BAGUA_ELEMENTS[ti];
  const y = BAGUA_ELEMENTS[yong];
  if (t === y) return "比和 (平稳)";
  
  const rules: Record<string, Record<string, string>> = {
    '金': { '水': '生用', '木': '克用', '火': '被克', '土': '被生' },
    '水': { '木': '生用', '火': '克用', '土': '被克', '金': '被生' },
    '木': { '火': '生用', '土': '克用', '金': '被克', '水': '被生' },
    '火': { '土': '生用', '金': '克用', '水': '被克', '木': '被生' },
    '土': { '金': '生用', '水': '克用', '木': '被克', '火': '被生' }
  };
  
  const rel = rules[t][y];
  if (rel === '生用') return '体生用 (耗气/付出)';
  if (rel === '克用') return '体克用 (事成/掌控)';
  if (rel === '被克') return '用克体 (压抑/阻碍)';
  if (rel === '被生') return '用生体 (进益/获得)';
  return "未知";
}

export function getGuaByNumber(num: number): string {
  let remainder = num % 8;
  if (remainder === 0) remainder = 8;
  return BAGUA[remainder - 1];
}

export function getYaoByNumber(num: number): number {
  let remainder = num % 6;
  if (remainder === 0) remainder = 6;
  return remainder;
}

/**
 * 意象转化为数字
 * 简单起见，按名称字数（或第一字笔画）。由于我们无法在浏览器内轻易算笔画，
 * 如果LLM没有返回对应的五行或属性，我们通过随机或简单映射（这里为了好展示，先固定或者做简单hash）。
 * 更好的是 LLM 提取时直接带有先天数或对应的八卦预测。
 */
function getStringHashNumber(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash += str.charCodeAt(i);
    }
    return hash;
}

export function calculateDivination(upperKeyword: string, lowerKeyword: string): MeihuaDivinationResult {
  // If keyword matches a baqua, use its index. Otherwise hash it.
  let upperNum = BAGUA.indexOf(upperKeyword) + 1;
  if (upperNum === 0) upperNum = getStringHashNumber(upperKeyword);
  
  let lowerNum = BAGUA.indexOf(lowerKeyword) + 1;
  if (lowerNum === 0) lowerNum = getStringHashNumber(lowerKeyword);

  const hourNumber = new Date().getHours() || 1; // 时辰加数简单化
  
  const upperGua = getGuaByNumber(upperNum);
  const lowerGua = getGuaByNumber(lowerNum);
  const yao = getYaoByNumber(upperNum + lowerNum + hourNumber);
  
  let tiGua, yongGua;
  if (yao <= 3) {
    tiGua = upperGua;
    yongGua = lowerGua;
  } else {
    tiGua = lowerGua;
    yongGua = upperGua;
  }
  
  const relation = getWuxingRelation(tiGua, yongGua);
  
  return {
    tiGua,
    yongGua,
    relation,
    tiElement: BAGUA_ELEMENTS[tiGua],
    yongElement: BAGUA_ELEMENTS[yongGua]
  };
}
