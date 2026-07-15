class Runner {
  constructor(readonly stop: () => void) {}
}

export const runner = new Runner(() => runner.stop());
