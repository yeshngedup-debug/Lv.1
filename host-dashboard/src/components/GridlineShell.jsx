import React, { useState } from 'react';
import {
  LayoutDashboard,
  Radio,
  Video,
  Speaker,
  Settings,
  Activity,
  ShieldCheck,
  Zap,
  Copy,
  Check,
  Power,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Layers,
  Music,
  Users
} from 'lucide-react';

export function GridlineShell({
  children,
  sessionId,
  connectionStatus,
  reconnecting,
  devicesCount = 0,
  camerasCount = 0,
  speakersCount = 0,
  onEndSession,
  joinUrl,
  activeTab = 'overview',
  onTabChange
}) {
  const [copied, setCopied] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const handleTabClick = (tab) => {
    if (onTabChange) {
      onTabChange(tab);
    }
  };

  const handleCopyLink = () => {
    if (!joinUrl) return;
    navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="gridline-app">
      {/* Top Status Strip */}
      <div className="gridline-status-strip">
        <div className="status-strip-left">
          <span className="status-pill status-pill-active">
            <span className="status-dot-pulse"></span>
            SYSTEM OPERATIONAL
          </span>
          <span className="status-divider">/</span>
          <span className="status-text">SIGNALING: WEBSOCKET</span>
          <span className="status-divider">/</span>
          <span className="status-text">WEBRTC P2P / STUN ACTIVE</span>
        </div>
        <div className="status-strip-right">
          <span className="status-metric"><Activity size={12} /> LATENCY: ~12ms</span>
          <span className="status-divider">/</span>
          <span className="status-metric"><ShieldCheck size={12} /> SECURE ROOM</span>
        </div>
      </div>

      {/* Main Gridline Header */}
      <header className="gridline-header">
        <div className="header-brand">
          <div className="brand-logo">
            <Radio size={20} className="brand-logo-icon" />
          </div>
          <div className="brand-titles">
            <h1 className="brand-name">Iris SYNCD</h1>
            <span className="brand-badge">GRIDLINE CONTROL</span>
          </div>
        </div>

        {sessionId && (
          <div className="header-center-panel">
            <div className="session-tag">
              <span className="session-label">SESSION ID</span>
              <span className="session-value">{sessionId}</span>
            </div>
            {joinUrl && (
              <button onClick={handleCopyLink} className="gridline-btn-ghost btn-sm" title="Copy Invite Link">
                {copied ? <Check size={14} className="text-green" /> : <Copy size={14} />}
                <span>{copied ? 'Copied' : 'Invite Link'}</span>
              </button>
            )}
          </div>
        )}

        <div className="header-actions">
          <div className={`connection-pill ${connectionStatus}`}>
            <span className="pill-dot"></span>
            <span className="pill-label">
              {reconnecting ? 'Reconnecting' : connectionStatus.toUpperCase()}
            </span>
          </div>

          {sessionId && (
            <button onClick={onEndSession} className="gridline-btn-danger btn-sm" disabled={reconnecting}>
              <Power size={14} />
              <span>End Session</span>
            </button>
          )}
        </div>
      </header>

      {/* Body Layout with Collapsible Sidebar */}
      <div className="gridline-body">
        {sessionId && (
          <aside className={`gridline-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
            <div className="sidebar-toggle-bar">
              <button
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="sidebar-toggle-btn"
                title={sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
              >
                {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              </button>
            </div>

            <nav className="sidebar-nav">
              <button
                className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
                onClick={() => handleTabClick('overview')}
              >
                <LayoutDashboard size={18} />
                {!sidebarCollapsed && <span>Dashboard Overview</span>}
              </button>
              <button
                className={`nav-item ${activeTab === 'audio' ? 'active' : ''}`}
                onClick={() => handleTabClick('audio')}
              >
                <Music size={18} />
                {!sidebarCollapsed && <span>Audio Broadcast</span>}
              </button>
              <button
                className={`nav-item ${activeTab === 'fleet' ? 'active' : ''}`}
                onClick={() => handleTabClick('fleet')}
              >
                <Users size={18} />
                {!sidebarCollapsed && <span>Device Fleet ({devicesCount})</span>}
              </button>
            </nav>

            {!sidebarCollapsed && (
              <div className="sidebar-footer-card">
                <div className="footer-card-header">
                  <Zap size={14} className="text-violet" />
                  <span>SYNCD HUB v2.0</span>
                </div>
                <p className="footer-card-desc">Multi-device sync & camera streaming active.</p>
              </div>
            )}
          </aside>
        )}

        <main className="gridline-content">
          {children}
        </main>
      </div>
    </div>
  );
}
