const rgb = (r: number, g: number, b: number) => (s: string) =>
  `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`;

const BASE_BLUE = [105, 190, 233] as const; // #69bee9

const SHIMMER_COLORS = [
  rgb(...BASE_BLUE), // base blue (#69bee9)
  rgb(150, 210, 240), // light blue
  rgb(200, 230, 248), // lighter blue
  rgb(230, 245, 252), // very light blue (peak)
  rgb(200, 230, 248), // lighter blue
  rgb(150, 210, 240), // light blue
  rgb(...BASE_BLUE), // base blue (#69bee9)
];

export function shimmer(initialText: string): {
  update: (text: string) => void;
  stop: () => void;
} {
  let offset = 0;
  let currentText = initialText;
  let prevLength = initialText.length;
  const width = SHIMMER_COLORS.length;

  const interval = setInterval(() => {
    const colored = currentText
      .split("")
      .map((char, i) => {
        const pos =
          (i - offset + currentText.length * 100) % currentText.length;
        if (pos < width) {
          return SHIMMER_COLORS[pos](char);
        }

        return rgb(...BASE_BLUE)(char);
      })
      .join("");

    const padding =
      prevLength > currentText.length
        ? " ".repeat(prevLength - currentText.length)
        : "";
    process.stdout.write(`\r${colored}${padding}`);
    prevLength = currentText.length;
    offset = (offset + 1) % currentText.length;
  }, 50);

  return {
    update: (text: string) => {
      currentText = text;
    },
    stop: () => {
      clearInterval(interval);
      process.stdout.write("\r" + " ".repeat(prevLength) + "\r");
    },
  };
}
