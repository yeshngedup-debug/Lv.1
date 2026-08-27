import React from 'react';
import { Radio, Video, Expand, ChevronRight, Volume2, MicOff, Bell, Eye } from 'lucide-react';

export const CameraFeedTile = React.memo(
  function CameraFeedTile({
    device,
    registerVideoElement,
    onClick,
    onListenToggle,
    listening,
    showListenLabel = false,
    motionAlert,
    motionEnabled,
    cameras = [],
    activeCameraId,
    onDismissMotion,
    onCycleCamera,
  }) {
    const camIdx = activeCameraId
      ? Math.max(
          0,
          cameras.findIndex((c) => c.id === activeCameraId),
        )
      : 0;
    const currentCamLabel = camIdx >= 0 && cameras[camIdx] ? cameras[camIdx].label : 'Default';

    return (
      <div className="camera-feed-box" onClick={() => onClick(device)}>
        <video
          ref={(el) => registerVideoElement(device.id, el, 'grid')}
          autoPlay
          playsInline
          muted
          className="camera-feed-video"
          onError={() => console.error(`Video error for ${device.nickname}`)}
        />

        <div className="tile-top-bar">
          {cameras.length > 1 &&
            (onCycleCamera ? (
              <span
                className="camera-switch-indicator"
                title="Click to cycle cameras"
                onClick={(e) => {
                  e.stopPropagation();
                  onCycleCamera(device, 1);
                }}
              >
                {onDismissMotion !== undefined && (
                  <span className="cam-label">{currentCamLabel}</span>
                )}
                <ChevronRight size={12} style={{ color: 'var(--accent-magenta)' }} />
              </span>
            ) : (
              <span className="tile-cam-count">
                CAM {camIdx + 1}/{cameras.length}
              </span>
            ))}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onListenToggle(device.id);
            }}
            className={`tile-mic-btn ${listening ? 'on' : ''}`}
            title={listening ? 'Mute device microphone' : 'Listen to device microphone'}
          >
            {listening ? <Volume2 size={14} /> : <MicOff size={14} />}
          </button>
          {showListenLabel && listening && <span className="tile-listen-label">LISTEN</span>}
        </div>

        <div className="tile-expand-hint">
          <Expand size={16} />
          <span>Zoom</span>
        </div>

        <div className="camera-feed-bar">
          <span style={{ fontWeight: 600 }}>{device.nickname}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {motionAlert && (
              <div
                className="motion-alert-badge"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismissMotion(device.id);
                }}
                title="Click to dismiss"
              >
                <Bell size={12} />
                <span>MOTION</span>
              </div>
            )}
            {motionEnabled && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDismissMotion(device.id);
                }}
                className="tile-motion-btn"
                title="Motion detection enabled"
              >
                <Eye size={12} />
              </button>
            )}
            <span className="live-indicator-pill">
              <span className="live-dot-pulse" />
              LIVE
            </span>
          </div>
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.device.id === next.device.id &&
    prev.listening === next.listening &&
    prev.showListenLabel === next.showListenLabel &&
    prev.motionAlert === next.motionAlert &&
    prev.motionEnabled === next.motionEnabled &&
    prev.activeCameraId === next.activeCameraId,
);
