/** 视觉规范。界面只引用这里的令牌，不写死颜色、字号和间距。 */
export const tokens = {
  color: {
    background: 0x10131a,
    surface: 0x1c2230,
    primary: 0x2e6fd8,
    success: 0x2fa36b,
    warning: 0xd99a2b,
    danger: 0xd8483e,
    textPrimary: 0xffffff,
    textSecondary: 0xa9b3c4,
  },
  fontFamily: 'sans-serif',
  fontSize: { caption: 13, body: 15, title: 20, display: 28 },
  space: { xs: 4, s: 8, m: 12, l: 16, xl: 24 },
  radius: { s: 8, m: 12 },
} as const;
