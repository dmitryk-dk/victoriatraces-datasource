// Reds excluded so red can mean "error" anywhere it appears in the panel.
// Only light/medium colors so the dark inside-label text stays readable.
const SERVICE_PALETTE = [
  '#5794F2',
  '#73BF69',
  '#FADE2A',
  '#B877D9',
  '#FF9830',
  '#3FB1D8',
  '#8AB8FF',
  '#E6C384',
  '#A4C77E',
  '#9FB4FF',
];


export function colorForService(name: string): string {
  if (!name) {
    return SERVICE_PALETTE[0];
  }
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return SERVICE_PALETTE[h % SERVICE_PALETTE.length];
}
