import React, { useState, useEffect, useCallback } from "react";
import type { EditableBusinessInfo } from "../../shared/business.js";
import {
  type BaseInfoDraftRow,
  type BaseInfoPresetGroup,
  type BaseInfoInputKind,
  createBaseInfoDraftRows,
  flattenBaseInfoPresetFields,
  buildEditableBusinessInfo,
  createCustomBaseInfoRow,
  formatEditableBusinessInfoValue,
  reformatBaseInfoValue,
  getBaseInfoInputHint,
  getBaseInfoInputTypeLabel,
  getBaseInfoPanelTheme,
  isBaseInfoValueFilled,
  countFilledPresetFields,
  countFilledPresetDraftFields,
  toBaseInfoDisplayItems,
} from "../utils/helpers.js";

function renderBaseInfoValueContent(
  value: EditableBusinessInfo[string] | undefined,
  inputKind: BaseInfoInputKind,
  align: "start" | "end" = "end",
) {
  const items = toBaseInfoDisplayItems(value);
  if (items.length === 0) {
    return <span style={{ color: "var(--t3)", fontSize: "12px" }}>待填写</span>;
  }
  if (inputKind === "tags" || inputKind === "companies") {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", justifyContent: align === "end" ? "flex-end" : "flex-start" }}>
        {items.map((item) => (
          <span key={item} style={{ padding: "4px 8px", borderRadius: "999px", background: "var(--gl)", border: "1px solid var(--line)", color: "var(--t3)", fontSize: "12px", maxWidth: "100%", wordBreak: "break-word" }}>{item}</span>
        ))}
      </div>
    );
  }
  return <span style={{ color: "var(--t3)", fontSize: "12px", textAlign: align === "end" ? "right" : "left", wordBreak: "break-word" }}>{formatEditableBusinessInfoValue(value)}</span>;
}

