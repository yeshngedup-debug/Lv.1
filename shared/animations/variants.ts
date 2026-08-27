import { motion, AnimatePresence } from 'framer-motion';

// Spring presets for different interaction types
export const springs = {
  gentle: { type: 'spring', stiffness: 300, damping: 30 },
  bouncy: { type: 'spring', stiffness: 400, damping: 25 },
  snappy: { type: 'spring', stiffness: 500, damping: 35 },
  stiff: { type: 'spring', stiffness: 600, damping: 40 },
};

// Card hover animation variant
export const cardHover = {
  rest: { scale: 1, y: 0 },
  hover: { scale: 1.01, y: -2, transition: springs.gentle },
  tap: { scale: 0.985, transition: { duration: 0.1 } },
};

// Staggered list container
export const staggerContainer = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.1,
    },
  },
  exit: {
    opacity: 0,
    transition: { staggerChildren: 0.04, staggerDirection: -1 },
  },
};

// Staggered list item
export const staggerItem = {
  hidden: { opacity: 0, y: 12, scale: 0.97 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: springs.gentle,
  },
  exit: {
    opacity: 0,
    y: -8,
    scale: 0.97,
    transition: { duration: 0.15 },
  },
};

// Camera tile animation
export const cameraTile = {
  hidden: { opacity: 0, scale: 0.9, rotateY: -8 },
  show: {
    opacity: 1,
    scale: 1,
    rotateY: 0,
    transition: { ...springs.gentle, delay: 0.05 },
  },
  exit: {
    opacity: 0,
    scale: 0.9,
    rotateY: 8,
    transition: { duration: 0.2 },
  },
};

// Tab transition
export const tabTransition = {
  initial: { opacity: 0, x: 16 },
  animate: { opacity: 1, x: 0, transition: springs.gentle },
  exit: { opacity: 0, x: -16, transition: { duration: 0.15 } },
};

// Modal/overlay animation
export const modalOverlay = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

export const modalContent = {
  hidden: { opacity: 0, scale: 0.92, y: 20 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: springs.bouncy,
  },
  exit: {
    opacity: 0,
    scale: 0.92,
    y: 20,
    transition: { duration: 0.15 },
  },
};

// Button press animation
export const buttonPress = {
  rest: { scale: 1 },
  hover: { scale: 1.02 },
  tap: { scale: 0.97, transition: { duration: 0.08 } },
};

// Progress bar animation
export const progressBar = {
  initial: { width: '0%' },
  animate: { width: '100%', transition: { duration: 0.4, ease: 'easeOut' } },
};

// Equalizer bar variant
export const eqBar = (delay = 0) => ({
  animate: {
    height: ['var(--h, 60%)', '12%', 'var(--h, 60%)'],
    transition: {
      duration: 0.6 + Math.random() * 0.4,
      repeat: Infinity,
      ease: 'easeInOut',
      delay,
    },
  },
  idle: {
    height: ['15%', 'var(--h, 80%)', '15%'],
    transition: {
      duration: 1.2 + Math.random() * 0.6,
      repeat: Infinity,
      ease: 'easeInOut',
      delay,
    },
  },
});

// Status badge pulse
export const statusPulse = {
  animate: {
    boxShadow: [
      '0 0 0 0 rgba(16, 185, 129, 0.55)',
      '0 0 0 6px rgba(16, 185, 129, 0)',
      '0 0 0 0 rgba(16, 185, 129, 0)',
    ],
    transition: { duration: 1.8, repeat: Infinity, ease: 'easeInOut' },
  },
};

// Upload progress shimmer
export const shimmer = {
  animate: {
    backgroundPosition: ['200% 0', '-200% 0'],
    transition: { duration: 2, repeat: Infinity, ease: 'linear' },
  },
};

// QR code reveal
export const qrReveal = {
  hidden: { opacity: 0, scale: 0.8, rotate: -10 },
  visible: {
    opacity: 1,
    scale: 1,
    rotate: 0,
    transition: { ...springs.bouncy, delay: 0.2 },
  },
};

// Slide transitions for pages
export const slideIn = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0, transition: springs.gentle },
  exit: { opacity: 0, y: -24, transition: { duration: 0.15 } },
};

// Floating animation for decorative elements
export const floatAnimation = {
  animate: {
    y: [0, -8, 0],
    transition: { duration: 6, repeat: Infinity, ease: 'easeInOut' },
  },
};

// Layout animation for shared layout transitions
export const layoutTransition = {
  layout: { type: 'spring', stiffness: 350, damping: 30 },
};
