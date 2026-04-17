import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  writePrivateMemory,
  updatePrivateMemory,
  deletePrivateMemory,
} from "../api.js";
import type {
  PrivateMemoryUpdateRequest,
  UserProfileResponse,
} from "../../shared/business.js";
import {
  type RoleKey,
  type MemoryNode,
  roleKeyToPreference,
  splitInputTags,
  formatAbsoluteTime,
  buildMemoryNodes,
} from "../utils/helpers.js";
import {
  createMemoryVisualObjectCounts,
  resolveMemoryVisualProfile,
  type MemoryVisualMode,
} from "../memory-performance.js";

const MemoryBackgroundCanvas = React.memo(function MemoryBackgroundCanvas({
  viewportRef,
  isDark,
  themeIndex,
  interactionActiveRef,
}: {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  isDark: boolean;
  themeIndex: number;
  interactionActiveRef: React.MutableRefObject<boolean>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [, setProfileMode] = useState<MemoryVisualMode>('startup');

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    let cx: CanvasRenderingContext2D | null = null;
    try {
      cx = cv.getContext('2d');
    } catch {
      cx = null;
    }
    if (!cx) return;

    const scheduleFrame = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 16);
    const cancelFrame = typeof window.cancelAnimationFrame === 'function'
      ? window.cancelAnimationFrame.bind(window)
      : window.clearTimeout.bind(window);
    const reducedMotionMedia = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    const themePalette = [
      { bg: ['#060913', '#0a1024', '#120d2b'], ribbon: 230, nebula: 260, ambient: 240 }, // 深邃星空蓝紫
      { bg: ['#041114', '#081d22', '#0a2620'], ribbon: 175, nebula: 160, ambient: 180 }, // 极光翠绿
      { bg: ['#140b05', '#1e1107', '#2a160a'], ribbon: 38, nebula: 22, ambient: 45 },    // 流光溢彩      { bg: ['#140612', '#1d0a1b', '#260e24'], ribbon: 320, nebula: 335, ambient: 310 }, // 幻梦霓虹粉紫
    ][themeIndex] ?? { bg: ['#060913', '#0a1024', '#120d2b'], ribbon: 230, nebula: 260, ambient: 240 };

    const runtime = {
      booting: true,
      isVisible: document.visibilityState !== 'hidden',
      prefersReducedMotion: reducedMotionMedia?.matches ?? false,
      devicePixelRatio: window.devicePixelRatio || 1,
    };

    const currentProfile = resolveMemoryVisualProfile({
      isDark,
      isVisible: runtime.isVisible,
      devicePixelRatio: runtime.devicePixelRatio,
      prefersReducedMotion: runtime.prefersReducedMotion,
      interactionActive: interactionActiveRef.current,
      booting: runtime.booting,
    });
    void currentProfile;
    let rafId = 0;
    let bootTimer = 0;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let lastFrameAt = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let time = 0;
    const pointerX = 0;
    const pointerY = 0;
    const scrollX = 0;
    const scrollY = 0;
    const shootingStarCooldown = 0;
    void pointerX; void pointerY; void scrollX; void scrollY; void shootingStarCooldown;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const ribbons: Array<{
      hue: number;
      phase: number;
      amplitude: number;
      width: number;
      drift: number;
      depth: number;
    }> = [];
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const sparkles: Array<{
      ribbonIndex: number;
      t: number;
      speed: number;
      spread: number;
      size: number;
      alpha: number;
      bright: boolean;
      phase: number;
      trail: number;
    }> = [];
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const clouds: Array<{
      x: number;
      y: number;
      scale: number;
      speed: number;
    }> = [];
    const shootingStars: Array<{ x: number; y: number; vx: number; vy: number; life: number; maxLife: number; length: number }> = [];
    void shootingStars;
    let allocatedObjects = createMemoryVisualObjectCounts();
    const allocationTimer = 0;
    void allocationTimer;

    const stars: Array<{
      x: number;
      y: number;
      size: number;
      alpha: number;
      delta: number;
      warm: boolean;
      angle: number;
    }> = [];
    const nebulae: Array<{
      x: number;
      y: number;
      radius: number;
      hue: number;
      alpha: number;
      drift: number;
      pulse: number;
      offset: number;
    }> = [];

    const ensureCollection = <T,>(collection: T[], target: number, factory: (index: number) => T) => {
      while (collection.length < target) {
        collection.push(factory(collection.length));
      }
    };

    const applyObjectAllocation = (nextCounts: typeof allocatedObjects) => {
      ensureCollection(stars, nextCounts.stars, () => ({
        x: Math.random() * 2800,
        y: Math.random() * 1800,
        size: Math.random() * 1.8 + 0.3,
        alpha: Math.random() * 0.6 + 0.15,
        delta: (Math.random() - 0.5) * 0.006,
        warm: Math.random() > 0.55,
        angle: Math.random() * Math.PI * 2,
      }));
      ensureCollection(nebulae, nextCounts.nebulae, (index) => ({
        x: Math.random(),
        y: Math.random(),
        radius: 160 + Math.random() * 180,
        hue: themePalette.nebula + index * 8 + Math.random() * 18,
        alpha: 0.06 + Math.random() * 0.08,
        drift: 0.02 + Math.random() * 0.04,
        pulse: 0.25 + Math.random() * 0.2,
        offset: Math.random() * Math.PI * 2,
      }));
    };

    const render = (timestamp: number) => {
      if (!cx) return;
      const dt = lastFrameAt > 0 ? (timestamp - lastFrameAt) / 1000 : 0.016;
      time += dt;
      lastFrameAt = timestamp;

      if (runtime.booting) {
        bootTimer += dt;
        if (bootTimer >= 2.0) {
          runtime.booting = false;
          setProfileMode('balanced');
        }
      }

      const nextProfile = resolveMemoryVisualProfile({
        isDark,
        isVisible: runtime.isVisible,
        devicePixelRatio: runtime.devicePixelRatio,
        prefersReducedMotion: runtime.prefersReducedMotion,
        interactionActive: interactionActiveRef.current,
        booting: runtime.booting,
      });

      const nextObjects = {
        stars: nextProfile.stars,
        nebulae: nextProfile.nebulae,
        ribbons: nextProfile.ribbons,
        sparkles: nextProfile.sparkles,
        clouds: nextProfile.clouds,
      };

      if (JSON.stringify(nextObjects) !== JSON.stringify(allocatedObjects)) {
        allocatedObjects = nextObjects;
        applyObjectAllocation(allocatedObjects);
      }

      const viewport = viewportRef.current;
      const viewportWidth = viewport?.clientWidth || window.innerWidth || 1280;
      const viewportHeight = viewport?.clientHeight || window.innerHeight || 720;

      if (width !== viewportWidth || height !== viewportHeight || pixelRatio !== runtime.devicePixelRatio) {
        width = viewportWidth;
        height = viewportHeight;
        pixelRatio = runtime.devicePixelRatio;
        cv.width = width * pixelRatio;
        cv.height = height * pixelRatio;
        cv.style.width = `${width}px`;
        cv.style.height = `${height}px`;
        cx.scale(pixelRatio, pixelRatio);
      }

      cx.fillStyle = themePalette.bg[0] || '#060913';
      cx.fillRect(0, 0, width, height);

      for (const nebula of nebulae) {
        const nx = nebula.x * width;
        const ny = nebula.y * height;
        const gradient = cx.createRadialGradient(nx, ny, 0, nx, ny, nebula.radius);
        gradient.addColorStop(0, `hsla(${nebula.hue}, 60%, 50%, ${nebula.alpha * 0.8})`);
        gradient.addColorStop(0.7, `hsla(${nebula.hue}, 40%, 30%, ${nebula.alpha * 0.3})`);
        gradient.addColorStop(1, 'transparent');
        cx.fillStyle = gradient;
        cx.beginPath();
        cx.arc(nx, ny, nebula.radius, 0, Math.PI * 2);
        cx.fill();
        nebula.x = (nebula.x + nebula.drift * dt * 0.02) % 1;
        nebula.y = (nebula.y + nebula.drift * dt * 0.01) % 1;
      }

      for (const star of stars) {
        star.alpha = Math.max(0.15, Math.min(0.75, star.alpha + star.delta));
        if (star.alpha <= 0.15 || star.alpha >= 0.75) star.delta *= -1;
        cx.fillStyle = `rgba(${star.warm ? '255, 220, 180' : '220, 240, 255'}, ${star.alpha})`;
        cx.beginPath();
        cx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        cx.fill();
      }

      rafId = scheduleFrame(render);
    };

    rafId = scheduleFrame(render);

    return () => {
      cancelFrame(rafId);
    };
  }, [isDark, interactionActiveRef, themeIndex, viewportRef]);

  return (
    <div className="memory-background" />
  );
});

