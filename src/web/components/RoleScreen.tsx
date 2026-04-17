import type { RoleKey } from "../utils/helpers.js";

export function RoleScreen({ onSelect }: { onSelect: (r: RoleKey) => void }) {
  return (
    <>
      <h1 className="rt">欢迎使用锂电智诊</h1>
      <p className="rs">请选择您的身份以开始使用</p>
      <div className="rcs">
        <div className="rc" onClick={() => onSelect('e')}>
          <span className="ic">🏭</span>
          <h3>企业运营分析</h3>
          <p>深度诊断企业毛利承压原因<br />提供经营质量优化建议</p>
        </div>
        <div className="rc" onClick={() => onSelect('i')}>
          <span className="ic">📊</span>
          <h3>投资人员</h3>
          <p>行业趋势分析与投资推荐，<br />深度解析标的企业价值</p>
        </div>
      </div>
    </>
  );
}
