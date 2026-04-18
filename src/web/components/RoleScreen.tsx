import React from "react";
import type { RoleKey } from "../utils/helpers.js";
import { Icon } from "./Icon.js";
import { RippleButton } from "./Icon.js";
import { useAppContext } from "../context/AppContext.js";

export function RoleScreen({ onSelect }: { onSelect: (r: RoleKey) => void }) {
  const { rememberRole, handleRememberRoleChange } = useAppContext();
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      padding: '40px 20px',
      gap: '36px',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
        <img
          src="/images/logo.png"
          alt="锂电智诊"
          style={{ width: '72px', height: '72px', borderRadius: '18px', boxShadow: '0 4px 20px rgba(79,107,246,0.15)' }}
        />
        <h1 style={{
          fontSize: '28px',
          fontWeight: 700,
          background: 'linear-gradient(135deg, #4F6BF6, #7C5CFC)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          letterSpacing: '-0.5px',
        }}>
          锂电智诊
        </h1>
        <p style={{ fontSize: '15px', color: 'var(--t3)', marginTop: '-8px' }}>
          请选择您的身份以开始使用
        </p>
      </div>

      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <RippleButton onClick={() => onSelect('e')}>
          <div
            className="role-card-enterprise"
            style={{
              width: '280px',
              padding: '32px 28px',
              borderRadius: '20px',
              background: 'var(--glass-surface)',
              backdropFilter: 'var(--glass-blur)',
              WebkitBackdropFilter: 'var(--glass-blur)',
              border: '1px solid var(--glass-border-soft)',
              boxShadow: 'var(--shadow-md)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px',
              cursor: 'pointer',
              transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease, border-color 0.3s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-6px)';
              e.currentTarget.style.boxShadow = '0 12px 40px rgba(79,107,246,0.15), 0 4px 16px rgba(79,107,246,0.08)';
              e.currentTarget.style.borderColor = 'rgba(79,107,246,0.25)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'var(--shadow-md)';
              e.currentTarget.style.borderColor = 'var(--glass-border-soft)';
            }}
          >
            <div style={{
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #4F6BF6, #06B6D4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(79,107,246,0.2)',
            }}>
              <Icon name="enterprise" size={28} color="#FFFFFF" />
            </div>
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--t1)' }}>
              企业运营分析
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--t3)', textAlign: 'center', lineHeight: 1.6 }}>
              深度诊断企业毛利承压原因<br />提供经营质量优化建议
            </p>
            <div style={{
              fontSize: '11px',
              color: 'var(--blue)',
              background: 'rgba(79,107,246,0.08)',
              padding: '4px 12px',
              borderRadius: '20px',
              fontWeight: 500,
            }}>
              GMPS + DQI 双模型
            </div>
          </div>
        </RippleButton>

        <RippleButton onClick={() => onSelect('i')}>
          <div
            className="role-card-investor"
            style={{
              width: '280px',
              padding: '32px 28px',
              borderRadius: '20px',
              background: 'var(--glass-surface)',
              backdropFilter: 'var(--glass-blur)',
              WebkitBackdropFilter: 'var(--glass-blur)',
              border: '1px solid var(--glass-border-soft)',
              boxShadow: 'var(--shadow-md)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px',
              cursor: 'pointer',
              transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease, border-color 0.3s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-6px)';
              e.currentTarget.style.boxShadow = '0 12px 40px rgba(124,92,252,0.15), 0 4px 16px rgba(124,92,252,0.08)';
              e.currentTarget.style.borderColor = 'rgba(124,92,252,0.25)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'var(--shadow-md)';
              e.currentTarget.style.borderColor = 'var(--glass-border-soft)';
            }}
          >
            <div style={{
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #7C5CFC, #F59E0B)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(124,92,252,0.2)',
            }}>
              <Icon name="investor" size={28} color="#FFFFFF" />
            </div>
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--t1)' }}>
              投资人员
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--t3)', textAlign: 'center', lineHeight: 1.6 }}>
              行业趋势分析与投资推荐<br />深度解析标的企业价值
            </p>
            <div style={{
              fontSize: '11px',
              color: 'var(--purple)',
              background: 'rgba(124,92,252,0.08)',
              padding: '4px 12px',
              borderRadius: '20px',
              fontWeight: 500,
            }}>
              风险评估 + 投资决策
            </div>
          </div>
        </RippleButton>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '24px', gap: '8px' }}>
        <input
          type="checkbox"
          id="remember-role"
          checked={rememberRole}
          onChange={(e) => handleRememberRoleChange(e.target.checked)}
          style={{ width: '16px', height: '16px', cursor: 'pointer' }}
        />
        <label htmlFor="remember-role" style={{ fontSize: '14px', color: 'var(--t3)', cursor: 'pointer' }}>
          记住我的选择
        </label>
      </div>

      <div style={{ fontSize: '12px', color: 'var(--t3)', marginTop: '8px' }}>
        v3.18.2 · 锂电智诊智能诊断系统
      </div>
    </div>
  );
}
