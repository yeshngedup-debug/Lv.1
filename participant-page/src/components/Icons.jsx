const base = {
  width: '1em',
  height: '1em',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export function IconSpeaker(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 6a8.5 8.5 0 0 1 0 12" />
    </svg>
  );
}

export function IconCamera(props) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="7" width="13" height="10" rx="2.5" />
      <path d="M15.5 11l5-3v8l-5-3" />
    </svg>
  );
}

export function IconMic(props) {
  return (
    <svg {...base} {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

export function IconPlay(props) {
  return (
    <svg {...base} {...props}>
      <path d="M8 5.5v13l10.5-6.5L8 5.5z" />
    </svg>
  );
}

export function IconPause(props) {
  return (
    <svg {...base} {...props}>
      <path d="M8.5 5.5v13M15.5 5.5v13" />
    </svg>
  );
}

export function IconResume(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 9A8 8 0 1 1 4 13" />
      <path d="M4 4.5V9h4.5" />
    </svg>
  );
}

export function IconCopy(props) {
  return (
    <svg {...base} {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
    </svg>
  );
}

export function IconCheck(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  );
}

export function IconExpand(props) {
  return (
    <svg {...base} {...props}>
      <path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5" />
    </svg>
  );
}

export function IconClose(props) {
  return (
    <svg {...base} {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function IconTrash(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 7h16M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6 7l1 12a2 2 0 0 0 2 1.8h6A2 2 0 0 0 17 19l1-12" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function IconMusic(props) {
  return (
    <svg {...base} {...props}>
      <path d="M9 18.5V6l11-2.5V16" />
      <circle cx="6.5" cy="18.5" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </svg>
  );
}

export function IconDevices(props) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="4" width="12" height="16" rx="2" />
      <path d="M7.5 17.5h3" />
      <rect x="17" y="9" width="4" height="11" rx="1.5" />
    </svg>
  );
}

export function IconLink(props) {
  return (
    <svg {...base} {...props}>
      <path d="M10 14a4.5 4.5 0 0 0 6.4.4l2.6-2.6a4.5 4.5 0 0 0-6.4-6.4L11.2 6.8" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4-.4L5 12.2a4.5 4.5 0 0 0 6.4 6.4l1.4-1.4" />
    </svg>
  );
}

export function IconBroadcast(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="2.25" />
      <path d="M7.7 7.7a6 6 0 0 0 0 8.6M16.3 16.3a6 6 0 0 0 0-8.6" />
      <path d="M4.9 4.9a10 10 0 0 0 0 14.2M19.1 19.1a10 10 0 0 0 0-14.2" opacity="0.55" />
    </svg>
  );
}

export function IconBack(props) {
  return (
    <svg {...base} {...props}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

export function IconStopShare(props) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="7" width="13" height="10" rx="2.5" />
      <path d="M15.5 11l5-3v8l-5-3" opacity="0.45" />
      <path d="M4 20L20 4" />
    </svg>
  );
}

export function IconLeave(props) {
  return (
    <svg {...base} {...props}>
      <path d="M14 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7" />
      <path d="M16 8l4 4-4 4M20 12H9.5" />
    </svg>
  );
}
