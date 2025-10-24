/**
 * Modern Material Design-inspired theme system
 * Provides a comprehensive design system with color palettes, typography, spacing, and shadows
 */

// Color palette following Material Design 3.0 principles
export const colors = {
  // Primary - Blue/Indigo for professional look
  primary: {
    main: '#3b82f6',
    light: '#60a5fa',
    dark: '#2563eb',
    contrast: '#ffffff',
  },
  // Secondary - Slate for subtle accents
  secondary: {
    main: '#64748b',
    light: '#94a3b8',
    dark: '#475569',
    contrast: '#ffffff',
  },
  // Success
  success: {
    main: '#10b981',
    light: '#34d399',
    dark: '#059669',
    contrast: '#ffffff',
  },
  // Warning
  warning: {
    main: '#f59e0b',
    light: '#fbbf24',
    dark: '#d97706',
    contrast: '#ffffff',
  },
  // Error
  error: {
    main: '#ef4444',
    light: '#f87171',
    dark: '#dc2626',
    contrast: '#ffffff',
  },
  // Info
  info: {
    main: '#06b6d4',
    light: '#22d3ee',
    dark: '#0891b2',
    contrast: '#ffffff',
  },
  // Neutral/Grey scale
  grey: {
    50: '#f9fafb',
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
    900: '#111827',
  },
  // Background
  background: {
    default: '#ffffff',
    paper: '#f9fafb',
    elevated: '#ffffff',
  },
  // Text
  text: {
    primary: '#111827',
    secondary: '#6b7280',
    disabled: '#9ca3af',
  },
  // Divider
  divider: '#e5e7eb',
  // Log levels (custom)
  levels: {
    trace: '#8b5cf6',
    debug: '#06b6d4',
    info: '#10b981',
    warn: '#f59e0b',
    error: '#ef4444',
    fatal: '#dc2626',
  },
};

// Dark mode color palette
export const darkColors = {
  primary: {
    main: '#60a5fa',
    light: '#93c5fd',
    dark: '#3b82f6',
    contrast: '#1e293b',
  },
  secondary: {
    main: '#94a3b8',
    light: '#cbd5e1',
    dark: '#64748b',
    contrast: '#1e293b',
  },
  success: {
    main: '#34d399',
    light: '#6ee7b7',
    dark: '#10b981',
    contrast: '#1e293b',
  },
  warning: {
    main: '#fbbf24',
    light: '#fcd34d',
    dark: '#f59e0b',
    contrast: '#1e293b',
  },
  error: {
    main: '#f87171',
    light: '#fca5a5',
    dark: '#ef4444',
    contrast: '#1e293b',
  },
  info: {
    main: '#22d3ee',
    light: '#67e8f9',
    dark: '#06b6d4',
    contrast: '#1e293b',
  },
  grey: {
    50: '#1e293b',
    100: '#334155',
    200: '#475569',
    300: '#64748b',
    400: '#94a3b8',
    500: '#cbd5e1',
    600: '#e2e8f0',
    700: '#f1f5f9',
    800: '#f8fafc',
    900: '#ffffff',
  },
  background: {
    default: '#0f172a',
    paper: '#1e293b',
    elevated: '#334155',
  },
  text: {
    primary: '#f1f5f9',
    secondary: '#cbd5e1',
    disabled: '#64748b',
  },
  divider: '#334155',
  levels: {
    trace: '#a78bfa',
    debug: '#22d3ee',
    info: '#34d399',
    warn: '#fbbf24',
    error: '#f87171',
    fatal: '#ef4444',
  },
};

// Typography system
export const typography = {
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"',
  monoFontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  fontSize: {
    xs: '0.75rem', // 12px
    sm: '0.875rem', // 14px
    base: '1rem', // 16px
    lg: '1.125rem', // 18px
    xl: '1.25rem', // 20px
    '2xl': '1.5rem', // 24px
    '3xl': '1.875rem', // 30px
  },
  fontWeight: {
    light: 300,
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.75,
  },
};

// Spacing system (8px base)
export const spacing = {
  0: '0',
  1: '0.25rem', // 4px
  2: '0.5rem', // 8px
  3: '0.75rem', // 12px
  4: '1rem', // 16px
  5: '1.25rem', // 20px
  6: '1.5rem', // 24px
  8: '2rem', // 32px
  10: '2.5rem', // 40px
  12: '3rem', // 48px
  16: '4rem', // 64px
};

// Border radius
export const borderRadius = {
  none: '0',
  sm: '0.25rem', // 4px
  base: '0.5rem', // 8px
  md: '0.625rem', // 10px
  lg: '0.75rem', // 12px
  xl: '1rem', // 16px
  '2xl': '1.5rem', // 24px
  full: '9999px',
};

// Shadows for elevation
export const shadows = {
  none: 'none',
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  base: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
  '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
  inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)',
};

// Dark mode shadows (lighter for visibility)
export const darkShadows = {
  none: 'none',
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.3)',
  base: '0 1px 3px 0 rgba(0, 0, 0, 0.4), 0 1px 2px -1px rgba(0, 0, 0, 0.4)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 2px 4px -2px rgba(0, 0, 0, 0.4)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -4px rgba(0, 0, 0, 0.5)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
  '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
  inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.3)',
};

// Transitions
export const transitions = {
  fast: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
  base: '200ms cubic-bezier(0.4, 0, 0.2, 1)',
  slow: '300ms cubic-bezier(0.4, 0, 0.2, 1)',
  slowest: '500ms cubic-bezier(0.4, 0, 0.2, 1)',
};

// Breakpoints
export const breakpoints = {
  xs: '0px',
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
};

// Z-index layers
export const zIndex = {
  base: 0,
  dropdown: 1000,
  sticky: 1020,
  fixed: 1030,
  backdrop: 1040,
  modal: 1050,
  popover: 1060,
  tooltip: 1070,
};

// Create a theme object
export function createTheme(mode = 'light') {
  const isDark = mode === 'dark';
  return {
    mode,
    colors: isDark ? darkColors : colors,
    typography,
    spacing,
    borderRadius,
    shadows: isDark ? darkShadows : shadows,
    transitions,
    breakpoints,
    zIndex,
  };
}

export const lightTheme = createTheme('light');
export const darkTheme = createTheme('dark');
