// A timed-out command is not cancelled by Promise.race. Retire the executor
// so that late results can never be used for another navigation.
export function guardExecutor(
  executor: { execute: (command: any) => Promise<any> },
  onTimeout: () => void,
  timeoutMs = 60000,
  quitTimeoutMs = 10000,
) {
  const execute = executor.execute.bind(executor);
  let retired = false;
  executor.execute = async (command: any) => {
    if (retired) throw new Error("WebDriver command deadline: session retired");
    const name = command.getName();
    const limit = name === "quit" ? quitTimeoutMs : timeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        execute(command),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            retired = true;
            reject(new Error(`WebDriver command deadline: ${name} exceeded ${limit}ms`));
            try { onTimeout(); } catch (_) { /* Preserve the deadline error. */ }
          }, limit);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
