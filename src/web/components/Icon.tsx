import React, { useState, useCallback, useRef } from 'react';

export interface IconProps {
  name: 'home' | 'analysis' | 'settings' | 'memory' | 'enterprise' | 'investor';
  size?: number;
  color?: string;
  className?: string;
  active?: boolean;
  hoverable?: boolean;
}

interface RippleButtonProps {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

const iconPaths: Record<string, string> = {
  home: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  analysis: 'M3 3v18h18M7 16l4-4 4 4 5-6',
  settings: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  memory: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
  enterprise: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  investor: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
};

const pulseKeyframes = `@keyframes iconPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.85; transform: scale(1.08); }
}`;

const rippleKeyframes = `@keyframes rippleExpand {
  0% { transform: scale(0); opacity: 0.5; }
  100% { transform: scale(4); opacity: 0; }
}`;

if (typeof document !== 'undefined') {
  const existingStyle = document.getElementById('icon-component-styles');
  if (!existingStyle) {
    const style = document.createElement('style');
    style.id = 'icon-component-styles';
    style.textContent = pulseKeyframes + rippleKeyframes;
    document.head.appendChild(style);
  }
}

export const Icon: React.FC<IconProps> = ({
  name,
  size = 22,
  color,
  className,
  active = false,
  hoverable = false,
}) => {
  const resolvedColor = color || (active ? 'var(--blue)' : 'currentColor');

  const containerStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    color: resolvedColor,
    transition: hoverable ? 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.2s ease' : undefined,
    animation: active ? 'iconPulse 2s ease-in-out infinite' : undefined,
    cursor: hoverable ? 'pointer' : undefined,
    flexShrink: 0,
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    if (hoverable) {
      (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.15) translateY(-2px)';
    }
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    if (hoverable) {
      (e.currentTarget as HTMLDivElement).style.transform = 'scale(1) translateY(0)';
    }
  };

  return (
    <div
      className={className}
      style={containerStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={iconPaths[name]} />
      </svg>
    </div>
  );
};

interface RippleState {
  id: number;
  x: number;
  y: number;
  size: number;
}

export const RippleButton: React.FC<RippleButtonProps> = ({ children, onClick }) => {
  const [ripples, setRipples] = useState<RippleState[]>([]);
  const counterRef = useRef(0);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const size = Math.max(rect.width, rect.height) * 2;
      const id = counterRef.current++;

      setRipples((prev) => [...prev, { id, x, y, size }]);

      setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.id !== id));
      }, 600);

      onClick?.(e);
    },
    [onClick]
  );

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    overflow: 'hidden',
    display: 'inline-flex',
    cursor: 'pointer',
  };

  return (
    <div style={containerStyle} onClick={handleClick}>
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          style={{
            position: 'absolute',
            left: ripple.x - ripple.size / 2,
            top: ripple.y - ripple.size / 2,
            width: ripple.size,
            height: ripple.size,
            borderRadius: '50%',
            backgroundColor: 'var(--blue)',
            opacity: 0.3,
            animation: 'rippleExpand 0.6s ease-out forwards',
            pointerEvents: 'none',
          }}
        />
      ))}
      {children}
    </div>
  );
};

export default Icon;
