import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div style={{
          padding: 20,
          background: 'rgba(255,107,157,0.05)',
          border: '1px solid rgba(255,107,157,0.2)',
          borderRadius: 8,
          color: 'var(--t1)',
          fontSize: '0.9rem',
          textAlign: 'center',
        }}>
          <strong>图表渲染出错</strong>
          <p style={{ marginTop: 8, marginBottom: 0, opacity: 0.7 }}>{this.state.error?.message || '未知错误'}</p>
        </div>
      );
    }

    return this.props.children;
  }
}