const MemoryTreeLayer = React.memo(function MemoryTreeLayer({
  nodes,
  onSelect,
}: {
  nodes: MemoryNode[];
  centerNode: MemoryNode | undefined;
  onSelect: (node: MemoryNode) => void;
}) {
  return (
    <div className="memory-tree">
      {nodes.map((node) => (
        <div
          key={node.id}
          className={`tn ${node.c ? 'ct' : `l${node.level || 1}`} ${node.nodeType || ''}`}
          style={{
            left: node.x,
            top: node.y,
          }}
          onClick={() => onSelect(node)}
        >
          <div className="ti">{node.ic}</div>
          <div className="tt">{node.t}</div>
          <div className="tp2">{node.p}</div>
        </div>
      ))}
    </div>
  );
});

const MemoryNodeDialog = React.memo(function MemoryNodeDialog({
  dialogMode,
  selectedNode,
  draftTitle,
  draftContent,
  draftTags,
  isSaving,
  isDeleting,
  errorMessage,
  onDraftTitleChange,
  onDraftContentChange,
  onDraftTagsChange,
  onClose,
  onStartEdit,
  onSave,
  onDelete,
}: {
  dialogMode: "view" | "create" | "edit" | null;
  selectedNode: MemoryNode | null;
  draftTitle: string;
  draftContent: string;
  draftTags: string;
  isSaving: boolean;
  isDeleting: boolean;
  errorMessage: string | null;
  onDraftTitleChange: (value: string) => void;
  onDraftContentChange: (value: string) => void;
  onDraftTagsChange: (value: string) => void;
  onClose: () => void;
  onStartEdit: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  if (!dialogMode) return null;

  const isViewMode = dialogMode === "view";
  const isCreateMode = dialogMode === "create";
  const isEditMode = dialogMode === "edit";

  return (
    <div className={`ndo ${dialogMode ? 'on' : ''}`} onClick={onClose}>
      <div className="nd" onClick={(e) => e.stopPropagation()}>
        <div className="memory-node-dialog-header">
          <h3>{isCreateMode ? '新增记忆' : isEditMode ? '编辑记忆' : '节点详情'}</h3>
          <button className="memory-node-dialog-close" onClick={onClose}>×</button>
        </div>
        <div className="memory-node-dialog-content">
          {errorMessage && (
            <div className="memory-node-dialog-error">{errorMessage}</div>
          )}
          {isViewMode ? (
            <div className="memory-node-dialog-view">
              <div className="memory-node-dialog-view-item">
                <strong>标题:</strong> {selectedNode?.t || '无标题'}
              </div>
              <div className="memory-node-dialog-view-item">
                <strong>内容:</strong> {selectedNode?.p || '无内容'}
              </div>
              {selectedNode?.nodeType === 'memory' && (
                <div className="memory-node-dialog-view-actions">
                  <button className="cd" onClick={onStartEdit}>
                    编辑
                  </button>
                  <button className="cd danger" onClick={onDelete} disabled={isDeleting}>
                    {isDeleting ? '删除中...' : '删除'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="memory-node-dialog-form">
              <div className="memory-node-dialog-form-group">
                <label>记忆摘要</label>
                <input
                  type="text"
                  value={draftTitle}
                  onChange={(e) => onDraftTitleChange(e.target.value)}
                  placeholder="请输入记忆摘要"
                />
              </div>
              <div className="memory-node-dialog-form-group">
                <label>详细内容</label>
                <textarea
                  value={draftContent}
                  onChange={(e) => onDraftContentChange(e.target.value)}
                  placeholder="请输入详细内容"
                  rows={6}
                />
              </div>
              <div className="memory-node-dialog-form-group">
                <label>标签(用顿号分隔)</label>
                <input
                  type="text"
                  value={draftTags}
                  onChange={(e) => onDraftTagsChange(e.target.value)}
                  placeholder="例如:企业、投资、分析"
                />
              </div>
            </div>
          )}
        </div>
        {!isViewMode && (
          <div className="memory-node-dialog-footer">
            <button className="cd" onClick={onClose}>
              取消
            </button>
            <button
              className="cd primary"
              onClick={onSave}
              disabled={isSaving}
            >
              {isSaving ? '保存中...' : '保存'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
export function MemoryScreen({
  onClose,
  role,
  isDark,
  themeIndex,
  userProfile,
  currentUserId,
  refreshUserProfile,
}: {
  onClose: () => void;
  role: RoleKey | null;
  isDark: boolean;
  themeIndex: number;
  userProfile: UserProfileResponse | null;
  currentUserId: string | null;
  refreshUserProfile: (userId?: string) => Promise<UserProfileResponse | null>;
}) {
  const vpRef = useRef<HTMLDivElement>(null);
  const dragActiveRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, sl: 0, st: 0 });
  const interactionActiveRef = useRef(false);
  const interactionTimerRef = useRef<number | null>(null);
  const hasCenteredRef = useRef(false);
  const [selectedNode, setSelectedNode] = useState<MemoryNode | null>(null);
  const [dialogMode, setDialogMode] = useState<"view" | "create" | "edit" | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState(() => new Date().toISOString());

  const nodes = React.useMemo(() => buildMemoryNodes(role, userProfile, isDark, themeIndex), [isDark, role, themeIndex, userProfile]);
  const centerNode = React.useMemo(() => nodes.find((node) => node.c), [nodes]);
  const stageMetrics = React.useMemo(() => {
    const width = Math.max(2400, ...nodes.map((node) => node.x + (node.c ? 320 : node.level === 2 ? 240 : 280)));
    const height = Math.max(2400, ...nodes.map((node) => node.y + (node.c ? 260 : node.level === 2 ? 200 : 240)));
    return { width, height };
  }, [nodes]);

  const keepInteractionWarm = useCallback(() => {
    interactionActiveRef.current = true;
    if (interactionTimerRef.current) {
      window.clearTimeout(interactionTimerRef.current);
    }
    interactionTimerRef.current = window.setTimeout(() => {
      interactionActiveRef.current = false;
    }, 180);
  }, []);

  const [transform, setTransform] = useState({ x: -400, y: -400, scale: 0.62 });

  useEffect(() => {
    return () => {
      if (interactionTimerRef.current) {
        window.clearTimeout(interactionTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!currentUserId) {
      return;
    }
    const syncNow = async () => {
      try {
        const profile = await refreshUserProfile(currentUserId);
        if (profile) {
          setLastSyncAt(new Date().toISOString());
        }
      } catch {
        // noop
      }
    };
    void syncNow();
    const timer = window.setInterval(() => {
      void syncNow();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [currentUserId, refreshUserProfile]);

  useEffect(() => {
    if (!centerNode || !vpRef.current || hasCenteredRef.current) {
      return;
    }
    const viewport = vpRef.current;
    const viewportRect = viewport.getBoundingClientRect();
    const viewportWidth = viewport.clientWidth || viewportRect.width || window.innerWidth || 1280;
    const viewportHeight = viewport.clientHeight || viewportRect.height || window.innerHeight || 720;
    const nextScale = 0.62;
    const centerX = centerNode.x + 120;
    const centerY = centerNode.y + 92;
    setTransform({
      x: viewportWidth / 2 - centerX * nextScale,
      y: viewportHeight / 2 - centerY * nextScale,
      scale: nextScale,
    });
    hasCenteredRef.current = true;
  }, [centerNode]);

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.tn')) {
      return;
    }

    dragActiveRef.current = true;
    dragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      sl: transform.x,
      st: transform.y,
    };
    keepInteractionWarm();
  }, [keepInteractionWarm, transform.x, transform.y]);

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!dragActiveRef.current) {
      return;
    }

    setTransform(prev => ({
      ...prev,
      x: dragStartRef.current.sl + (event.clientX - dragStartRef.current.x),
      y: dragStartRef.current.st + (event.clientY - dragStartRef.current.y)
    }));
    keepInteractionWarm();
  }, [keepInteractionWarm]);

  const handleMouseUp = useCallback(() => {
    dragActiveRef.current = false;
    keepInteractionWarm();
  }, [keepInteractionWarm]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!vpRef.current) return;

    const scaleChange = event.deltaY > 0 ? 0.9 : 1.1;
    
    setTransform(prev => {
      const nextScale = Math.max(0.2, Math.min(prev.scale * scaleChange, 3));
      
      // Calculate cursor position relative to the viewport
      const rect = vpRef.current!.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      
      // Calculate how much we need to pan to keep the cursor over the same point
      const ratio = nextScale / prev.scale;
      const nextX = cursorX - (cursorX - prev.x) * ratio;
      const nextY = cursorY - (cursorY - prev.y) * ratio;

      return {
        x: nextX,
        y: nextY,
        scale: nextScale
      };
    });
    
    keepInteractionWarm();
  }, [keepInteractionWarm]);

  const handleNodeSelect = useCallback((node: MemoryNode) => {
    keepInteractionWarm();
    setErrorMessage(null);
    setSelectedNode(node);
    setDialogMode("view");
  }, [keepInteractionWarm]);

  const handleDialogClose = useCallback(() => {
    keepInteractionWarm();
    setSelectedNode(null);
    setDialogMode(null);
    setDraftTitle("");
    setDraftContent("");
    setDraftTags("");
    setErrorMessage(null);
  }, [keepInteractionWarm]);

  const handleCreateMemory = useCallback(() => {
    keepInteractionWarm();
    setSelectedNode(null);
    setDraftTitle("");
    setDraftContent("");
    setDraftTags(role === "e" ? "enterprise" : "investor");
    setErrorMessage(null);
    setDialogMode("create");
  }, [keepInteractionWarm, role]);

  const handleStartEdit = useCallback(() => {
    if (!selectedNode || selectedNode.nodeType !== "memory") {
      return;
    }
    keepInteractionWarm();
    setDraftTitle(selectedNode.memorySummary ?? "");
    setDraftContent(selectedNode.memoryDetails ?? "");
    setDraftTags((selectedNode.memoryTags ?? []).join("、"));
    setErrorMessage(null);
    setDialogMode("edit");
  }, [keepInteractionWarm, selectedNode]);

  const handleManualRefresh = useCallback(async () => {
    keepInteractionWarm();
    if (!currentUserId) {
      return;
    }
    try {
      const profile = await refreshUserProfile(currentUserId);
      if (profile) {
        setLastSyncAt(new Date().toISOString());
      }
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "刷新失败，请稍后再试。");
    }
  }, [currentUserId, keepInteractionWarm, refreshUserProfile]);

  const handleSaveMemory = useCallback(async () => {
    if (!currentUserId) {
      setErrorMessage("当前用户未初始化，暂时无法保存记忆。");
      return;
    }
    const payloadTags = splitInputTags(draftTags).slice(0, 8);
    const normalizedTitle = draftTitle.trim();
    const normalizedContent = draftContent.trim();
    if (!normalizedTitle || !normalizedContent) {
      setErrorMessage("请先填写记忆摘要和详细内容。");
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      if (dialogMode === "edit" && selectedNode?.memoryId) {
        const payload: PrivateMemoryUpdateRequest = {
          userId: currentUserId,
          title: normalizedTitle,
          content: normalizedContent,
          tags: payloadTags,
        };
        await updatePrivateMemory(selectedNode.memoryId, payload);
      } else {
        await writePrivateMemory({
          userId: currentUserId,
          role: role ? roleKeyToPreference(role) : "investor",
          title: normalizedTitle,
          content: normalizedContent,
          tags: payloadTags,
        });
      }
      await refreshUserProfile(currentUserId);
      setLastSyncAt(new Date().toISOString());
      handleDialogClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存失败，请稍后重试。");
    } finally {
      setIsSaving(false);
    }
  }, [currentUserId, dialogMode, draftContent, draftTags, draftTitle, handleDialogClose, refreshUserProfile, role, selectedNode?.memoryId]);

  const handleDeleteMemory = useCallback(async () => {
    if (!currentUserId || !selectedNode?.memoryId) {
      return;
    }
    setIsDeleting(true);
    setErrorMessage(null);
    try {
      await deletePrivateMemory(selectedNode.memoryId, currentUserId);
      await refreshUserProfile(currentUserId);
      setLastSyncAt(new Date().toISOString());
      handleDialogClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "删除失败，请稍后重试。");
    } finally {
      setIsDeleting(false);
    }
  }, [currentUserId, handleDialogClose, refreshUserProfile, selectedNode?.memoryId]);

  return (
    <>
      <MemoryBackgroundCanvas viewportRef={vpRef} isDark={isDark} themeIndex={themeIndex} interactionActiveRef={interactionActiveRef} />
      <div className="mct">
        <div className="mtb">
          <button className="mbk" onClick={onClose}>← 返回</button>
          <div className="memory-toolbar-title">
            <span>记忆中的你</span>
            <small>已同步至 {formatAbsoluteTime(lastSyncAt)}</small>
          </div>
          <div className="memory-toolbar-actions">
            <button className="memory-action" onClick={() => void handleManualRefresh()}>刷新</button>
            <button className="memory-action primary" onClick={handleCreateMemory}>新增记忆</button>
          </div>
        </div>
        <div
          className="mvp"
          ref={vpRef}
          id="mvp"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          <div
            className="mtsg"
            style={{
              transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
              transformOrigin: '0 0',
              width: `${stageMetrics.width}px`,
              height: `${stageMetrics.height}px`,
              position: 'absolute',
              top: 0,
              left: 0,
            }}
          >
            <MemoryTreeLayer nodes={nodes} centerNode={centerNode} onSelect={handleNodeSelect} />
          </div>
          {/* Minimap */}
          <div
            className="memory-minimap"
            style={{
              position: 'absolute',
              right: 24,
              bottom: 24,
              width: 200,
              height: 150,
              backgroundColor: isDark ? 'rgba(0, 0, 0, 0.4)' : 'rgba(255, 255, 255, 0.4)',
              border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'}`,
              borderRadius: 8,
              overflow: 'hidden',
              pointerEvents: 'none',
              zIndex: 50,
              backdropFilter: 'blur(4px)',
            }}
          >
            {nodes.map(node => (
              <div
                key={node.id}
                style={{
                  position: 'absolute',
                  left: node.x * (200 / stageMetrics.width),
                  top: node.y * (150 / stageMetrics.height),
                  width: node.c ? 6 : 4,
                  height: node.c ? 6 : 4,
                  backgroundColor: node.c ? '#4f46e5' : isDark ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.5)',
                  borderRadius: '50%',
                  transform: 'translate(-50%, -50%)',
                }}
              />
            ))}
            {vpRef.current && (
              <div
                style={{
                  position: 'absolute',
                  left: (-transform.x / transform.scale) * (200 / stageMetrics.width),
                  top: (-transform.y / transform.scale) * (150 / stageMetrics.height),
                  width: (vpRef.current.clientWidth / transform.scale) * (200 / stageMetrics.width),
                  height: (vpRef.current.clientHeight / transform.scale) * (150 / stageMetrics.height),
                  border: `2px solid ${isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)'}`,
                  backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                  boxSizing: 'border-box',
                }}
              />
            )}
          </div>
        </div>
      </div>
      <MemoryNodeDialog
        dialogMode={dialogMode}
        selectedNode={selectedNode}
        draftTitle={draftTitle}
        draftContent={draftContent}
        draftTags={draftTags}
        isSaving={isSaving}
        isDeleting={isDeleting}
        errorMessage={errorMessage}
        onDraftTitleChange={setDraftTitle}
        onDraftContentChange={setDraftContent}
        onDraftTagsChange={setDraftTags}
        onClose={handleDialogClose}
        onStartEdit={handleStartEdit}
        onSave={() => void handleSaveMemory()}
        onDelete={() => void handleDeleteMemory()}
      />
    </>
  );
}