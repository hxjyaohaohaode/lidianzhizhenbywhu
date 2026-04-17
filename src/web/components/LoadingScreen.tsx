import React from "react";

export function LoadingScreen({ onVideoEnd }: { onVideoEnd: () => void }) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [isFadingOut, setIsFadingOut] = React.useState(false);
  const minimumLoadingDuration = 10000;
  const startTimeRef = React.useRef(Date.now());

  const triggerEnd = React.useCallback(() => {
    const elapsed = Date.now() - startTimeRef.current;
    const remaining = minimumLoadingDuration - elapsed;
    if (remaining <= 0) {
      onVideoEnd();
    } else {
      setTimeout(onVideoEnd, remaining);
    }
  }, [onVideoEnd, minimumLoadingDuration]);

  React.useEffect(() => {
    const fallbackTimer = setTimeout(triggerEnd, 1500);
    return () => clearTimeout(fallbackTimer);
  }, [triggerEnd]);

  const handleVideoEnd = () => {
    setIsFadingOut(true);
    triggerEnd();
  };

  const handleCanPlay = () => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => {
        triggerEnd();
      });
    }
  };

  return (
    <div className={`video-loading-container${isFadingOut ? ' fade-out' : ''}`}>
      <h1 className="loading-brand">锂电智诊</h1>
      <video
        ref={videoRef}
        className="loading-video"
        src="/loading-video.mp4"
        onEnded={handleVideoEnd}
        onCanPlay={handleCanPlay}
        onError={triggerEnd}
        playsInline
        muted
      />
      <span className="video-loading-hint">正在加载系统</span>
    </div>
  );
}
