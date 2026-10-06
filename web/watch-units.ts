import {esc,input,jsonView,metricNames,table} from './components.js';
import type {Json} from './api.js';

// This is the existing server WatchSpec metric set, not a financial capability registry.
export const watchMetrics={gross_margin:'毛利率（%）',cash_ratio:'经营现金收入比（%）',leverage:'资产负债率（%）',revenue_growth:'收入增速（%）',cash_flow:'经营现金流（人民币元）',revenue:'营业收入（人民币元）'};
const ratioMetrics=new Set(['gross_margin','cash_ratio','leverage','revenue_growth']);
function known(metric:string){return Object.hasOwn(watchMetrics,metric);}
export function watchUnit(metric:string){return ratioMetrics.has(metric)?'%':known(metric)?'人民币元':'单位未记录';}

// Shift decimal text rather than multiplying binary floats (0.29 * 100 has a tail).
// No fixed precision: small legal thresholds must never be displayed as zero.
function shiftDecimal(raw:string,places:number):string {
 const match=raw.match(/^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?$/i);
 if(!match)throw new Error('请填写有效数值。');
 const parts=match[2].split('.'),all=parts.join(''),digits=all.replace(/^0+/,'').replace(/0+$/,'');
 if(!digits)return '0';
 const point=parts[0].length-(all.length-all.replace(/^0+/,'').length)+Number(match[3]??0)+places;
 const sign=match[1]==='-'?'-':'';
 if(point<=-6||point>21)return sign+digits[0]+(digits.length>1?'.'+digits.slice(1):'')+'e'+(point-1);
 return sign+(point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point));
}
export function watchInputValue(metric:string,value:unknown):string {
 return known(metric)&&typeof value==='number'&&Number.isFinite(value)?shiftDecimal(String(value),ratioMetrics.has(metric)?2:0):'';
}
export function watchValue(metric:string,value:unknown):string {
 const display=watchInputValue(metric,value);
 return display===''?'—':display+(ratioMetrics.has(metric)?'%':' 元（人民币）');
}
export function parseWatchThreshold(metric:string,raw:string):number {
 if(!known(metric))throw new Error('请选择支持的跟踪指标。');
 const text=raw.trim();
 if(!text||text.length>400||!Number.isFinite(Number(text)))throw new Error('请填写有效阈值（'+watchUnit(metric)+'）。');
 const shifted=shiftDecimal(text,ratioMetrics.has(metric)?-2:0),value=Number(shifted);
 if(!Number.isFinite(value)||Math.abs(value)>1e15)throw new Error('阈值超出允许范围：±'+(ratioMetrics.has(metric)?'100000000000000000%':'1000000000000000 元（人民币）')+'。');
 if(value===0&&shifted!=='0')throw new Error('阈值过小，无法准确保存；请填写可保存的非零数值或明确填写 0。');
 return value;
}
function thresholdHint(metric:string){return ratioMetrics.has(metric)?'直接填写百分数，例如 20 表示 20%；允许负值和超过 100%。':'始终填写人民币元，例如 15000.25；不随万元或亿元展示偏好换算。';}
export function watchThresholdField(metric='gross_margin',value:unknown=null){
 const limit=ratioMetrics.has(metric)?'100000000000000000':'1000000000000000';
 return `<label class="field" data-watch-threshold><span data-watch-threshold-label>阈值（${esc(watchUnit(metric))}）</span>${input('threshold',watchInputValue(metric,value),`type="number" step="any" required min="-${limit}" max="${limit}" data-watch-metric="${esc(metric)}" aria-describedby="watch-threshold-hint"`)}<small id="watch-threshold-hint" data-watch-threshold-hint aria-live="polite">${esc(thresholdHint(metric))}</small></label>`;
}
export function syncWatchMetric(form:HTMLFormElement,metric:string){
 const control=form.querySelector<HTMLInputElement>('[name="threshold"]');
 if(!control||control.dataset.watchMetric===metric)return;
 const previous=control.dataset.watchMetric;
 control.value='';control.dataset.watchMetric=metric;
 const limit=ratioMetrics.has(metric)?'100000000000000000':'1000000000000000';
 control.min='-'+limit;control.max=limit;
 const label=form.querySelector('[data-watch-threshold-label]'),hint=form.querySelector('[data-watch-threshold-hint]'),error=form.querySelector('.form-error');
 if(label)label.textContent='阈值（'+watchUnit(metric)+'）';
 if(hint)hint.textContent='指标已从'+(metricNames[previous??'']??'原指标')+'切换为'+(metricNames[metric]??metric)+'，旧阈值已清空，请重新填写。'+thresholdHint(metric);
 if(error)error.textContent='';
}
export function watchThresholdRequest(form:HTMLFormElement,metric:string,raw:string){
 const renderedMetric=form.querySelector<HTMLInputElement>('[name="threshold"]')?.dataset?.watchMetric;
 if(renderedMetric&&renderedMetric!==metric)throw new Error('跟踪指标已变化，请重新选择指标并填写对应单位的阈值。');
 return parseWatchThreshold(metric,raw);
}
export function watchRawValues(metric:string,threshold:unknown,value?:unknown){
 return `<details><summary>技术原始值与存储单位</summary>${jsonView({metric,storage_unit:ratioMetrics.has(metric)?'ratio_fraction':known(metric)?'CNY_yuan':'unknown',threshold,...(value===undefined?{}:{value})})}</details>`;
}
export function watchPreview(p:Json){return table(['跟踪指标','触发条件','阈值'],[[esc(metricNames[p.metric]??p.metric),p.operator==='lt'?'低于':'高于',esc(watchValue(p.metric,p.threshold))]])+watchRawValues(p.metric,p.threshold);}
