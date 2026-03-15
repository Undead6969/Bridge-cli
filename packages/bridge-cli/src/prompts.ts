import { createInterface } from "node:readline/promises";

export async function prompt(question: string, fallback = ""): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });
  try {
    const suffix = fallback ? ` (${fallback})` : "";
    const answer = await rl.question(`${question}${suffix}: `);
    return answer.trim() || fallback;
  } finally {
    rl.close();
  }
}

export async function selectOne<T extends string>(
  title: string,
  options: Array<{ value: T; label: string; description?: string }>,
  fallback?: T
): Promise<T> {
  console.log(`\n${title}`);
  options.forEach((option, index) => {
    const description = option.description ? ` - ${option.description}` : "";
    console.log(`${index + 1}. ${option.label}${description}`);
  });
  const defaultIndex = fallback ? Math.max(0, options.findIndex((option) => option.value === fallback)) + 1 : 1;
  const answer = await prompt("Choose an option", String(defaultIndex));
  const byIndex = Number(answer);
  if (Number.isInteger(byIndex) && byIndex > 0 && byIndex <= options.length) {
    return options[byIndex - 1].value;
  }
  const direct = options.find((option) => option.value === answer);
  if (direct) {
    return direct.value;
  }
  return fallback ?? options[0].value;
}
