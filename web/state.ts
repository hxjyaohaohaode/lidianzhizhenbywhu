import type {Json} from './api.js';
export const state:{user:Json;caps:Json;datasets:Json[];active:string;brief:Json;route:string;id:string;cache:Record<string,Json>;query:string;dirty:boolean;busy:boolean;cursor:number}={
  user:null,caps:null,datasets:[],active:'',brief:null,route:'brief',id:'',cache:{},query:'',dirty:false,busy:false,cursor:0
};
export function activeDataset(){return state.datasets.find(d=>d.id===state.active)??null;}
export const roleNames:Record<string,string>={enterprise:'企业经营',investor:'投资研究',analyst:'财务分析',advisor:'顾问服务'};
export const routes:Record<string,{label:string;icon:string;section:string}>={
 brief:{label:'工作简报',icon:'overview',section:'工作区'},
 agents:{label:'协同研判',icon:'network',section:'工作区'},
 data:{label:'经营数据',icon:'database',section:'研究资产'},
 evidence:{label:'证据资料',icon:'files',section:'研究资产'},
 lab:{label:'情景与预测',icon:'sliders',section:'研究工具'},
 compare:{label:'企业对照',icon:'compare',section:'研究工具'},
 reports:{label:'研判报告',icon:'report',section:'研究工具'},
 actions:{label:'跟进行动',icon:'check',section:'协作与偏好'},
 memory:{label:'长期记忆',icon:'memory',section:'协作与偏好'},
 evolution:{label:'策略实验室',icon:'network',section:'管理'},
 ops:{label:'执行记录',icon:'activity',section:'管理'},
 settings:{label:'偏好与设置',icon:'settings',section:'管理'}
};
