import React, { useState, useRef, useCallback, useEffect } from 'react';

interface ChartZoomWrapperProps {
  children: React.ReactNode;
  className?: string;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.0;
const SCALE_STEP = 0.2;
const WHEEL_STEP = 0.1;

const ChartZoomWrapper: React.FC<ChartZoomWrapperProps> = ({ children, className }) => {
  const [scale, setScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [zoomLabelVisible, setZoomLabelVisible] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const zoomLabelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ distance: number; scale: number } | null>(null);

  const clampScale = useCallback((s: number) => {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(s * 100) / 100));
  }, []);

  const showZoomLabel = useCallback(() => {
    setZoomLabelVisible(true);
    if (zoomLabelTimerRef.current) clearTimeout(zoomLabelTimerRef.current);
    zoomLabelTimerRef.current = setTimeout(() => setZoomLabelVisible(false), 2000);
  }, []);

  const resetPanIfNeeded = useCallback((nextScale: number) => {
    if (nextScale <= 1) setPanOffset({ x: 0, y: 0 });
  }, []);

  const handleZoomIn = useCallback(() => {
    setScale(prev => {
      const next = clampScale(prev + SCALE_STEP);
      showZoomLabel();
      resetPanIfNeeded(next);
      return next;
    });
  }, [clampScale, showZoomLabel, resetPanIfNeeded]);

  const handleZoomOut = useCallback(() => {
    setScale(prev => {
      const next = clampScale(prev - SCALE_STEP);
      showZoomLabel();
      resetPanIfNeeded(next);
      return next;
    });
  }, [clampScale, showZoomLabel, resetPanIfNeeded]);

  const handleReset = useCallback(() => {
    setScale(1);
    setPanOffset({ x: 0, y: 0 });
    showZoomLabel();
  }, [showZoomLabel]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale(prev => {
      const delta = e.deltaY > 0 ? -WHEEL_STEP : WHEEL_STEP;
      const next = clampScale(prev + delta);
      showZoomLabel();
      resetPanIfNeeded(next);
      return next;
    });
  }, [clampScale, showZoomLabel, resetPanIfNeeded]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale <= 1) return;
    if (e.button !== 0) return;
    setIsPanning(true);
    panStartRef.current = { x: e.clientX, y: e.clientY, ox: panOffset.x, oy: panOffset.y };
  }, [scale, panOffset]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning || !panStartRef.current) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setPanOffset({ x: panStartRef.current.ox + dx, y: panStartRef.current.oy + dy });
  }, [isPanning]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    panStartRef.current = null;
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length >= 2) {
      const t0 = e.touches[0]!;
      const t1 = e.touches[1]!;
      const dx = t0.clientX - t1.clientX;
      const dy = t0.clientY - t1.clientY;
      touchStartRef.current = { distance: Math.sqrt(dx * dx + dy * dy), scale };
    }
  }, [scale]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length >= 2 && touchStartRef.current) {
      e.preventDefault();
      const t0 = e.touches[0]!;
      const t1 = e.touches[1]!;
      const dx = t0.clientX - t1.clientX;
      const dy = t0.clientY - t1.clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const ratio = distance / touchStartRef.current.distance;
      setScale(clampScale(touchStartRef.current.scale * ratio));
      showZoomLabel();
    }
  }, [clampScale, showZoomLabel]);

  const handleTouchEnd = useCallback(() => {
    touchStartRef.current = null;
  }, []);

  useEffect(() => {
    showZoomLabel();
    return () => {
      if (zoomLabelTimerRef.current) clearTimeout(zoomLabelTimerRef.current);
    };
  }, [showZoomLabel]);

  const contentWidth = scale * 100;
  const contentHeight = scale * 100;
  const percentLabel = `${Math.round(scale * 100)}%`;

  return (
    <div
      ref={containerRef}
      className={`chart-zoom-wrapper ${className ?? ''}`}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="chart-zoom-content" style={{
        width: `${contentWidth}%`,
        height: `${contentHeight}%`,
        transform: `translate(${panOffset.x}px, ${panOffset.y}px)`,
        transformOrigin: '0 0',
        transition: isPanning ? 'none' : 'width 200ms ease-out, height 200ms ease-out',
      }}>
        {children}
      </div>

      <div className="chart-zoom-controls">
        <button
          className="chart-zoom-btn chart-zoom-btn-minus"
          onClick={handleZoomOut}
          disabled={scale <= MIN_SCALE}
          aria-label="缩小"
        >−</button>
        <button
          className="chart-zoom-btn chart-zoom-btn-reset"
          onClick={handleReset}
          aria-label="重置缩放"
        >{percentLabel}</button>
        <button
          className="chart-zoom-btn chart-zoom-btn-plus"
          onClick={handleZoomIn}
          disabled={scale >= MAX_SCALE}
          aria-label="放大"
        >+</button>
      </div>

      <div className={`chart-zoom-label ${zoomLabelVisible ? 'chart-zoom-label-visible' : ''}`}>
        {percentLabel}
      </div>
    </div>
  );
};

export default ChartZoomWrapper;
