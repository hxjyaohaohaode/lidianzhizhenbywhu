import React from "react";

export function LoadingScreen({ onVideoEnd }: { onVideoEnd: () => void }) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [isFadingOut, setIsFadingOut] = React.useState(false);
  const [videoError, setVideoError] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const progressRef = React.useRef(0);
  const hasEndedRef = React.useRef(false);

  const triggerEnd = React.useCallback(() => {
    if (hasEndedRef.current) return;
    hasEndedRef.current = true;
    setProgress(100);
    setIsFadingOut(true);
    setTimeout(onVideoEnd, 400);
  }, [onVideoEnd]);

  React.useEffect(() => {
    const fallbackTimer = setTimeout(() => {
      if (!hasEndedRef.current) {
        triggerEnd();
      }
    }, 15000);
    return () => clearTimeout(fallbackTimer);
  }, [triggerEnd]);

  React.useEffect(() => {
    if (videoError) {
      const interval = setInterval(() => {
        progressRef.current += 1;
        setProgress(progressRef.current);
        if (progressRef.current >= 100) {
          clearInterval(interval);
          triggerEnd();
        }
      }, 50);
      return () => clearInterval(interval);
    }
  }, [videoError, triggerEnd]);

  const handleVideoEnd = () => {
    triggerEnd();
  };

  const handleTimeUpdate = () => {
    if (videoRef.current && videoRef.current.duration > 0) {
      const pct = (videoRef.current.currentTime / videoRef.current.duration) * 100;
      progressRef.current = Math.min(pct, 100);
      setProgress(progressRef.current);
    }
  };

  const handleCanPlay = () => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => {
        setVideoError(true);
      });
    }
  };

  const handleVideoError = () => {
    setVideoError(true);
  };

  return (
    <div className={`video-loading-container${isFadingOut ? ' fade-out' : ''}`}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: '12px',
      }}>
        {!videoError && (
          <video
            ref={videoRef}
            className="loading-video"
            src="/loading-video.mp4"
            onEnded={handleVideoEnd}
            onTimeUpdate={handleTimeUpdate}
            onCanPlay={handleCanPlay}
            onError={handleVideoError}
            playsInline
            muted
            style={{
              width: 'min(17vh, 17vw)',
              height: 'min(17vh, 17vw)',
              objectFit: 'contain',
              borderRadius: '8px',
              boxShadow: '0 4px 20px rgba(79,107,246,0.15)',
            }}
          />
        )}

        {videoError && (
          <div style={{
            width: 'min(17vh, 17vw)',
            height: 'min(17vh, 17vw)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}>
            <img
              src="/images/logo.png"
              alt="锂电智诊"
              style={{
                width: '75px',
                height: '75px',
                borderRadius: '10px',
                boxShadow: '0 4px 16px rgba(79,107,246,0.2)',
                animation: 'logoPulse 2s ease-in-out infinite',
              }}
            />
            <div style={{
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              letterSpacing: '1px',
            }}>
              锂电智诊
            </div>
          </div>
        )}

        <div style={{
          width: 'min(23vh, 23vw)',
          maxWidth: '230px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '6px',
        }}>
          <div style={{
            width: '100%',
            height: '3px',
            borderRadius: '2px',
            background: 'rgba(79,107,246,0.12)',
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${progress}%`,
              height: '100%',
              borderRadius: '2px',
              background: 'linear-gradient(90deg, #4F6BF6, #7C5CFC)',
              transition: 'width 0.15s linear',
            }} />
          </div>
          <div style={{
            fontSize: '16px',
            fontWeight: 500,
            background: 'linear-gradient(90deg, #4F6BF6, #7C5CFC)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            letterSpacing: '0.5px',
          }}>
            {progress < 100 ? '系统加载中...' : '加载完成'}
          </div>
        </div>
      </div>
    </div>
  );
}
