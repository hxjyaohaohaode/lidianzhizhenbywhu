import React, { useState, useRef, useEffect } from "react";
import type { RoleKey } from "../utils/helpers.js";
import { Icon } from "./Icon.js";

interface IdentitySwitcherProps {
  currentRole: RoleKey | null;
  onSwitch: (role: RoleKey) => void;
  isDark?: boolean;
}

export function IdentitySwitcher({ currentRole, onSwitch, isDark: _isDark = false }: IdentitySwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const options: { key: RoleKey; label: string; icon: 'enterprise' | 'investor'; description: string }[] = [
    { key: "e", label: "企业端", icon: "enterprise", description: "企业运营分析" },
    { key: "i", label: "投资端", icon: "investor", description: "投资分析" },
  ];

  const currentOption = (options.find(opt => opt.key === currentRole) ?? options[0])!;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (role: RoleKey) => {
    setIsOpen(false);
    onSwitch(role);
  };

  return (
    <div
      ref={dropdownRef}
      style={{
        position: "relative",
        display: "inline-block",
        zIndex: 100,
      }}
    >
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 16px",
          borderRadius: "12px",
          border: "1px solid var(--line)",
          background: "var(--gl)",
          color: "var(--t1)",
          fontSize: "14px",
          fontWeight: 500,
          cursor: "pointer",
          transition: "all 0.2s ease",
          whiteSpace: "nowrap",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "var(--bd-hover)";
          e.currentTarget.style.background = "var(--glass-soft)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "var(--line)";
          e.currentTarget.style.background = "var(--gl)";
        }}
      >
        <Icon name={currentOption.icon} size={18} />
        <span>{currentOption.label}</span>
        <span style={{ fontSize: '12px', opacity: 0.7 }}>{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            minWidth: "200px",
            borderRadius: "12px",
            border: "1px solid var(--line)",
            background: "var(--glass-surface)",
            backdropFilter: "var(--glass-blur)",
            WebkitBackdropFilter: "var(--glass-blur)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
            overflow: "hidden",
            zIndex: 101,
            animation: "dropdownFadeIn 0.2s ease-out",
          }}
        >
          {options.map((option) => {
            const isActive = option.key === currentRole;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => handleSelect(option.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  width: "100%",
                  padding: "12px 16px",
                  border: "none",
                  background: isActive ? "rgba(59,130,246,0.1)" : "transparent",
                  color: isActive ? "var(--blue)" : "var(--t1)",
                  fontSize: "14px",
                  textAlign: "left",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = "var(--glass-soft)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = "transparent";
                  }
                }}
              >
                <Icon name={option.icon} size={20} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: isActive ? 600 : 500 }}>
                    {option.label}
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: isActive ? "var(--blue)" : "var(--t3)",
                      marginTop: "2px",
                    }}
                  >
                    {option.description}
                  </div>
                </div>
                {isActive && <span style={{ fontSize: '14px', color: 'var(--blue)' }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}

      <style>
        {`
          @keyframes dropdownFadeIn {
            from { opacity: 0; transform: translateY(-8px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}
      </style>
    </div>
  );
}