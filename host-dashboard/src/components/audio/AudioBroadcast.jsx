import React from 'react';
import { Music, Upload, Play, Pause, RotateCcw, Mic } from 'lucide-react';
import { Equalizer } from '../Equalizer';

export const AudioBroadcast = ({
  audioFile,
  audioUrl,
  isPlaying,
  reconnecting,
  isTalking,
  playbackPosition,
  duration,
  handleFileChange,
  handleSeek,
  startPlayback,
  pausePlayback,
  resumePlayback,
  startPushToTalk,
  stopPushToTalk,
  formatTime,
  formatFileSize
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

      <div className="col-span-12">
        <div className="gridline-card">
          <div className="card-header">
            <div className="card-title-group">
              <Music size={18} className="card-title-icon" />
              <h3 className="card-title">Broadcast & Push-to-Talk</h3>
            </div>
            <span className="card-badge">LIVE AUDIO CONTROL</span>
          </div>

          <div className="audio-upload">
            <label className="file-upload">
              <input
                type="file"
                accept="audio/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              <span className="gridline-btn-ghost">
                <Upload size={14} />
                {audioFile ? audioFile.name : 'Choose Audio File'}
              </span>
            </label>
            {audioFile && (
              <span className="file-info">
                {audioFile.type} · {formatFileSize(audioFile.size)}
              </span>
            )}
          </div>

          {audioUrl && (
            <div className="playback-controls">
              <Equalizer active={isPlaying} bars={36} />

              <div className="progress-bar">
                <input
                  type="range"
                  min="0"
                  max={duration || 0}
                  value={playbackPosition}
                  onChange={handleSeek}
                  step="0.1"
                  disabled={!duration}
                  className="seek-slider"
                />
                <span className="time">
                  {formatTime(playbackPosition)} / {formatTime(duration)}
                </span>
              </div>

              <div className="playback-buttons">
                {isPlaying ? (
                  <button onClick={pausePlayback} className="gridline-btn-primary" disabled={reconnecting}>
                    <Pause size={14} />
                    <span>Pause</span>
                  </button>
                ) : (
                  <button onClick={startPlayback} className="gridline-btn-primary" disabled={reconnecting || !audioUrl}>
                    <Play size={14} />
                    <span>Play Track</span>
                  </button>
                )}
                <button onClick={resumePlayback} className="gridline-btn-ghost" disabled={reconnecting || isPlaying}>
                  <RotateCcw size={14} />
                  <span>Resume</span>
                </button>
              </div>
            </div>
          )}

          <div className="push-to-talk" style={{ marginTop: '1rem' }}>
            <h4 style={{ fontSize: '0.82rem', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Host Push-to-Talk Broadcast</h4>
            <button
              onMouseDown={startPushToTalk}
              onMouseUp={stopPushToTalk}
              onMouseLeave={stopPushToTalk}
              onTouchStart={startPushToTalk}
              onTouchEnd={stopPushToTalk}
              className={`btn btn-talk ${isTalking ? 'active' : ''}`}
              disabled={reconnecting}
            >
              <Mic size={16} />
              <span>{isTalking ? 'Broadcasting Voice...' : 'Hold to Talk to Fleet'}</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
