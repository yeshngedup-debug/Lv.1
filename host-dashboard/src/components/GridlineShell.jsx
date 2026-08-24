import React, { useState, useMemo } from 'react';
import {
  LayoutDashboard,
  Radio,
  Video,
  Music,
  Users,
  Activity,
  ShieldCheck,
  Wifi,
  Copy,
  Check,
  Power,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

export function GridlineShell({
  children,
  sessionId,
  connectionStatus = 'disconnected',
  reconnecting = false,
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
    if (onTabChange) onTabChange(tab);
  };

  const handleCopyLink = () => {
    if (!joinUrl) return;
    navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusConfig = useMemo(() => ({
    connected:    { label: 'CONNECTED',    className: 'status-connected',    icon: <ShieldCheck size={12} /> },
    disconnected: { label: 'DISCONNECTED', className: 'status-disconnected', icon: <Wifi size={12} /> },
    reconnecting: { label: 'RECONNECTING', className: 'status-reconnecting', icon: <Activity size={12} /> },
  }), []);

  const currentStatus = statusConfig[connectionStatus] || statusConfig.disconnected;

  return (
    <div className="gridline-app">
      {/* ===== Top Status Strip ===== */}
      <div className="gridline-status-strip" role="status" aria-live="polite">
        <div className="status-strip-left">
          <span className={`status-pill status-pill-active ${currentStatus.className}`}>
            <span className="status-dot-pulse" aria-hidden="true" />
            {currentStatus.label}
          </span>
          <span className="status-divider" aria-hidden="true">/</span>
          <span className="status-text">
            {devicesCount} DEVICE{devicesCount === 1 ? '' : 'S'} CONNECTED
          </span>
        </div>
        <div className="status-strip-right">
          <span className="status-metric" title="WebRTC encrypts all media end-to-end">
            <ShieldCheck size={12} aria-hidden="true" /> ENCRYPTED
          </span>
        </div>
      </div>

      {/* ===== Main Header ===== */}
      <header className="gridline-header" role="banner">
        <div className="header-brand">
          <div className="brand-logo" aria-hidden="true">
            <Radio size={20} className="brand-logo-icon" />
          </div>
          <div className="brand-titles">
            <h1 className="brand-name">Iris SYNCD</h1>
          </div>
        </div>

        {sessionId && (
          <div className="header-center-panel">
            <div className="session-tag">
              <span className="session-label">SESSION ID</span>
              <span className="session-value" data-session-id>{sessionId}</span>
            </div>
            {joinUrl && (
              <button
                onClick={handleCopyLink}
                className="gridline-btn-ghost btn-sm"
                title="Copy Invite Link"
                aria-label={copied ? 'Invite link copied' : 'Copy invite link'}
              >
                {copied ? <Check size={14} className="text-green" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                <span>{copied ? 'Copied' : 'Invite Link'}</span>
              </button>
            )}
          </div>
        )}

        <div className="header-actions">
          {sessionId && (
            <button
              onClick={onEndSession}
              className="gridline-btn-danger btn-sm"
              disabled={reconnecting}
              aria-label="End session"
            >
              <Power size={14} aria-hidden="true" />
              <span>End Session</span>
            </button>
          )}
        </div>
      </header>

      {/* ===== Body Layout ===== */}
      <div className="gridline-body">
        {sessionId && (
          <aside
            className={`gridline-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}
            aria-label="Main navigation"
          >
            <div className="sidebar-toggle-bar">
              <button
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="sidebar-toggle-btn"
                aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-expanded={!sidebarCollapsed}
              >
                {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              </button>
            </div>

            <nav className="sidebar-nav" role="navigation">
              <button
                className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
                onClick={() => handleTabClick('overview')}
                aria-current={activeTab === 'overview' ? 'page' : undefined}
              >
                <LayoutDashboard size={18} aria-hidden="true" />
                {!sidebarCollapsed && <span>Dashboard Overview</span>}
              </button>
              <button
                className={`nav-item ${activeTab === 'cctv' ? 'active' : ''}`}
                onClick={() => handleTabClick('cctv')}
                aria-current={activeTab === 'cctv' ? 'page' : undefined}
              >
                <Video size={18} aria-hidden="true" />
                {!sidebarCollapsed && <span>CCTV Grid</span>}
              </button>
              <button
                className={`nav-item ${activeTab === 'audio' ? 'active' : ''}`}
                onClick={() => handleTabClick('audio')}
                aria-current={activeTab === 'audio' ? 'page' : undefined}
              >
                <Music size={18} aria-hidden="true" />
                {!sidebarCollapsed && <span>Audio Broadcast</span>}
              </button>
              <button
                className={`nav-item ${activeTab === 'fleet' ? 'active' : ''}`}
                onClick={() => handleTabClick('fleet')}
                aria-current={activeTab === 'fleet' ? 'page' : undefined}
              >
                <Users size={18} aria-hidden="true" />
                {!sidebarCollapsed && <span>Device Fleet ({devicesCount})</span>}
              </button>
            </nav>
          </aside>
        )}

        {/* ===== Main Content Area ===== */}
        <main className="gridline-content" role="main">
          {children}
        </main>
      </div>
    </div>
  );
}