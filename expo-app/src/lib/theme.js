// Design tokens — exact copy of the Paper Terminal extension theme
// (src/components/styles.js + sidepanel.css)
export const C = {
  bg: '#060510',
  bg2: '#12111a',
  bg3: 'rgba(203, 208, 235, 0.10)',
  bg3solid: '#161522',
  line: 'rgba(203, 208, 235, 0.09)',
  lineStrong: 'rgba(203, 208, 235, 0.16)',
  text: '#f7f7f7',
  text2: '#9899a3',
  text3: '#5c5f68',
  green: '#21c95e',
  greenT: 'rgba(33, 201, 94, 0.2)',
  red: '#ff622e',
  redT: 'rgba(255, 98, 46, 0.14)',
  warning: '#ffc74f',
  warningT: 'rgba(255, 199, 79, 0.12)',
  paper: '#a896ff',
  paperT: 'rgba(168, 150, 255, 0.12)',
  paperLine: 'rgba(168, 150, 255, 0.28)',
  paperHover: '#b9aaff',
};

export const CARD = { backgroundColor: C.bg2, borderRadius: 14, borderWidth: 1, borderColor: C.lineStrong };
export const CONTROLS = { borderRadius: 10 };
