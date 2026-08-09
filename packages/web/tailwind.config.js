/** @type {import('tailwindcss').Config} */
// 指尖仙侠 · 黑金鎏金（云纹版）主题
// 对齐设计稿《指尖仙侠-UI预览-黑金云纹版.html》的精确 token：
//   ink 暖墨阶 / gold 香槟鎏金 / seal 朱印 / 低饱和语义色。
// 策略：配置层把 gray→ink、indigo→gold 整体重映射，全站类名零改动换肤。
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // —— 中性色：gray → ink 暖墨阶（玄墨底，无绿调）——
        gray: {
          50: '#f7f3ec',
          100: '#f0eae0', // 主要文字（暖宣纸）
          200: '#ddd4c6',
          300: '#c0b5a6', // 标签文字
          400: '#94897c', // 次要文字
          500: '#6b6156', // 占位/最弱文字
          600: '#40382f', // 描边（弱）/禁用
          700: '#2e2822', // 描边（强）
          800: '#201c18', // 悬浮/输入框底/抬升面
          900: '#141210', // 侧边栏/卡片底
          950: '#0c0a09', // 应用底色（玄墨）
        },
        // —— 主题色：indigo → 香槟鎏金阶（与下方 gold 同族）——
        indigo: {
          50: '#faf6ec',
          100: '#f2e9d3',
          200: '#ead9b0',
          300: '#ddc48e', // 激活文字/高亮
          400: '#cfaf6e', // 图标/强调
          500: '#c09a52', // 主按钮/聚焦/选中
          600: '#a8833f', // 主按钮渐变深端
          700: '#8a6a31', // 按压态
          800: '#6d5226',
          900: '#54401e',
          950: '#312510',
        },
        // —— 鎏金（与 indigo 同族，供 gold-* 类名与装饰线稿使用）——
        gold: {
          50: '#faf6ec',
          100: '#f2e9d3',
          200: '#ead9b0',
          300: '#ddc48e',
          400: '#cfaf6e',
          500: '#c09a52',
          600: '#a8833f',
          700: '#8a6a31',
          800: '#6d5226',
          900: '#54401e',
          950: '#312510',
        },
        // —— 朱印（印章/极少量徽记）——
        seal: {
          50: '#faf1ee',
          100: '#f4dcd5',
          200: '#e7b7ab',
          300: '#d68d7c',
          400: '#c05f4c',
          500: '#a63a2e',
          600: '#8f3126',
          700: '#71261e',
          800: '#571d17',
          900: '#431611',
          950: '#2a0d0a',
        },
        // —— 低饱和语义色（对齐设计稿 ok/warn/bad）——
        ok: '#7fae8f',
        warn: '#c9a15e',
        bad: '#b56a5f',
      },
      fontFamily: {
        serif: ['"Noto Serif SC"', '"Songti SC"', '"STSong"', '"SimSun"', 'serif'],
        title: ['"Noto Serif SC"', '"Songti SC"', '"STSong"', '"SimSun"', 'serif'],
      },
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        rise: 'rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
}
