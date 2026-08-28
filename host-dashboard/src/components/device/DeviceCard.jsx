import React, { useState } from 'react';
import {
  Video,
  Speaker,
  Maximize2,
  Trash2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
  RefreshCw,
} from 'lucide-react';

export const DeviceCard = React.memo(function DeviceCard({
  device,
  onClick,
  onVolumeChange,
  volume,
  registerVideoElement,
  setFullscreenDevice,
  removeDevice,
  listening,
  onListenToggle,
  onSwitchCamera,
  peerConnectionsRef,
}) {
  const [zoom, setZoom] = useState(1);

  const isCamera =
    (device.role === 'camera' || device.role === 'device') && device.isCameraEnabled !== false;
  const isSpeaker =
    (device.role === 'speaker' || device.role === 'device') && device.isSpeakerEnabled !== false;
  const cameras = device.cameras || [];
  const pc = peerConnectionsRef?.current?.get(device.id);
  const hasSignal = !!pc?.remoteStream;
  const roleLabel = device.role === 'device' ? 'Camera + Speaker' : device.role === 'camera' ? 'Camera' : 'Speaker';

  const stop = (e) => e.stopPropagation();

  return (
    <article className="gridline-card overflow-hidden" onClick={onClick}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 shrink-0 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-accent-cyan">
            {device.role === 'speaker' ? <Speaker size={16} /> : <Video size={16} />}
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-text-primary truncate">
              {device.nickname || 'Guest device'}
            </h3>
            <p className="text-xs text-text-tertiary">
              {roleLabel}
              {cameras.length > 0 && ` · ${cameras.length} camera${cameras.length > 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-accent-green/20 text-accent-green border border-accent-green/30">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-[pulse-ring_1.8s_ease-in-out_infinite]" />
          LIVE
        </span>
      </div>

      {/* Live camera */}
      {isCamera && (
        <div className="relative aspect-video bg-black overflow-hidden">
          <div
            className="w-full h-full transition-transform duration-200"
            style={{ transform: `scale(${zoom})` }}
          >
            <video
              ref={(el) => registerVideoElement(device.id, el, 'grid')}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          </div>

          {!hasSignal && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60">
              <Video size={20} className="text-text-tertiary" />
              <p className="text-xs text-text-tertiary">Waiting for camera signal…</p>
            </div>
          )}

          {/* Zoom controls */}
          <div className="absolute top-2 right-2 flex items-center gap-1 rounded-lg bg-black/60 border border-white/10 p-1">
            <button
              onClick={(e) => {
                stop(e);
                setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)));
              }}
              disabled={zoom <= 1}
              aria-label="Zoom out"
              className="p-1.5 rounded text-text-primary hover:bg-white/10 disabled:opacity-30"
            >
              <ZoomOut size={14} />
            </button>
            <span className="text-xs font-mono text-text-primary w-9 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={(e) => {
                stop(e);
                setZoom((z) => Math.min(4, +(z + 0.5).toFixed(1)));
              }}
              disabled={zoom >= 4}
              aria-label="Zoom in"
              className="p-1.5 rounded text-text-primary hover:bg-white/10 disabled:opacity-30"
            >
              <ZoomIn size={14} />
            </button>
          </div>

          {/* Camera switch */}
          {cameras.length > 1 && (
            <button
              onClick={(e) => {
                stop(e);
                onSwitchCamera?.(device);
              }}
              aria-label="Switch camera"
              className="absolute top-2 left-2 flex items-center gap-1.5 rounded-lg bg-black/60 border border-white/10 px-2 py-1.5 text-xs text-text-primary hover:bg-white/10"
            >
              <RefreshCw size={12} />
              <span className="font-mono">
                CAM {(cameras.findIndex((c) => c.id === device.activeCameraId) + 1 || 1)}/{cameras.length}
              </span>
            </button>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="px-4 py-3 space-y-3">
        {isSpeaker && (
          <div className="flex items-center gap-3">
            <Speaker size={14} className="text-accent-magenta shrink-0" />
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round((volume ?? 0.8) * 100)}
              onChange={(e) => onVolumeChange(parseInt(e.target.value, 10) / 100)}
              aria-label={`Volume for ${device.nickname || 'device'}`}
              className="w-full h-1.5 bg-white/5 rounded-full"
            />
            <span className="text-xs font-mono text-text-tertiary w-9 text-right">
              {Math.round((volume ?? 0.8) * 100)}%
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          {isCamera && (
            <button
              onClick={(e) => {
                stop(e);
                onListenToggle?.(device.id);
              }}
              aria-pressed={!!listening}
              className={`flex-1 px-3 py-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
                listening
                  ? 'bg-accent-cyan/15 border-accent-cyan/40 text-accent-cyan'
                  : 'bg-white/5 border-white/10 text-text-primary hover:bg-white/10'
              }`}
            >
              {listening ? <Volume2 size={14} /> : <VolumeX size={14} />}
              <span>{listening ? 'Mic audible' : 'Listen to mic'}</span>
            </button>
          )}
          {isCamera && (
            <button
              onClick={(e) => {
                stop(e);
                setFullscreenDevice(device.id);
              }}
              aria-label="View fullscreen"
              className="px-3 py-2 rounded-lg border bg-white/5 border-white/10 text-text-primary hover:bg-white/10"
            >
              <Maximize2 size={14} />
            </button>
          )}
          <button
            onClick={(e) => {
              stop(e);
              removeDevice();
            }}
            aria-label="Remove device"
            className="px-3 py-2 rounded-lg border bg-accent-rose/10 border-accent-rose/30 text-accent-rose hover:bg-accent-rose/20"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </article>
  );
});
