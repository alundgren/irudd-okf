import { appendFile, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const addToShellPath = async (directory, profileDirectory = homedir(), shell = process.env.SHELL ?? '/bin/bash') => {
  const profiles = shell.endsWith('/zsh') ? ['.zprofile'] : shell.endsWith('/bash') ? ['.bash_profile', '.bash_login', '.profile'] : [];
  if (!profiles.length) {
    console.error(`Add ${directory} to your shell's PATH.`);
    return;
  }
  let profile = join(profileDirectory, profiles.at(-1));
  for (const candidate of profiles) {
    try { await readFile(join(profileDirectory, candidate)); profile = join(profileDirectory, candidate); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const contents = await readFile(profile, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
  const quoted = `'${directory.replaceAll("'", "'\\''")}'`;
  const entry = `\n# irudd-okf CLI\nexport PATH=${quoted}:"$PATH"\n`;
  if (!contents.includes(entry)) await appendFile(profile, entry);
};
