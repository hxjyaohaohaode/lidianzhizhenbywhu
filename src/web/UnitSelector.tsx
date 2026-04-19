/* eslint-disable react-refresh/only-export-components */
/**
 * 单位选择器组件
 * 
 * 功能：
 * 1. 允许用户选择金额单位（元、万元、亿元）
 * 2. 允许用户选择百分比显示方式（百分比、小数）
 * 3. 允许用户选择数量单位（件、千件、百万件）
 * 4. 自动保存用户偏好到本地存储
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  type UnitPreferences,
  type AmountUnit,
  type PercentageUnit,
  type VolumeUnit,
  type UnitOption,
  AMOUNT_UNIT_OPTIONS,
  PERCENTAGE_UNIT_OPTIONS,
  VOLUME_UNIT_OPTIONS,
  DEFAULT_UNIT_PREFERENCES,
  saveUnitPreferences,
  loadUnitPreferences,
} from "./data-formatter.js";

interface UnitSelectorProps {
  onChange?: (preferences: UnitPreferences) => void;
  className?: string;
}

export function UnitSelector({ onChange, className = "" }: UnitSelectorProps) {
  const [preferences, setPreferences] = useState<UnitPreferences>(DEFAULT_UNIT_PREFERENCES);
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, right: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);

  // 加载保存的偏好
  useEffect(() => {
    const saved = loadUnitPreferences();
    setPreferences(saved);
  }, []);

  // 更新偏好
  const updatePreference = useCallback(
    <K extends keyof UnitPreferences>(key: K, value: UnitPreferences[K]) => {
      const newPreferences = { ...preferences, [key]: value };
      setPreferences(newPreferences);
      saveUnitPreferences(newPreferences);
      onChange?.(newPreferences);
    },
    [preferences, onChange]
  );

  // 获取当前单位显示标签
  const getCurrentLabel = () => {
    const amountLabel = AMOUNT_UNIT_OPTIONS.find((o: UnitOption) => o.value === preferences.amountUnit)?.label;
    return `单位: ${amountLabel}`;
  };

  // 计算下拉菜单位置
  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const dropdownHeight = 320;
      const dropdownWidth = 240;
      
      let top = rect.bottom + 8;
      let right = window.innerWidth - rect.right;
      
      if (top + dropdownHeight > window.innerHeight) {
        top = rect.top - dropdownHeight - 8;
      }
      
      if (right + dropdownWidth > window.innerWidth) {
        right = window.innerWidth - rect.left - dropdownWidth;
      }
      
      setDropdownPosition({
        top: Math.max(8, top),
        right: Math.max(8, right),
      });
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      updatePosition();
    }
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;
    
    const handleScroll = () => updatePosition();
    const handleResize = () => updatePosition();
    
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen, updatePosition]);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    if (!isOpen) return;
    
    const handleClickOutside = (event: MouseEvent) => {
      if (
        triggerRef.current && 
        !triggerRef.current.contains(event.target as Node) &&
        !(event.target as Element).closest('.unit-selector-dropdown')
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className={`unit-selector ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className="unit-selector-trigger"
        onClick={() => setIsOpen(!isOpen)}
        title="点击选择数据单位"
      >
        <span className="unit-selector-icon">⚙️</span>
        <span className="unit-selector-label">{getCurrentLabel()}</span>
        <span className={`unit-selector-arrow ${isOpen ? "open" : ""}`}>▼</span>
      </button>

      {isOpen && createPortal(
        <div 
          className="unit-selector-dropdown"
          style={{
            position: 'fixed',
            top: `${dropdownPosition.top}px`,
            right: `${dropdownPosition.right}px`,
            zIndex: 9999,
          }}
        >
          <div className="unit-selector-section">
            <h4 className="unit-selector-title">金额单位</h4>
            <div className="unit-selector-options">
              {AMOUNT_UNIT_OPTIONS.map((option: UnitOption) => (
                <label
                  key={option.value}
                  className={`unit-selector-option ${
                    preferences.amountUnit === option.value ? "selected" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="amountUnit"
                    value={option.value}
                    checked={preferences.amountUnit === option.value}
                    onChange={(e) => updatePreference("amountUnit", e.target.value as AmountUnit)}
                  />
                  <span className="unit-option-label">{option.label}</span>
                  {option.description && (
                    <span className="unit-option-desc">{option.description}</span>
                  )}
                </label>
              ))}
            </div>
          </div>

          <div className="unit-selector-section">
            <h4 className="unit-selector-title">百分比显示</h4>
            <div className="unit-selector-options">
              {PERCENTAGE_UNIT_OPTIONS.map((option: UnitOption) => (
                <label
                  key={option.value}
                  className={`unit-selector-option ${
                    preferences.percentageUnit === option.value ? "selected" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="percentageUnit"
                    value={option.value}
                    checked={preferences.percentageUnit === option.value}
                    onChange={(e) =>
                      updatePreference("percentageUnit", e.target.value as PercentageUnit)
                    }
                  />
                  <span className="unit-option-label">{option.label}</span>
                  {option.description && (
                    <span className="unit-option-desc">{option.description}</span>
                  )}
                </label>
              ))}
            </div>
          </div>

          <div className="unit-selector-section">
            <h4 className="unit-selector-title">数量单位</h4>
            <div className="unit-selector-options">
              {VOLUME_UNIT_OPTIONS.map((option: UnitOption) => (
                <label
                  key={option.value}
                  className={`unit-selector-option ${
                    preferences.volumeUnit === option.value ? "selected" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="volumeUnit"
                    value={option.value}
                    checked={preferences.volumeUnit === option.value}
                    onChange={(e) => updatePreference("volumeUnit", e.target.value as VolumeUnit)}
                  />
                  <span className="unit-option-label">{option.label}</span>
                  {option.description && (
                    <span className="unit-option-desc">{option.description}</span>
                  )}
                </label>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="unit-selector-close"
            onClick={() => setIsOpen(false)}
          >
            完成
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

// 简化的内联单位选择器（仅金额单位）
export function AmountUnitSelector({
  value,
  onChange,
  className = "",
}: {
  value: AmountUnit;
  onChange: (unit: AmountUnit) => void;
  className?: string;
}) {
  return (
    <select
      className={`amount-unit-select ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value as AmountUnit)}
      title="选择金额单位"
    >
      {AMOUNT_UNIT_OPTIONS.map((option: UnitOption) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

// Hook: 使用单位偏好
export function useUnitPreferences() {
  const [preferences, setPreferences] = useState<UnitPreferences>(DEFAULT_UNIT_PREFERENCES);

  useEffect(() => {
    setPreferences(loadUnitPreferences());
  }, []);

  const updatePreferences = useCallback((newPreferences: UnitPreferences) => {
    setPreferences(newPreferences);
    saveUnitPreferences(newPreferences);
  }, []);

  return { preferences, updatePreferences };
}
