import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
if (!existsSync('.env')) {
  let env = readFileSync('.env.example', 'utf8');
  env = env.replace(/^JWT_SECRET=.*$/m, 'JWT_SECRET=' + randomBytes(32).toString('hex')).replace(/^SECRET_ENCRYPTION_KEY=.*$/m, 'SECRET_ENCRYPTION_KEY=' + randomBytes(32).toString('hex'));
  writeFileSync('.env', env);
}
const schema = readFileSync('packages/database/prisma/schema.prisma', 'utf8').replace('provider = "mysql"', 'provider = "sqlite"').replaceAll(' @db.Text','');
writeFileSync('packages/database/prisma/local.prisma', schema);
if (!existsSync('packages/database/prisma/dev.db')) writeFileSync('packages/database/prisma/dev.db','');
const cli = 'node_modules/prisma/build/index.js';
for (const args of [['generate'], ['db', 'push']]) execFileSync(process.execPath, [cli, ...args, '--schema', 'packages/database/prisma/local.prisma'], {stdio:'inherit'});
