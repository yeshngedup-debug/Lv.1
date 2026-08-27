import React from 'react';
import { Music, Upload, Play, Pause, Mic, MicOff, AlertTriangle, RefreshCw } from 'lucide-react';
import { Equalizer } from '../Equalizer';

export const AudioBroadcast = ({
  audioFile,
  audioUrl,
  isPlaying,
  reconnecting,
  isTalking,
  playbackPosition,
  duration,
  uploading = false,
  uploadedTrack = null,
  audioError = null,
  handleFileChange,
  handleSeek,
  handleUpload,
  startPlayback,
  pausePlayback,
  startPushToTalk,
  stopPushToTalk,
  formatTime,
  formatFileSize,
}) => {
  return (
    <>
      <div className="col-span-12">
        <div className="page-heading">
          <Music size={22} />
          <div>
            <h2>Audio Broadcast</h2>
            <p>Upload tracks, control playback and talk to your fleet live.</p>
          </div>
        </div>
      </div>

      <div className="col-span-12 grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* Track & playback */}
        <div className="gridline-card p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-text-primary">Track &amp; playback</h3>
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${
                isPlaying ? 'bg-accent-magenta/20 text-accent-magenta' : 'bg-white/10'
              }`}
            >
              {isPlaying ? 'ON AIR' : audioFile ? 'READY' : 'IDLE'}
            </span>
          </div>

          {audioError && (
            <div className="error-banner mb-4" role="alert">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{audioError}</span>
            </div>
          )}

          {uploadedTrack?.id ? (
            <div className="space-y-4">
              <div className="flex justify-between text-sm text-text-tertiary">
                <span>Track</span>
                <span className="line-clamp-1 max-w-sm text-text-primary">
                  {uploadedTrack.name || 'Unknown'}
                </span>
              </div>

              <Equalizer active={isPlaying} bars={36} />

              <div className="space-y-1">
                <input
                  type="range"
                  min="0"
                  max={duration || 0}
                  value={playbackPosition}
                  onChange={handleSeek}
                  step="0.1"
                  disabled={!duration}
                  aria-label="Seek position"
                  className="w-full h-1.5 bg-white/5 rounded-full disabled:opacity-40"
                />
                <div className="flex justify-between text-xs text-text-tertiary font-mono">
                  <span>{formatTime(playbackPosition)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {isPlaying ? (
                  <button
                    onClick={pausePlayback}
                    disabled={reconnecting}
                    className="gridline-btn-primary px-4 py-2 flex items-center gap-2"
                  >
                    <Pause size={14} />
                    <span>Pause broadcast</span>
                  </button>
                ) : (
                  <button
                    onClick={startPlayback}
                    disabled={reconnecting || uploading}
                    className="gridline-btn-primary px-4 py-2 flex items-center gap-2"
                  >
                    <Play size={14} />
                    <span>Resume broadcast</span>
                  </button>
                )}
                <label className="gridline-btn-ghost px-4 py-2 flex items-center gap-2 cursor-pointer">
                  <Upload size={14} />
                  <span>New track</span>
                  <input
                    type="file"
                    accept="audio/*"
                    className="sr-only"
                    onChange={handleFileChange}
                  />
                </label>
              </div>
            </div>
          ) : audioFile ? (
            <div className="space-y-4">
              <div className="flex justify-between text-sm text-text-tertiary">
                <span>Selected</span>
                <span className="line-clamp-1 max-w-sm text-text-primary">
                  {audioFile.name} ({formatFileSize(audioFile.size)})
                </span>
              </div>
              <p className="text-xs text-text-tertiary">
                Step 2 of 3 — upload sends the track to every connected device.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleUpload}
                  disabled={uploading || reconnecting}
                  className="gridline-btn-primary px-4 py-2 flex items-center gap-2"
                >
                  {uploading ? (
                    <>
                      <RefreshCw size={14} className="animate-[spin_1.2s_linear_infinite]" />
                      <span>Uploading…</span>
                    </>
                  ) : (
                    <>
                      <Upload size={14} />
                      <span>Upload to session</span>
                    </>
                  )}
                </button>
                <label className="gridline-btn-ghost px-4 py-2 flex items-center gap-2 cursor-pointer">
                  <span>Choose different</span>
                  <input
                    type="file"
                    accept="audio/*"
                    className="sr-only"
                    onChange={handleFileChange}
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-text-tertiary">
                Pick a track to broadcast — every connected phone plays it in sync.
              </p>
              <p className="text-xs text-text-tertiary">
                Step 1 of 3 · MP3, WAV, OGG, MP4, WEBM · up to 50MB
              </p>
              <label className="gridline-btn-primary px-4 py-2 inline-flex items-center gap-2 cursor-pointer">
                <Upload size={14} />
                <span>Choose audio file</span>
                <input
                  type="file"
                  accept="audio/*"
                  className="sr-only"
                  onChange={handleFileChange}
                />
              </label>
            </div>
          )}
        </div>

        {/* Push-to-talk */}
        <div className="gridline-card p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-text-primary">Push-to-talk</h3>
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${
                isTalking ? 'bg-accent-rose/20 text-accent-rose' : 'bg-white/10'
              }`}
            >
              {isTalking ? 'LIVE' : 'STANDBY'}
            </span>
          </div>

          <button
            onMouseDown={startPushToTalk}
            onMouseUp={stopPushToTalk}
            onMouseLeave={stopPushToTalk}
            onTouchStart={startPushToTalk}
            onTouchEnd={stopPushToTalk}
            onKeyDown={(e) => {
              if (e.key === ' ' && !e.repeat) {
                e.preventDefault();
                startPushToTalk();
              }
            }}
            onKeyUp={(e) => {
              if (e.key === ' ') stopPushToTalk();
            }}
            aria-pressed={isTalking}
            disabled={reconnecting}
            className={`w-full px-4 py-6 rounded-xl border text-sm font-medium flex flex-col items-center justify-center gap-3 transition-colors ${
              isTalking
                ? 'ptt-active'
                : 'bg-white/5 border-white/10 text-text-primary hover:bg-white/10'
            }`}
          >
            {isTalking ? <Mic size={24} /> : <MicOff size={24} />}
            <span>{isTalking ? 'Broadcasting voice…' : 'Hold to talk to the room'}</span>
          </button>

          <p className="text-xs text-text-tertiary mt-3">
            Hold the button — or hold <span className="font-mono">Space</span> — while you
            speak. Every speaker plays your voice live.
          </p>
        </div>
      </div>
    </>
  );
};
