// ck: the project's command line. `npm run ck -- <command>`.
export {};
const [cmd, ...rest] = process.argv.slice(2);
const commands: Record<string, () => Promise<{ run(argv: string[]): Promise<number> }>> = {
  doctor: () => import('./doctor.ts'),
};
if (!cmd || !commands[cmd]) {
  console.log(`usage: npm run ck -- <${Object.keys(commands).join('|')}> [--offline]`);
  process.exit(cmd ? 2 : 0);
}
process.exit(await (await commands[cmd]()).run(rest));
