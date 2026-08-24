import React from 'react';
import { Video, Speaker, Maximize2, Trash2, Eye, BellOff } from 'lucide-react';

export const DeviceCard = React.memo(function DeviceCard({
  device,
  isSelected,
  onClick,
  onVolumeChange,
  volume,
  registerVideoElement,
  setFullscreenDevice,
  removeDevice,
  motionDetectionEnabled,
  setMotionDetectionEnabled,
  peerConnectionsRef
}) {
  const isCamera = device.role === 'camera' || (device.role === 'device' && device.isCameraEnabled);
  const isSpeaker = device.role === 'speaker' || (device.role === 'device' && device.isSpeakerEnabled);
  const isCombined = device.role === 'device';
  const pc = peerConnectionsRef?.current?.get(device.id);
  const isConnected = pc?.connectionState === 'connected';

  return (
    <article
      className={`device-card ${isSelected ? 'selected' : ''} ${isCombined ? 'combined' : (isCamera ? 'camera' : 'speaker')}`}
      onClick={onClick}
      data-device-id={device.id}
    >
      <div className="device-card-header">
        <div className="device-avatar">
          {isCombined ? (
            <span className="combined-avatar">
              <Video size={16} />
              <Speaker size={12} />
            </span>
          ) : isCamera ? (
            <Video size={18} />
          ) : (
            <Speaker size={18} />
          )}
        </div>
        <div className="device-meta">
          <h3 className="device-name">{device.nickname}</h3>
          <div className="device-status">
            <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}></span>
            <span className={`device-role-badge ${isCombined ? 'combined' : (isCamera ? 'camera' : 'speaker')}`}>
              {isCombined ? 'Device' : (isCamera ? 'Camera' : 'Speaker')}
            </span>
          </div>
        </div>
      </div>

      {isSelected && isCamera && (
        <div className="device-preview">
          <video
            ref={(el) => registerVideoElement(device.id, el, 'preview')}
            autoPlay
            playsInline
            muted
            className="preview-video"
          />
          <div className="preview-overlay">
            <span className="live-dot"></span>
            LIVE
          </div>
        </div>
      )}

      {isSelected ? (
        <div className="device-controls">
          {isCamera && (
            <div className="control-group">
              <label>Volume</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={volume ?? 1}
                onChange={(e) => onVolumeChange(device.id, parseFloat(e.target.value))}
                className="volume-slider"
              />
              <span className="volume-value">{Math.round((volume ?? 1) * 100)}%</span>
            </div>
          )}
          {isSpeaker && (
            <div className="control-group">
              <label>Volume</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={volume ?? 1}
                onChange={(e) => onVolumeChange(device.id, parseFloat(e.target.value))}
                className="volume-slider"
              />
              <span className="volume-value">{Math.round((volume ?? 1) * 100)}%</span>
            </div>
          )}
          <div className="device-actions">
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isCamera) setFullscreenDevice(device);
              }}
              className="btn btn-secondary btn-sm"
              disabled={!isCamera}
            >
              <Maximize2 size={14} />
              Fullscreen
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeDevice(device.id);
              }}
              className="btn btn-danger btn-sm"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        isCamera && (
          <div className="device-quick-actions">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setFullscreenDevice(device);
              }}
              className="btn btn-primary btn-sm"
              title="View camera fullscreen"
            >
              <Video size={14} />
              <span>View Camera</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMotionDetectionEnabled(prev => !prev);
              }}
              className={`btn btn-${motionDetectionEnabled ? 'success' : 'secondary'} btn-sm`}
              title={motionDetectionEnabled ? 'Disable motion detection' : 'Enable motion detection'}
            >
              {motionDetectionEnabled ? <Eye size={14} /> : <BellOff size={14} />}
              <span>{motionDetectionEnabled ? 'Motion ON' : 'Motion OFF'}</span>
            </button>
          </div>
        )
      )}
    </article>
  );
});