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

export default class Shimmer implements Disposable {
  private interval: ReturnType<typeof setInterval> | null = null;
  private currentText = "";
  private prevLength = 0;
  private offset = 0;

  public update(text: string): void {
    this.currentText = text;

    if (!this.interval) {
      this.render();
      this.start();
    }
  }

  private render(): void {
    const width = SHIMMER_COLORS.length;
    const colored = this.currentText
      .split("")
      .map((char, i) => {
        const pos =
          (i - this.offset + this.currentText.length * 100) %
          this.currentText.length;
        if (pos < width) {
          return SHIMMER_COLORS[pos](char);
        }

        return rgb(...BASE_BLUE)(char);
      })
      .join("");

    const padding =
      this.prevLength > this.currentText.length
        ? " ".repeat(this.prevLength - this.currentText.length)
        : "";
    process.stdout.write(`\r${colored}${padding}`);
    this.prevLength = this.currentText.length;
    this.offset = (this.offset + 1) % this.currentText.length;
  }

  public stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      process.stdout.write("\r" + " ".repeat(this.prevLength) + "\r");
    }
  }

  public [Symbol.dispose](): void {
    this.stop();
  }

  private start(): void {
    this.interval = setInterval(() => this.render(), 50);
  }
}