export function EditableBaseInfoPanel({
  title,
  baseInfo,
  emptyText,
  presetGroups,
  onSave,
}: {
  title: string;
  baseInfo?: EditableBusinessInfo;
  emptyText: string;
  presetGroups: BaseInfoPresetGroup[];
  onSave: (baseInfo: EditableBusinessInfo) => Promise<void>;
}) {
  const [draftRows, setDraftRows] = useState<BaseInfoDraftRow[]>(() => createBaseInfoDraftRows(baseInfo, presetGroups));
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const presetFields = flattenBaseInfoPresetFields(presetGroups);
  const presetFieldSet = new Set(presetFields.map((field) => field.field));

  useEffect(() => {
    if (!isEditing) {
      setDraftRows(createBaseInfoDraftRows(baseInfo, presetGroups));
    }
  }, [baseInfo, isEditing, presetGroups]);

  const summaryEntries = Object.entries(baseInfo ?? {});
  const customSummaryEntries = summaryEntries.filter(([field]) => !presetFieldSet.has(field));
  const customDraftRows = draftRows.filter((row) => !row.preset);
  const panelTheme = getBaseInfoPanelTheme(title);
  const totalPresetFieldCount = presetFields.length;
  const filledPresetFieldCount = countFilledPresetFields(baseInfo, presetGroups);
  const filledDraftPresetFieldCount = countFilledPresetDraftFields(draftRows, presetGroups);
  const completedGroupCount = presetGroups.filter((group) => group.fields.every((field) => isBaseInfoValueFilled(baseInfo?.[field.field]))).length;
  const completedDraftGroupCount = presetGroups.filter((group) => group.fields.every((field) => {
    const row = draftRows.find((item) => item.preset && item.field === field.field);
    return Boolean(row?.value.trim());
  })).length;
  const summaryHighlights = summaryEntries.slice(0, 4);
  const filledCustomFieldCount = customSummaryEntries.filter(([, value]) => isBaseInfoValueFilled(value)).length;
  const activeCustomDraftCount = customDraftRows.filter((row) => row.field.trim() || row.value.trim()).length;
  const heroTitle = isEditing ? "分组编辑" : summaryEntries.length > 0 ? "信息快照已建" : "等待补充关键信息";
  const heroDescription = isEditing
    ? "按分组逐项完善信息，保存后立即写入本地状态，并同步到用户偏好与记忆树。"
    : summaryEntries.length > 0
      ? "已形成可读性更强的资料分组卡片，便于快速查看当前企业/投资画像。"
      : emptyText;
  const statusMessage = isSaving ? "正在同步基本信息…" : saveSuccess;
  const statusColor = isSaving ? "#94A3B8" : "#10B981";

  const handleStartEditing = useCallback(() => {
    setDraftRows(createBaseInfoDraftRows(baseInfo, presetGroups));
    setIsEditing(true);
    setSaveError(null);
    setSaveSuccess(null);
  }, [baseInfo, presetGroups]);

  const handleCancel = useCallback(() => {
    setDraftRows(createBaseInfoDraftRows(baseInfo, presetGroups));
    setIsEditing(false);
    setSaveError(null);
  }, [baseInfo, presetGroups]);

  const handleRowChange = useCallback((rowId: string, field: "field" | "value", value: string) => {
    setDraftRows((previous) => previous.map((row) => row.id === rowId ? { ...row, [field]: value } : row));
  }, []);

  const handleAddRow = useCallback(() => {
    setDraftRows((previous) => [...previous, createCustomBaseInfoRow()]);
  }, []);

  const handleRemoveRow = useCallback((rowId: string) => {
    setDraftRows((previous) => {
      const removableRows = previous.filter((row) => !row.preset);
      if (removableRows.length <= 1) {
        return previous.map((row) => row.id === rowId ? createCustomBaseInfoRow() : row).filter((row) => row.preset || row.field || row.value);
      }
      return previous.filter((row) => row.id !== rowId);
    });
  }, []);

  const handleSave = useCallback(async () => {
    const nextBaseInfo = buildEditableBusinessInfo(draftRows);
    setIsEditing(false);
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      await onSave(nextBaseInfo);
      setSaveSuccess("已同步到用户偏好。");
    } catch (error) {
      setIsEditing(true);
      setSaveError(error instanceof Error ? error.message : "保存失败，请稍后重试。");
    } finally {
      setIsSaving(false);
    }
  }, [draftRows, onSave]);

  return (
    <div style={{ marginTop: "14px", paddingTop: "4px" }}>
      {!isEditing ? (
        <>
          <div style={{ position: "relative", overflow: "hidden", display: "grid", gap: "14px", padding: "18px", borderRadius: "24px", background: panelTheme.surface, border: `1px solid ${panelTheme.accentBorder}`, boxShadow: panelTheme.shadow, backdropFilter: "blur(18px)" }}>
            <div aria-hidden="true" style={{ position: "absolute", inset: "-40% auto auto -10%", width: "180px", height: "180px", borderRadius: "999px", background: panelTheme.accentSoft, filter: "blur(24px)", pointerEvents: "none" }} />
            <div style={{ position: "relative", display: "flex", flexWrap: "wrap", gap: "14px", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ display: "grid", gap: "8px", maxWidth: "560px" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", padding: "6px 10px", borderRadius: "999px", background: panelTheme.accentSoft, border: `1px solid ${panelTheme.accentBorder}`, color: panelTheme.accent, fontSize: "11px", fontWeight: 700, letterSpacing: "0.04em" }}>分组资料</span>
                  <span style={{ display: "inline-flex", alignItems: "center", padding: "6px 10px", borderRadius: "999px", background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)", color: "var(--t3)", fontSize: "11px" }}>{heroTitle}</span>
                </div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--t1)", lineHeight: 1.3 }}>{title}</div>
                <div style={{ fontSize: "13px", lineHeight: 1.75, color: "var(--t3)" }}>{heroDescription}</div>
              </div>
              <div style={{ minWidth: "156px", display: "grid", gap: "6px", padding: "14px 16px", borderRadius: "18px", background: "rgba(10, 14, 24, 0.22)", border: `1px solid ${panelTheme.accentBorder}` }}>
                <span style={{ fontSize: "11px", color: "var(--t3)", letterSpacing: "0.04em" }}>关键字段覆盖</span>
                <strong style={{ fontSize: "24px", lineHeight: 1, color: "var(--t1)" }}>{filledPresetFieldCount}/{totalPresetFieldCount}</strong>
                <span style={{ fontSize: "12px", color: "var(--t3)" }}>已沉淀 {summaryEntries.length} 项资料</span>
              </div>
            </div>
            <div style={{ position: "relative", display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
              {[
                { label: "已完成分组", value: `${completedGroupCount}/${presetGroups.length}`, helper: "核心结构完整度" },
                { label: "补充字段", value: `${filledCustomFieldCount}`, helper: "自定义延展信息" },
                { label: "同步路径", value: "本地 + 云端", helper: "保存后自动保持一致" },
              ].map((item) => (
                <div key={item.label} style={{ display: "grid", gap: "6px", padding: "14px", borderRadius: "18px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <span style={{ fontSize: "11px", color: "var(--t3)" }}>{item.label}</span>
                  <strong style={{ fontSize: "18px", color: "var(--t1)", lineHeight: 1.2 }}>{item.value}</strong>
                  <span style={{ fontSize: "12px", color: "var(--t3)", lineHeight: 1.5 }}>{item.helper}</span>
                </div>
              ))}
            </div>
            <div style={{ position: "relative", display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {summaryHighlights.length > 0 ? summaryHighlights.map(([field, value]) => (
                <div key={field} style={{ display: "inline-flex", alignItems: "center", gap: "8px", minHeight: "38px", padding: "8px 12px", borderRadius: "999px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", maxWidth: "100%" }}>
                  <span style={{ color: panelTheme.accent, fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap" }}>{field}</span>
                  <span style={{ color: "var(--t3)", fontSize: "12px", wordBreak: "break-word" }}>{formatEditableBusinessInfoValue(reformatBaseInfoValue(formatEditableBusinessInfoValue(value), presetFields.find(f => f.field === field && f.inputKind === "number")?.unit))}</span>
                </div>
              )) : (
                <div style={{ display: "inline-flex", alignItems: "center", minHeight: "38px", padding: "8px 12px", borderRadius: "999px", background: "rgba(255,255,255,0.04)", border: "1px dashed rgba(255,255,255,0.12)", color: "var(--t3)", fontSize: "12px" }}>暂无已保存字段，点击下方按钮开始录入</div>
              )}
            </div>
          </div>
          <div style={{ marginTop: "14px", display: "grid", gap: "14px" }}>
            {presetGroups.map((group) => (
              <div key={group.title} style={{ display: "grid", gap: "12px", padding: "16px", borderRadius: "22px", background: "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)", border: "1px solid var(--line)", boxShadow: "0 12px 28px rgba(0, 0, 0, 0.08)" }}>
                {(() => {
                  const filledCount = group.fields.filter((field) => isBaseInfoValueFilled(baseInfo?.[field.field])).length;
                  return (
                    <>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ display: "grid", gap: "4px", maxWidth: "560px" }}>
                          <div style={{ fontSize: "14px", color: "var(--t1)", fontWeight: 700 }}>{group.title}</div>
                          <div style={{ fontSize: "12px", color: "var(--t3)", lineHeight: 1.7 }}>{group.description}</div>
                        </div>
                        <span style={{ display: "inline-flex", alignItems: "center", padding: "6px 10px", borderRadius: "999px", background: filledCount > 0 ? panelTheme.accentSoft : "rgba(255,255,255,0.04)", border: `1px solid ${filledCount > 0 ? panelTheme.accentBorder : "rgba(255,255,255,0.08)"}`, color: filledCount > 0 ? panelTheme.accent : "var(--t3)", fontSize: "11px", fontWeight: 700 }}>{filledCount}/{group.fields.length} 已填</span>
                      </div>
                      <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                        {group.fields.map((field) => {
                          const filled = isBaseInfoValueFilled(baseInfo?.[field.field]);
                          return (
                            <div key={field.field} style={{ display: "grid", gap: "10px", minHeight: "132px", padding: "14px", borderRadius: "18px", background: filled ? panelTheme.fieldSurface : "rgba(255,255,255,0.03)", border: `1px solid ${filled ? panelTheme.accentBorder : "rgba(255,255,255,0.08)"}` }}>
                              <div style={{ display: "flex", gap: "10px", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div style={{ display: "grid", gap: "4px" }}>
                                  <span style={{ fontSize: "13px", color: "var(--t1)", fontWeight: 600 }}>{field.field}</span>
                                  <span style={{ fontSize: "11px", color: "var(--t3)" }}>{getBaseInfoInputTypeLabel(field.inputKind)}</span>
                                </div>
                                <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: "999px", background: filled ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)", color: filled ? panelTheme.accent : "var(--t3)", fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap" }}>{filled ? "已填" : "待补"}</span>
                              </div>
                              <div style={{ minHeight: "42px", display: "flex", alignItems: "flex-start" }}>
                                {renderBaseInfoValueContent(field.inputKind === "number" && field.unit ? reformatBaseInfoValue(formatEditableBusinessInfoValue(baseInfo?.[field.field]), field.unit) : baseInfo?.[field.field], field.inputKind, "start")}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
              </div>
            ))}
            {customSummaryEntries.length > 0 ? (
              <div style={{ display: "grid", gap: "12px", padding: "16px", borderRadius: "22px", background: "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)", border: "1px solid var(--line)", boxShadow: "0 12px 28px rgba(0, 0, 0, 0.08)" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ display: "grid", gap: "4px" }}>
                    <div style={{ fontSize: "14px", color: "var(--t1)", fontWeight: 700 }}>补充信息</div>
                    <div style={{ fontSize: "12px", color: "var(--t3)", lineHeight: 1.7 }}>保留自定义字段，继续同步到用户偏好与记忆树</div>
                  </div>
                  <span style={{ display: "inline-flex", alignItems: "center", padding: "6px 10px", borderRadius: "999px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--t3)", fontSize: "11px", fontWeight: 700 }}>{customSummaryEntries.length} 项扩展字段</span>
                </div>
                <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                  {customSummaryEntries.map(([field, value]) => (
                    <div key={field} style={{ display: "grid", gap: "8px", minHeight: "112px", padding: "14px", borderRadius: "18px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                      <div style={{ display: "flex", gap: "10px", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <span style={{ fontSize: "13px", color: "var(--t1)", fontWeight: 600 }}>{field}</span>
                        <span style={{ fontSize: "11px", color: "var(--t3)" }}>自定义字段</span>
                      </div>
                      <div style={{ minHeight: "42px", display: "flex", alignItems: "flex-start" }}>{renderBaseInfoValueContent(value, "text", "start")}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          {saveError ? <div role="alert" style={{ marginTop: "12px", fontSize: "12px", color: "var(--red)" }}>{saveError}</div> : null}
          {statusMessage ? <div aria-live="polite" role="status" style={{ marginTop: "12px", fontSize: "12px", color: statusColor }}>{statusMessage}</div> : null}
          <div className="br" style={{ marginTop: "12px" }}>
            <button type="button" className="bt bgh" onClick={handleStartEditing} disabled={isSaving}>{summaryEntries.length > 0 ? "编辑基本信息" : "填写基本信息"}</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ position: "relative", overflow: "hidden", display: "grid", gap: "14px", padding: "18px", borderRadius: "24px", background: panelTheme.surface, border: `1px solid ${panelTheme.accentBorder}`, boxShadow: panelTheme.shadow, backdropFilter: "blur(18px)" }}>
            <div aria-hidden="true" style={{ position: "absolute", inset: "auto -8% -36% auto", width: "180px", height: "180px", borderRadius: "999px", background: panelTheme.accentSoft, filter: "blur(26px)", pointerEvents: "none" }} />
            <div style={{ position: "relative", display: "flex", flexWrap: "wrap", gap: "14px", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ display: "grid", gap: "8px", maxWidth: "560px" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", padding: "6px 10px", borderRadius: "999px", background: panelTheme.accentSoft, border: `1px solid ${panelTheme.accentBorder}`, color: panelTheme.accent, fontSize: "11px", fontWeight: 700, letterSpacing: "0.04em" }}>编辑模式</span>
                  <span style={{ display: "inline-flex", alignItems: "center", padding: "6px 10px", borderRadius: "999px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--t3)", fontSize: "11px" }}>保存后自动补齐结构</span>
                </div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--t1)", lineHeight: 1.3 }}>{title}</div>
                <div style={{ fontSize: "13px", lineHeight: 1.75, color: "var(--t3)" }}>已按常用场景预置分组字段，数字、标签和多企业列表会以更清晰的方式保存与展示</div>
              </div>
              <div style={{ minWidth: "156px", display: "grid", gap: "6px", padding: "14px 16px", borderRadius: "18px", background: "rgba(10, 14, 24, 0.22)", border: `1px solid ${panelTheme.accentBorder}` }}>
                <span style={{ fontSize: "11px", color: "var(--t3)", letterSpacing: "0.04em" }}>当前填写进度</span>
                <strong style={{ fontSize: "24px", lineHeight: 1, color: "var(--t1)" }}>{filledDraftPresetFieldCount}/{totalPresetFieldCount}</strong>
                <span style={{ fontSize: "12px", color: "var(--t3)" }}>已激活 {activeCustomDraftCount} 项补充字段</span>
              </div>
            </div>
            <div style={{ position: "relative", display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
              {[
                { label: "完成分组", value: `${completedDraftGroupCount}/${presetGroups.length}`, helper: "逐组完善更清晰" },
                { label: "补充字段", value: `${activeCustomDraftCount}`, helper: "支持扩展记录" },
                { label: "同步动作", value: "即时更新", helper: "本地先更新后持久化" },
              ].map((item) => (
                <div key={item.label} style={{ display: "grid", gap: "6px", padding: "14px", borderRadius: "18px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <span style={{ fontSize: "11px", color: "var(--t3)" }}>{item.label}</span>
                  <strong style={{ fontSize: "18px", color: "var(--t1)", lineHeight: 1.2 }}>{item.value}</strong>
                  <span style={{ fontSize: "12px", color: "var(--t3)", lineHeight: 1.5 }}>{item.helper}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginTop: "14px", display: "grid", gap: "14px" }}>
            {presetGroups.map((group) => (
              <div key={group.title} style={{ display: "grid", gap: "12px", padding: "16px", borderRadius: "22px", background: "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)", border: "1px solid var(--line)", boxShadow: "0 12px 28px rgba(0, 0, 0, 0.08)" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ display: "grid", gap: "4px", maxWidth: "560px" }}>
                    <div style={{ fontSize: "14px", color: "var(--t1)", fontWeight: 700 }}>{group.title}</div>
                    <div style={{ fontSize: "12px", color: "var(--t3)", lineHeight: 1.7 }}>{group.description}</div>
                  </div>
                  <span style={{ display: "inline-flex", alignItems: "center", padding: "6px 10px", borderRadius: "999px", background: panelTheme.accentSoft, border: `1px solid ${panelTheme.accentBorder}`, color: panelTheme.accent, fontSize: "11px", fontWeight: 700 }}>
                    {group.fields.filter((field) => { const row = draftRows.find((item) => item.preset && item.field === field.field); return Boolean(row?.value.trim()); }).length}/{group.fields.length} 已填
                  </span>
                </div>
                <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))" }}>
                  {group.fields.map((field) => {
                    const row = draftRows.find((item) => item.preset && item.field === field.field);
                    if (!row) return null;
                    return (
                      <div key={row.id} style={{ display: "grid", gap: "10px", padding: "14px", borderRadius: "18px", background: row.value.trim() ? panelTheme.fieldSurface : "rgba(255,255,255,0.03)", border: `1px solid ${row.value.trim() ? panelTheme.accentBorder : "rgba(255,255,255,0.08)"}` }}>
                        <div style={{ display: "flex", gap: "10px", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div style={{ display: "grid", gap: "4px" }}>
                            <span style={{ color: "var(--t1)", fontSize: "13px", fontWeight: 600 }}>{field.field}</span>
                            <span style={{ color: "var(--t3)", fontSize: "11px" }}>{getBaseInfoInputTypeLabel(field.inputKind)}</span>
                          </div>
                          <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: "999px", background: "rgba(255,255,255,0.05)", color: row.value.trim() ? panelTheme.accent : "var(--t3)", fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap" }}>{row.value.trim() ? "已填" : "待填"}</span>
                        </div>
                        {field.inputKind === "number" ? (
                          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "8px", alignItems: "center" }}>
                            <input value={row.value} aria-label={`${title}${field.field}`} inputMode="decimal" placeholder={field.placeholder} onChange={(event) => handleRowChange(row.id, "value", event.target.value)} style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "12px", padding: "10px 12px", background: "var(--gl)", color: "var(--t1)" }} />
                            <span style={{ padding: "8px 10px", borderRadius: "10px", border: "1px solid var(--line)", background: "var(--gl)", color: "var(--t3)", fontSize: "12px" }}>{field.unit ?? "数值"}</span>
                          </div>
                        ) : (
                          <textarea value={row.value} aria-label={`${title}${field.field}`} placeholder={field.placeholder} rows={field.inputKind === "companies" ? 3 : 2} onChange={(event) => handleRowChange(row.id, "value", event.target.value)} style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "12px", padding: "10px 12px", background: "var(--gl)", color: "var(--t1)", resize: "vertical" }} />
                        )}
                        <div style={{ fontSize: "12px", color: "var(--t3)", lineHeight: 1.6 }}>{getBaseInfoInputHint(field.inputKind, field.unit)}</div>
                        {row.value.trim() ? (
                          <div style={{ padding: "10px 12px", borderRadius: "14px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                            <div style={{ fontSize: "11px", color: "var(--t3)", marginBottom: "6px" }}>保存后预览</div>
                            {renderBaseInfoValueContent(field.inputKind === "number" && field.unit ? `${row.value.trim()}${field.unit}` : row.value.trim(), field.inputKind, "start")}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <div style={{ display: "grid", gap: "12px", padding: "16px", borderRadius: "22px", background: "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)", border: "1px solid var(--line)", boxShadow: "0 12px 28px rgba(0, 0, 0, 0.08)" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "grid", gap: "4px" }}>
                  <div style={{ fontSize: "14px", color: "var(--t1)", fontWeight: 700 }}>补充信息</div>
                  <div style={{ fontSize: "12px", color: "var(--t3)", lineHeight: 1.7 }}>如需记录预置字段之外的信息，可继续添加自定义字段</div>
                </div>
                <span style={{ display: "inline-flex", alignItems: "center", padding: "6px 10px", borderRadius: "999px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--t3)", fontSize: "11px", fontWeight: 700 }}>{activeCustomDraftCount} 项待保存扩展信息</span>
              </div>
              <div style={{ display: "grid", gap: "12px" }}>
                {customDraftRows.length > 0 ? customDraftRows.map((row, index) => (
                  <div key={row.id} style={{ display: "grid", gap: "10px", padding: "14px", borderRadius: "18px", background: row.field.trim() || row.value.trim() ? panelTheme.fieldSurface : "rgba(255,255,255,0.03)", border: `1px solid ${row.field.trim() || row.value.trim() ? panelTheme.accentBorder : "rgba(255,255,255,0.08)"}` }}>
                    <div style={{ display: "flex", gap: "10px", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "var(--t1)", fontSize: "13px", fontWeight: 600 }}>补充字段 {index + 1}</span>
                      <span style={{ color: row.field.trim() || row.value.trim() ? panelTheme.accent : "var(--t3)", fontSize: "11px", fontWeight: 700 }}>{row.field.trim() || row.value.trim() ? "已编" : "空白"}</span>
                    </div>
                    <input value={row.field} aria-label={`${title}补充字段${index + 1}`} placeholder="例如：企业阶段/资产类别" onChange={(event) => handleRowChange(row.id, "field", event.target.value)} style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "12px", padding: "10px 12px", background: "var(--gl)", color: "var(--t1)" }} />
                    <textarea value={row.value} aria-label={`${title}补充内容${index + 1}`} placeholder="例如：扩产期，或输入多个标签" rows={2} onChange={(event) => handleRowChange(row.id, "value", event.target.value)} style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "12px", padding: "10px 12px", background: "var(--gl)", color: "var(--t1)", resize: "vertical" }} />
                    <div className="br"><button type="button" className="bt danger" onClick={() => handleRemoveRow(row.id)} disabled={isSaving}>删除字段</button></div>
                  </div>
                )) : <div style={{ fontSize: "12px", color: "var(--t3)" }}>暂无补充字段，可按需新增</div>}
              </div>
            </div>
          </div>
          {saveError ? <div role="alert" style={{ marginTop: "12px", fontSize: "12px", color: "var(--red)" }}>{saveError}</div> : null}
          <div style={{ marginTop: "14px", display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "space-between", alignItems: "center", padding: "16px 18px", borderRadius: "20px", background: "rgba(255,255,255,0.04)", border: "1px solid var(--line)" }}>
            <div style={{ display: "grid", gap: "4px" }}>
              <span style={{ fontSize: "13px", color: "var(--t3)", fontWeight: 600 }}>保存后立即更新当前界面，再异步同步持久化</span>
              <span style={{ fontSize: "12px", color: "var(--t3)", lineHeight: 1.6 }}>保留现有保存、同步与测试路径，支持后续记忆树和偏好数据联动</span>
            </div>
            <div className="br" style={{ marginTop: 0 }}>
              <button type="button" className="bt bgh" onClick={handleAddRow} disabled={isSaving}>新增补充字段</button>
              <button type="button" className="bt bgh" onClick={handleCancel} disabled={isSaving}>取消</button>
              <button type="button" className="bt bp" onClick={() => void handleSave()} disabled={isSaving}>{isSaving ? "保存中…" : "保存基本信息"}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
