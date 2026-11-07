// The command line, as every tool reads it: `--name=value` and `--name`.

/** The value of `--name=value`, or `null` when the option is not there. */
export function arg(name: string, argv: readonly string[] = process.argv): string | null {
  return argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null
}

/** Whether `--name` is there. */
export function flag(name: string, argv: readonly string[] = process.argv): boolean {
  return argv.includes(`--${name}`)
}
